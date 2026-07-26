import { LeaseManager } from "./application/lease-manager.js";
import { Metrics } from "./application/metrics.js";
import { MatrixJobRunner } from "./application/matrix-job-runner.js";
import { ProviderRegistry } from "./application/provider-registry.js";
import { SessionConnectorRegistry } from "./application/session-connector-registry.js";
import { loadConfig } from "./config.js";
import { ApiKeyAuthenticator } from "./infrastructure/auth/api-key-authenticator.js";
import { PlaywrightProvider } from "./infrastructure/providers/playwright-provider.js";
import { PuppeteerProvider } from "./infrastructure/providers/puppeteer-provider.js";
import { SeleniumProvider } from "./infrastructure/providers/selenium-provider.js";
import { PlaywrightSessionConnector } from "./infrastructure/sessions/playwright-session.js";
import { PuppeteerSessionConnector } from "./infrastructure/sessions/puppeteer-session.js";
import { SeleniumSessionConnector } from "./infrastructure/sessions/selenium-session.js";
import { buildServer } from "./interfaces/http-server.js";

const config = loadConfig();
const metrics = new Metrics();
const authenticator = new ApiKeyAuthenticator(config.apiKey);
const metricsAuthenticator = new ApiKeyAuthenticator(config.metricsApiKey);
const providers = new ProviderRegistry([
  new PlaywrightProvider(),
  new PuppeteerProvider(),
  ...(config.seleniumRemoteUrl
    ? [new SeleniumProvider(config.seleniumRemoteUrl, config.seleniumBrowsers)]
    : []),
]);
const leaseManager = new LeaseManager(providers, {
  connectionTimeoutMs: config.leaseConnectTimeoutMs,
  maxLeaseDurationMs: config.maxLeaseDurationMs,
  maxConcurrent: config.maxConcurrentBrowsers,
  maxQueueSize: config.maxQueueSize,
  metrics,
});
const connectors = new SessionConnectorRegistry(
  providers.capabilities().map((capability) => {
    if (capability.engine === "playwright") {
      return new PlaywrightSessionConnector(capability.browser);
    }
    if (capability.engine === "puppeteer") {
      return new PuppeteerSessionConnector(capability.browser);
    }
    return new SeleniumSessionConnector(capability.browser);
  }),
);
const matrixJobRunner = new MatrixJobRunner(providers, connectors, leaseManager, {
  maxParallelism: config.maxJobParallelism,
  queueWaitMs: config.maxQueueWaitMs,
});
const app = buildServer({
  authenticator,
  config,
  leaseManager,
  matrixJobRunner,
  metrics,
  metricsAuthenticator,
  providers,
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "graceful shutdown started");

  const forceExit = setTimeout(() => {
    app.log.fatal("graceful shutdown timed out");
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();

  await app.close();
  await leaseManager.shutdown();
  clearTimeout(forceExit);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ error }, "service failed to start");
  process.exitCode = 1;
}
