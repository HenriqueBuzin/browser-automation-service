import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import {
  ensureBootstrapClient,
  PostgresApiKeyAuthenticator,
} from "./infrastructure/auth/postgres-api-key-authenticator.js";
import { LocalArtifactStore } from "./infrastructure/artifacts/local-artifact-store.js";
import { S3ArtifactStore } from "./infrastructure/artifacts/s3-artifact-store.js";
import { BullMqExecutionQueue } from "./infrastructure/queue/bullmq-execution-queue.js";
import { BullMqWorkerHost } from "./infrastructure/queue/bullmq-worker-host.js";
import { PostgresJobRepository } from "./infrastructure/persistence/postgres-job-repository.js";
import { runMigrations } from "./infrastructure/persistence/migrations.js";
import { PlaywrightAdapter } from "./infrastructure/adapters/playwright-adapter.js";
import { PuppeteerAdapter } from "./infrastructure/adapters/puppeteer-adapter.js";
import { SeleniumAdapter } from "./infrastructure/adapters/selenium-adapter.js";
import { PlaywrightSessionConnector } from "./infrastructure/sessions/playwright-session.js";
import { PuppeteerSessionConnector } from "./infrastructure/sessions/puppeteer-session.js";
import { SeleniumSessionConnector } from "./infrastructure/sessions/selenium-session.js";
import { buildPlatformServer } from "./interfaces/platform-http-server.js";
import { AdapterRegistry } from "./application/adapter-registry.js";
import { SessionConnectorRegistry } from "./application/session-connector-registry.js";
import { ExecutionRunner } from "./application/execution-runner.js";
import { JobCompiler } from "./application/job-compiler.js";
import { capabilityManifests } from "./application/capability-manifests.js";
import { SubmitJob, type RuntimeValues } from "./application/submit-job.js";
import { JobService } from "./application/job-service.js";
import { OutboxDispatcher } from "./application/outbox-dispatcher.js";
import { DispatcherHost } from "./application/dispatcher-host.js";
import { DestinationPolicy } from "./application/destination-policy.js";
import { WeightedSemaphore } from "./application/weighted-semaphore.js";
import { ArtifactJanitor } from "./application/artifact-janitor.js";
import type { AppConfig } from "./config.js";
import { createPlatformLogger } from "./application/platform-logger.js";

export type RunningPlatform = {
  close: () => Promise<void>;
  server?: FastifyInstance;
};

const runtime: RuntimeValues = {
  id: randomUUID,
  now: () => new Date(),
};

export async function startPlatform(
  config: AppConfig,
  signal: AbortSignal,
): Promise<RunningPlatform> {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const logger = createPlatformLogger(config.appRole, config.logLevel);
  await runMigrations(pool);
  const repository = new PostgresJobRepository(pool);
  const queue = new BullMqExecutionQueue(config.redisUrl);
  const artifacts =
    config.artifactBackend === "s3"
      ? new S3ArtifactStore(config.s3Bucket, {
          ...(config.awsAccessKeyId && config.awsSecretAccessKey
            ? {
                credentials: {
                  accessKeyId: config.awsAccessKeyId,
                  secretAccessKey: config.awsSecretAccessKey,
                },
              }
            : {}),
          ...(config.s3Endpoint ? { endpoint: config.s3Endpoint } : {}),
          forcePathStyle: config.s3ForcePathStyle,
          region: config.s3Region,
        })
      : new LocalArtifactStore(config.artifactRoot);

  if (config.appRole === "api") {
    const bootstrapApiKeyHash = config.bootstrapApiKeyHash;
    if (!bootstrapApiKeyHash) throw new Error("API bootstrap key hash is required");
    await ensureBootstrapClient(pool, bootstrapApiKeyHash);
    const compiler = new JobCompiler(capabilityManifests(config));
    const submitJob = new SubmitJob(
      compiler,
      new DestinationPolicy(config.allowedHosts),
      repository,
      runtime,
      config.maxActiveJobsPerClient,
    );
    const jobService = new JobService(repository, queue, runtime);
    const server = await buildPlatformServer({
      artifactStore: artifacts,
      authenticator: new PostgresApiKeyAuthenticator(pool),
      compiler,
      jobService,
      readiness: async () => {
        const database = await pool.query<{ ready: number }>("SELECT 1 AS ready");
        return database.rows[0]?.ready === 1 && (await queue.ready());
      },
      repository,
      submitJob,
      swaggerEnabled: config.swaggerEnabled,
      logLevel: config.logLevel,
    });
    await server.listen({ host: config.host, port: config.port });
    return {
      close: async () => {
        await server.close();
        await queue.close();
        await pool.end();
      },
      server,
    };
  }

  if (config.appRole === "dispatcher") {
    const dispatcher = new OutboxDispatcher(repository, queue, runtime.now, undefined, logger);
    const janitor = new ArtifactJanitor(
      repository,
      artifacts,
      config.artifactRetentionMs,
      runtime.now,
    );
    const host = new DispatcherHost(dispatcher, config.dispatcherIntervalMs, () => janitor.run());
    const running = host.run(signal);
    return {
      close: async () => {
        await running;
        await queue.close();
        await pool.end();
      },
    };
  }

  const adapter = config.workerAdapter;
  if (!adapter) throw new Error("WORKER_ADAPTER is required");
  const adapters = createAdapters(config);
  const connectors = new SessionConnectorRegistry(
    adapters.capabilities().map((capability) => {
      if (capability.adapter === "playwright") {
        return new PlaywrightSessionConnector(capability.browser);
      }
      if (capability.adapter === "puppeteer") {
        return new PuppeteerSessionConnector(capability.browser);
      }
      return new SeleniumSessionConnector(capability.browser);
    }),
  );
  const runner = new ExecutionRunner(
    adapter,
    adapters,
    connectors,
    repository,
    artifacts,
    runtime,
    new WeightedSemaphore(config.workerCapacityUnits),
    undefined,
    logger,
  );
  const worker = new BullMqWorkerHost(config.redisUrl, adapter, runner, config.workerConcurrency);
  await worker.waitUntilReady();
  return {
    close: async () => {
      await worker.close();
      await queue.close();
      await pool.end();
    },
  };
}

function createAdapters(config: AppConfig): AdapterRegistry {
  return new AdapterRegistry([
    new PlaywrightAdapter(),
    new PuppeteerAdapter(),
    ...(config.seleniumRemoteUrl
      ? [new SeleniumAdapter(config.seleniumRemoteUrl, config.seleniumBrowsers)]
      : []),
  ]);
}
