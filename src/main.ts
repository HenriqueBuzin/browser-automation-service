import { LeaseManager } from "./application/lease-manager.js";
import { Metrics } from "./application/metrics.js";
import { ProviderRegistry } from "./application/provider-registry.js";
import { loadConfig } from "./config.js";
import { ApiKeyAuthenticator } from "./infrastructure/auth/api-key-authenticator.js";
import { PlaywrightProvider } from "./infrastructure/providers/playwright-provider.js";
import { PuppeteerProvider } from "./infrastructure/providers/puppeteer-provider.js";
import { SeleniumProvider } from "./infrastructure/providers/selenium-provider.js";
import { buildServer } from "./interfaces/http-server.js";

const config = loadConfig();
const metrics = new Metrics();
const authenticator = new ApiKeyAuthenticator(config.apiKey);
const metricsAuthenticator = new ApiKeyAuthenticator(config.metricsApiKey);
const providers = new ProviderRegistry([
  new PlaywrightProvider(),
  new PuppeteerProvider(),
  ...(config.seleniumRemoteUrl ? [new SeleniumProvider(config.seleniumRemoteUrl)] : []),
]);
const leaseManager = new LeaseManager(providers, {
  connectionTimeoutMs: config.leaseConnectTimeoutMs,
  maxLeaseDurationMs: config.maxLeaseDurationMs,
  maxConcurrent: config.maxConcurrentBrowsers,
  maxQueueSize: config.maxQueueSize,
  metrics,
});
const app = buildServer({
  authenticator,
  config,
  leaseManager,
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
