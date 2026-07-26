import { describe, expect, it, vi } from "vitest";
import { JobStepRunner, StepExecutionError } from "../src/application/job-step-runner.js";
import type { AutomationStep } from "../src/domain/automation-job.js";
import { fakeSession } from "./helpers/fake-session.js";

describe("JobStepRunner", () => {
  it("converts every portable action into session operations", async () => {
    const session = fakeSession();
    const steps: AutomationStep[] = [
      { action: "goto", url: "https://example.test" },
      { action: "setViewport", height: 720, width: 1280 },
      { action: "fill", selector: "#name", value: "Ana" },
      { action: "type", selector: "#name", text: " Silva" },
      { action: "press", key: "Enter", selector: "#name" },
      { action: "click", selector: "#submit" },
      { action: "check", selector: "#terms" },
      { action: "uncheck", selector: "#news" },
      { action: "select", selector: "#country", values: ["BR"] },
      { action: "hover", selector: "#menu" },
      { action: "focus", selector: "#search" },
      { action: "scroll", y: 500 },
      { action: "waitForSelector", selector: "#done" },
      { action: "waitForUrl", contains: "/done" },
      { action: "wait", durationMs: 1 },
      { action: "extract", as: "title", kind: "title" },
      { action: "screenshot", as: "screen" },
      { action: "assert", expected: "Example title", kind: "title" },
      { action: "back" },
      { action: "forward" },
      { action: "reload" },
    ];
    const result = await new JobStepRunner().run(session, steps);
    expect(result.steps).toHaveLength(steps.length);
    expect(result.steps.every((step) => step.status === "passed")).toBe(true);
    expect(result.outputs).toEqual({
      screen: "base64-image",
      title: "Example title",
    });
    expect(session.check).toHaveBeenNthCalledWith(1, "#terms", true);
    expect(session.check).toHaveBeenNthCalledWith(2, "#news", false);
  });

  it("supports contains assertions", async () => {
    const result = await new JobStepRunner().run(fakeSession(), [
      {
        action: "assert",
        expected: "title",
        kind: "title",
        operator: "contains",
      },
    ]);
    expect(result.steps[0]?.output).toBe("Example title");
  });

  it("stops at the first failed step and preserves partial results", async () => {
    const session = fakeSession({
      click: vi.fn(async () => {
        throw new Error("button blocked");
      }),
    });
    const runner = new JobStepRunner();
    const error = await runner
      .run(session, [
        { action: "extract", as: "title", kind: "title" },
        { action: "click", selector: "#blocked" },
        { action: "reload" },
      ])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StepExecutionError);
    expect((error as StepExecutionError).outputs).toEqual({ title: "Example title" });
    expect((error as StepExecutionError).steps).toHaveLength(2);
    expect(session.reload).not.toHaveBeenCalled();
  });
});
