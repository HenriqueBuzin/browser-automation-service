import { describe, expect, it } from "vitest";
import { parseAutomationJob } from "../src/interfaces/job-parser.js";

describe("parseAutomationJob", () => {
  it("parses driver/browser filters and the portable action contract", () => {
    const job = parseAutomationJob({
      browsers: ["chromium", "firefox", "chromium"],
      clientId: "consumer-one",
      drivers: ["playwright", "selenium"],
      schemaVersion: 1,
      steps: [
        { action: "goto", url: "https://example.test", waitUntil: "domcontentloaded" },
        { action: "fill", selector: "#name", value: "Ana" },
        { action: "assert", expected: "Ana", kind: "value", selector: "#name" },
        { action: "extract", as: "heading", kind: "text", selector: "h1" },
      ],
    });
    expect(job.browsers).toEqual(["chromium", "firefox"]);
    expect(job.drivers).toEqual(["playwright", "selenium"]);
    expect(job.steps).toHaveLength(4);
  });

  it.each([
    [{}, "schemaVersion"],
    [{ clientId: "x", schemaVersion: 1, steps: [] }, "steps"],
    [{ clientId: "valid-id", schemaVersion: 1, steps: [{ action: "unknown" }] }, "action"],
    [
      {
        browsers: ["safari"],
        clientId: "valid-id",
        schemaVersion: 1,
        steps: [{ action: "back" }],
      },
      "browsers",
    ],
    [
      {
        clientId: "valid-id",
        schemaVersion: 1,
        steps: [{ action: "goto", url: "file:///etc/passwd" }],
      },
      "goto",
    ],
    [
      {
        clientId: "valid-id",
        schemaVersion: 1,
        steps: [{ action: "wait", durationMs: 120_001 }],
      },
      "durationMs",
    ],
  ])("rejects malformed jobs", (input, message) => {
    expect(() => parseAutomationJob(input)).toThrow(message);
  });

  it("parses every supported action", () => {
    const actions = [
      { action: "back" },
      { action: "check", selector: "#check" },
      { action: "click", button: "right", clickCount: 2, selector: "#button" },
      { action: "extract", as: "attribute", attribute: "href", kind: "attribute", selector: "a" },
      { action: "focus", selector: "#field" },
      { action: "forward" },
      { action: "hover", selector: "#menu" },
      { action: "press", key: "Enter", selector: "#field" },
      { action: "reload" },
      { action: "screenshot", as: "screen", fullPage: true },
      { action: "scroll", selector: "#footer", x: 10, y: 20 },
      { action: "select", selector: "#country", values: ["BR"] },
      { action: "setViewport", height: 720, width: 1280 },
      { action: "type", delayMs: 10, selector: "#field", text: "text" },
      { action: "uncheck", selector: "#check" },
      { action: "waitForSelector", selector: "#ready", state: "visible", timeoutMs: 1_000 },
      { action: "waitForUrl", contains: "/done", timeoutMs: 1_000 },
    ];
    const job = parseAutomationJob({
      clientId: "valid-id",
      schemaVersion: 1,
      steps: actions,
    });
    expect(job.steps.map((step) => step.action)).toEqual(actions.map((step) => step.action));
  });
});
