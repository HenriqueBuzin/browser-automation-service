import { loadConfig } from "./config.js";
import { createTelemetry } from "./infrastructure/observability/telemetry.js";
import { startPlatform } from "./platform.js";

const config = loadConfig();
const controller = new AbortController();
const telemetry = createTelemetry(config.appRole, config.otelEndpoint);
telemetry.start();

for (const event of ["SIGINT", "SIGTERM"] as const) {
  process.once(event, () => controller.abort());
}

const platform = await startPlatform(config, controller.signal);
await new Promise<void>((resolve) => {
  controller.signal.addEventListener("abort", () => resolve(), { once: true });
});
await platform.close();
await telemetry.shutdown();
