import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  ClientQuotaExceededError,
  IdempotencyConflictError,
} from "../src/application/submit-job.js";
import { DestinationNotAllowedError } from "../src/application/destination-policy.js";
import { JobCompiler } from "../src/application/job-compiler.js";
import { buildPlatformServer } from "../src/interfaces/platform-http-server.js";
import { InMemoryJobRepository } from "../src/infrastructure/persistence/in-memory-job-repository.js";
import { executionRecord, fixedNow, jobDefinition, jobRecord } from "./helpers/records.js";

const servers: FastifyInstance[] = [];
const jobId = "00000000-0000-4000-8000-000000000001";
const executionId = "00000000-0000-4000-8000-000000000002";
const artifactId = "00000000-0000-4000-8000-000000000003";

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function dependencies() {
  const repository = new InMemoryJobRepository();
  const job = jobRecord({ id: jobId });
  const execution = executionRecord({ id: executionId, jobId });
  void repository.createJob(job, [execution], []);
  const submitJob = {
    execute: vi.fn(async () => ({ created: true, executions: [execution], job })),
  };
  const jobService = {
    cancel: vi.fn(async (id: string) => id === jobId),
    get: vi.fn(async (id: string) =>
      id === jobId
        ? {
            executions: [{ ...execution, status: "passed" as const }],
            job: { ...job, status: "passed" as const },
          }
        : undefined,
    ),
    retry: vi.fn(async (id: string) => id === executionId),
  };
  const readiness = vi.fn(async () => true);
  const artifactStore = {
    open: vi.fn(async () => Buffer.from("image")),
    put: vi.fn(),
    remove: vi.fn(),
  };
  const authenticator = {
    authorize: vi.fn(async (credentials: { apiKey?: string }) => credentials.apiKey === "valid"),
  };
  const compiler = new JobCompiler([
    { actions: ["goto"], browser: "chromium", adapter: "playwright" },
  ]);
  return {
    artifactStore,
    authenticator,
    compiler,
    jobService,
    readiness,
    repository,
    submitJob,
  };
}

async function build(overrides: Record<string, unknown> = {}) {
  const deps = { ...dependencies(), ...overrides };
  const server = await buildPlatformServer({
    artifactStore: deps.artifactStore as never,
    authenticator: deps.authenticator as never,
    compiler: deps.compiler as never,
    jobService: deps.jobService as never,
    ...(typeof (deps as Record<string, unknown>).logLevel === "string"
      ? { logLevel: (deps as Record<string, unknown>).logLevel as string }
      : {}),
    readiness: deps.readiness as never,
    repository: deps.repository as never,
    submitJob: deps.submitJob as never,
    swaggerEnabled: false,
  });
  servers.push(server);
  return { deps, server };
}

const auth = { "x-api-key": "valid" };

describe("platform HTTP API", () => {
  it("reports liveness, readiness and scoped capabilities", async () => {
    const { deps, server } = await build();
    expect((await server.inject({ method: "GET", url: "/health/live" })).json()).toEqual({
      status: "ok",
    });
    expect((await server.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    deps.readiness.mockResolvedValue(false);
    expect((await server.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(503);
    expect((await server.inject({ method: "GET", url: "/v2/capabilities" })).statusCode).toBe(401);
    const capabilities = await server.inject({
      headers: auth,
      method: "GET",
      url: "/v2/capabilities",
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().capabilities).toHaveLength(1);
  });

  it("enables structured request logging when configured", async () => {
    const { server } = await build({ logLevel: "silent" });
    expect((await server.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
  });

  it("plans and submits asynchronous jobs with both success status codes", async () => {
    const { deps, server } = await build();
    const plan = await server.inject({
      headers: auth,
      method: "POST",
      payload: jobDefinition(),
      url: "/v2/jobs/plan",
    });
    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toMatchObject({ schemaVersion: 2 });
    const submitted = await server.inject({
      headers: { ...auth, "idempotency-key": "idempotency-1" },
      method: "POST",
      payload: jobDefinition(),
      url: "/v2/jobs",
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.json()).toMatchObject({
      created: true,
      jobId,
      status: "queued",
    });
    deps.submitJob.execute.mockResolvedValue({
      ...(await deps.submitJob.execute()),
      created: false,
    });
    expect(
      (
        await server.inject({
          headers: { ...auth, "idempotency-key": "idempotency-1" },
          method: "POST",
          payload: jobDefinition(),
          url: "/v2/jobs",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          headers: { ...auth, "idempotency-key": "short" },
          method: "POST",
          payload: jobDefinition(),
          url: "/v2/jobs",
        })
      ).statusCode,
    ).toBe(400);
  });

  it.each([
    [new ClientQuotaExceededError("client"), 429],
    [new IdempotencyConflictError(), 409],
    [new DestinationNotAllowedError("localhost"), 400],
    [new TypeError("bad job"), 400],
  ])("maps submission error %s to %s", async (error, statusCode) => {
    const submitJob = { execute: vi.fn(async () => Promise.reject(error)) };
    const { server } = await build({ submitJob });
    const response = await server.inject({
      headers: { ...auth, "idempotency-key": "idempotency-1" },
      method: "POST",
      payload: jobDefinition(),
      url: "/v2/jobs",
    });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json().error).toBe(error.message);
  });

  it("allows unexpected handler failures to reach Fastify's 500 response", async () => {
    const submitJob = {
      execute: vi.fn(async () => Promise.reject(new Error("unexpected"))),
    };
    const { server } = await build({ submitJob });
    const response = await server.inject({
      headers: { ...auth, "idempotency-key": "idempotency-1" },
      method: "POST",
      payload: jobDefinition(),
      url: "/v2/jobs",
    });
    expect(response.statusCode).toBe(500);
  });

  it("returns job snapshots, SSE events, cancellation and retry outcomes", async () => {
    const { deps, server } = await build();
    expect(
      (await server.inject({ headers: auth, method: "GET", url: `/v2/jobs/${jobId}` })).statusCode,
    ).toBe(200);
    expect(
      (await server.inject({ headers: auth, method: "GET", url: `/v2/jobs/${artifactId}` }))
        .statusCode,
    ).toBe(404);
    const events = await server.inject({
      headers: auth,
      method: "GET",
      url: `/v2/jobs/${jobId}/events`,
    });
    expect(events.headers["content-type"]).toContain("text/event-stream");
    expect(events.body).toContain("event: job");
    const resumed = await server.inject({
      headers: { ...auth, "last-event-id": fixedNow.toISOString() },
      method: "GET",
      url: `/v2/jobs/${jobId}/events`,
    });
    expect(resumed.statusCode).toBe(200);
    deps.jobService.get
      .mockResolvedValueOnce({
        executions: [executionRecord({ status: "passed" })] as never,
        job: jobRecord({ status: "passed" }) as never,
      })
      .mockResolvedValueOnce(undefined);
    expect(
      (
        await server.inject({
          headers: auth,
          method: "GET",
          url: `/v2/jobs/${jobId}/events`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          headers: auth,
          method: "GET",
          url: `/v2/jobs/${artifactId}/events`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await server.inject({
          headers: auth,
          method: "POST",
          url: `/v2/jobs/${jobId}/cancel`,
        })
      ).statusCode,
    ).toBe(202);
    deps.jobService.cancel.mockResolvedValue(false);
    expect(
      (
        await server.inject({
          headers: auth,
          method: "POST",
          url: `/v2/jobs/${jobId}/cancel`,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await server.inject({
          headers: auth,
          method: "POST",
          url: `/v2/executions/${executionId}/retry`,
        })
      ).statusCode,
    ).toBe(202);
    deps.jobService.retry.mockResolvedValue(false);
    expect(
      (
        await server.inject({
          headers: auth,
          method: "POST",
          url: `/v2/executions/${executionId}/retry`,
        })
      ).statusCode,
    ).toBe(409);
  });

  it("streams safe named artifacts and returns 404 for absent records", async () => {
    const { deps, server } = await build();
    await deps.repository.addArtifact({
      contentType: "image/png",
      createdAt: fixedNow,
      executionId,
      id: artifactId,
      name: 'unsafe " name',
      path: "execution/artifact.png",
      size: 5,
    });
    const response = await server.inject({
      headers: auth,
      method: "GET",
      url: `/v2/artifacts/${artifactId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toBe('inline; filename="unsafe___name.png"');
    expect(response.rawPayload).toEqual(Buffer.from("image"));
    expect(
      (
        await server.inject({
          headers: auth,
          method: "GET",
          url: `/v2/artifacts/${jobId}`,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("can expose generated OpenAPI documentation", async () => {
    const deps = dependencies();
    const server = await buildPlatformServer({
      ...deps,
      artifactStore: deps.artifactStore as never,
      authenticator: deps.authenticator as never,
      jobService: deps.jobService as never,
      submitJob: deps.submitJob as never,
      swaggerEnabled: true,
    });
    servers.push(server);
    expect((await server.inject({ method: "GET", url: "/docs/json" })).statusCode).toBe(200);
  });
});
