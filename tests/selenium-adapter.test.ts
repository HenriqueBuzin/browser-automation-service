import { describe, expect, it } from "vitest";
import { SeleniumAdapter } from "../src/infrastructure/adapters/selenium-adapter.js";

describe("SeleniumAdapter", () => {
  it("returns the configured WebDriver endpoint", async () => {
    const session = await new SeleniumAdapter("http://selenium:4444/wd/hub").launch(
      "lease",
      "chromium",
    );
    expect(session).toMatchObject({
      endpoint: "http://selenium:4444/wd/hub",
      adapter: "selenium",
      protocol: "webdriver",
    });
    await expect(session.close()).resolves.toBeUndefined();
    expect(session.onClose(() => undefined)).toBeUndefined();
  });
});
