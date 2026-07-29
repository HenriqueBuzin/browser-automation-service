import type { AppConfig } from "../config.js";
import { portableActions, type CapabilityManifest } from "./job-compiler.js";

export function capabilityManifests(
  config: Pick<AppConfig, "seleniumBrowsers" | "seleniumRemoteUrl">,
): CapabilityManifest[] {
  return [
    ...(["chromium", "firefox", "webkit"] as const).map((browser) => ({
      actions: portableActions,
      browser,
      adapter: "playwright" as const,
    })),
    ...(["chromium", "firefox"] as const).map((browser) => ({
      actions: portableActions,
      browser,
      adapter: "puppeteer" as const,
    })),
    ...(config.seleniumRemoteUrl
      ? config.seleniumBrowsers.map((browser) => ({
          actions: portableActions,
          browser,
          adapter: "selenium" as const,
        }))
      : []),
  ];
}
