import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type } from "@sinclair/typebox";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AutomationJobSchema, SubmitJobHeadersSchema } from "../contracts/job-contract.js";
import type { AuthenticationScope, Authenticator } from "../application/authenticator.js";
import type { JobCompiler } from "../application/job-compiler.js";
import type { JobService } from "../application/job-service.js";
import type { SubmitJob } from "../application/submit-job.js";
import { ClientQuotaExceededError, IdempotencyConflictError } from "../application/submit-job.js";
import { DestinationNotAllowedError } from "../application/destination-policy.js";
import type { ArtifactStore } from "../ports/artifact-store.js";
import type { JobRepository } from "../ports/job-repository.js";
import type { ExecutionRecord } from "../domain/job-state.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

export type PlatformServerDependencies = {
  artifactStore: ArtifactStore;
  authenticator: Authenticator;
  compiler: JobCompiler;
  jobService: JobService;
  readiness: () => Promise<boolean>;
  repository: JobRepository;
  submitJob: SubmitJob;
  swaggerEnabled: boolean;
};

export async function buildPlatformServer(
  dependencies: PlatformServerDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Browser Automation Platform",
        version: "2.0.0",
      },
    },
  });
  if (dependencies.swaggerEnabled) {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) =>
    (await dependencies.readiness())
      ? { status: "ready" }
      : reply.code(503).send({ status: "not_ready" }),
  );

  app.get(
    "/v2/capabilities",
    { preHandler: requireScope(dependencies.authenticator, "capabilities:read") },
    async () => ({
      capabilities: dependencies.compiler.manifests(),
    }),
  );

  app.post(
    "/v2/jobs/plan",
    {
      preHandler: requireScope(dependencies.authenticator, "jobs:write"),
      schema: { body: AutomationJobSchema },
    },
    async (request) => ({
      executions: dependencies.compiler.compile(request.body),
      schemaVersion: 1,
    }),
  );

  app.post(
    "/v2/jobs",
    {
      schema: {
        body: AutomationJobSchema,
        headers: SubmitJobHeadersSchema,
      },
      preHandler: requireScope(dependencies.authenticator, "jobs:write"),
    },
    async (request, reply) => {
      try {
        const result = await dependencies.submitJob.execute(
          request.body,
          request.headers["idempotency-key"],
        );
        return reply.code(result.created ? 202 : 200).send(toJobResponse(result));
      } catch (error) {
        if (error instanceof ClientQuotaExceededError) {
          return reply.code(429).send({ error: error.message });
        }
        if (error instanceof IdempotencyConflictError) {
          return reply.code(409).send({ error: error.message });
        }
        if (error instanceof DestinationNotAllowedError || error instanceof TypeError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/v2/jobs/:id",
    {
      preHandler: requireScope(dependencies.authenticator, "jobs:read"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const result = await dependencies.jobService.get(request.params.id);
      return result
        ? toJobResponse({ created: false, ...result })
        : reply.code(404).send({ error: "Job not found" });
    },
  );

  app.get(
    "/v2/jobs/:id/events",
    {
      preHandler: requireScope(dependencies.authenticator, "jobs:read"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const result = await dependencies.jobService.get(request.params.id);
      if (!result) return reply.code(404).send({ error: "Job not found" });
      const payload = JSON.stringify(toJobResponse({ created: false, ...result }));
      return reply
        .type("text/event-stream")
        .header("cache-control", "no-cache")
        .send(`event: job\ndata: ${payload}\n\n`);
    },
  );

  app.post(
    "/v2/jobs/:id/cancel",
    {
      preHandler: requireScope(dependencies.authenticator, "jobs:write"),
      schema: { params: IdParams },
    },
    async (request, reply) =>
      (await dependencies.jobService.cancel(request.params.id))
        ? reply.code(202).send({ status: "canceling" })
        : reply.code(409).send({ error: "Job cannot be canceled" }),
  );

  app.post(
    "/v2/executions/:id/retry",
    {
      preHandler: requireScope(dependencies.authenticator, "jobs:write"),
      schema: { params: IdParams },
    },
    async (request, reply) =>
      (await dependencies.jobService.retry(request.params.id))
        ? reply.code(202).send({ status: "queued" })
        : reply.code(409).send({ error: "Execution cannot be retried" }),
  );

  app.get(
    "/v2/artifacts/:id",
    {
      preHandler: requireScope(dependencies.authenticator, "artifacts:read"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const artifact = await dependencies.repository.findArtifact(request.params.id);
      if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
      const content = await dependencies.artifactStore.open(artifact);
      return reply
        .header("content-disposition", `inline; filename="${safeFilename(artifact.name)}.png"`)
        .type(artifact.contentType)
        .send(content);
    },
  );

  await app.ready();
  return app;
}

function requireScope(authenticator: Authenticator, scope: AuthenticationScope) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const authorized = await authenticator.authorize(
      {
        apiKey: request.headers["x-api-key"] as string | undefined,
        authorization: request.headers.authorization,
      },
      scope,
    );
    return authorized ? undefined : reply.code(401).send({ error: "Unauthorized" });
  };
}

function toJobResponse(result: {
  created: boolean;
  executions: ExecutionRecord[];
  job: { createdAt: Date; id: string; status: string; updatedAt: Date };
}) {
  return {
    created: result.created,
    createdAt: result.job.createdAt.toISOString(),
    executions: result.executions.map((execution) => ({
      attempt: execution.attempt,
      browser: execution.browser,
      driver: execution.driver,
      error: execution.error,
      executionId: execution.id,
      outputs: execution.outputs,
      status: execution.status,
    })),
    jobId: result.job.id,
    status: result.job.status,
    updatedAt: result.job.updatedAt.toISOString(),
  };
}

function safeFilename(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/gu, "_").slice(0, 100);
}
