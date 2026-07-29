import type { AppConfig } from "../config.js";
import { portableActions, type CapabilityManifest } from "./job-compiler.js";

export function capabilityManifests(
  config: Pick<AppConfig, "seleniumBrowsers" | "seleniumRemoteUrl">,
): CapabilityManifest[] {
  return [
    ...(["chromium", "firefox", "webkit"] as const).map((browser) => ({
      actions: portableActions,
      browser,
      executionMode: "portable-plan" as const,
      adapter: "playwright" as const,
      platform: "web" as const,
      protocol: "playwright" as const,
    })),
    ...(["chromium", "firefox"] as const).map((browser) => ({
      actions: portableActions,
      browser,
      executionMode: "portable-plan" as const,
      adapter: "puppeteer" as const,
      platform: "web" as const,
      protocol: browser === "firefox" ? ("webdriver-bidi" as const) : ("cdp" as const),
    })),
    ...(config.seleniumRemoteUrl
      ? config.seleniumBrowsers.map((browser) => ({
          actions: portableActions,
          browser,
          executionMode: "portable-plan" as const,
          adapter: "selenium" as const,
          platform: "web" as const,
          protocol: "webdriver" as const,
        }))
      : []),
  ];
}
