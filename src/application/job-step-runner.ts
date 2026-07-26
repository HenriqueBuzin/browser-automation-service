import type { AutomationSession } from "./automation-session.js";
import type { AutomationStep, StepResult } from "../domain/automation-job.js";

export type StepRunResult = {
  outputs: Record<string, boolean | number | string>;
  steps: StepResult[];
};

export type StepRunnerHooks = {
  beforeStep?: (index: number) => Promise<void>;
  storeScreenshot?: (name: string, content: Buffer) => Promise<string>;
};

export class JobStepRunner {
  public async run(
    session: AutomationSession,
    steps: AutomationStep[],
    hooks: StepRunnerHooks = {},
  ): Promise<StepRunResult> {
    const outputs: Record<string, boolean | number | string> = {};
    const results: StepResult[] = [];
    for (const [index, step] of steps.entries()) {
      await hooks.beforeStep?.(index);
      const startedAt = Date.now();
      try {
        let output = await this.#execute(session, step);
        if (step.action === "screenshot" && hooks.storeScreenshot && output !== undefined) {
          output = await hooks.storeScreenshot(step.as, Buffer.from(String(output), "base64"));
        }
        if ((step.action === "extract" || step.action === "screenshot") && output !== undefined) {
          outputs[step.as] = output;
        }
        results.push({
          action: step.action,
          durationMs: Date.now() - startedAt,
          index,
          ...(output === undefined ? {} : { output }),
          ...("as" in step ? { outputName: step.as } : {}),
          status: "passed",
        });
      } catch (error) {
        results.push({
          action: step.action,
          durationMs: Date.now() - startedAt,
          error: serializeError(error),
          index,
          status: "failed",
        });
        throw new StepExecutionError(results, outputs, error);
      }
    }
    return { outputs, steps: results };
  }

  async #execute(
    session: AutomationSession,
    step: AutomationStep,
  ): Promise<boolean | number | string | undefined> {
    switch (step.action) {
      case "assert": {
        const actual = await session.extract(step.kind, step.selector, step.attribute);
        const passed =
          (step.operator ?? "equals") === "equals"
            ? actual === step.expected
            : String(actual).includes(String(step.expected));
        if (!passed) {
          throw new Error(
            `Assertion failed: expected ${JSON.stringify(step.expected)}, received ${JSON.stringify(actual)}`,
          );
        }
        return actual;
      }
      case "back":
        return complete(session.back());
      case "check":
        return complete(session.check(step.selector, true));
      case "click":
        return complete(
          session.click(step.selector, {
            button: step.button ?? "left",
            clickCount: step.clickCount ?? 1,
          }),
        );
      case "extract":
        return session.extract(step.kind, step.selector, step.attribute);
      case "fill":
        return complete(session.fill(step.selector, step.value));
      case "focus":
        return complete(session.focus(step.selector));
      case "forward":
        return complete(session.forward());
      case "goto":
        return complete(session.goto(step.url, step.waitUntil ?? "load"));
      case "hover":
        return complete(session.hover(step.selector));
      case "press":
        return complete(session.press(step.key, step.selector));
      case "reload":
        return complete(session.reload());
      case "screenshot":
        return session.screenshot(step.fullPage ?? false);
      case "scroll":
        return complete(session.scroll(step.x ?? 0, step.y ?? 0, step.selector));
      case "select":
        return complete(session.select(step.selector, step.values));
      case "setViewport":
        return complete(session.setViewport(step.width, step.height));
      case "type":
        return complete(session.type(step.selector, step.text, step.delayMs ?? 0));
      case "uncheck":
        return complete(session.check(step.selector, false));
      case "wait":
        return complete(session.wait(step.durationMs));
      case "waitForSelector":
        return complete(
          session.waitForSelector(step.selector, step.state ?? "visible", step.timeoutMs ?? 30_000),
        );
      case "waitForUrl":
        return complete(session.waitForUrl(step.contains, step.timeoutMs ?? 30_000));
    }
  }
}

async function complete(operation: Promise<void>): Promise<undefined> {
  await operation;
  return undefined;
}

export class StepExecutionError extends Error {
  public constructor(
    public readonly steps: StepResult[],
    public readonly outputs: Record<string, boolean | number | string>,
    public readonly originalError: unknown,
  ) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.name = "StepExecutionError";
  }
}

export function serializeError(error: unknown): { message: string; name: string } {
  return error instanceof Error
    ? { message: error.message, name: error.name }
    : { message: String(error), name: "Error" };
}
