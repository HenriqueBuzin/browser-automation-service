import { describe, expect, it } from "vitest";
import { SeleniumProvider } from "../src/infrastructure/providers/selenium-provider.js";

describe("SeleniumProvider", () => {
  it("returns the configured WebDriver endpoint", async () => {
    const session = await new SeleniumProvider("http://selenium:4444/wd/hub").launch();
    expect(session).toMatchObject({
      endpoint: "http://selenium:4444/wd/hub",
      engine: "selenium",
      protocol: "webdriver",
    });
    await expect(session.close()).resolves.toBeUndefined();
  });
});
