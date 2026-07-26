import { automationBrowsers, automationEngines } from "../domain/automation-provider.js";
import type { AutomationJob, AutomationStep } from "../domain/automation-job.js";

const actions = [
  "assert",
  "back",
  "check",
  "click",
  "extract",
  "fill",
  "focus",
  "forward",
  "goto",
  "hover",
  "press",
  "reload",
  "screenshot",
  "scroll",
  "select",
  "setViewport",
  "type",
  "uncheck",
  "wait",
  "waitForSelector",
  "waitForUrl",
] as const;
const extractKinds = [
  "attribute",
  "count",
  "html",
  "text",
  "title",
  "url",
  "value",
  "visible",
] as const;

export function parseAutomationJob(value: unknown): AutomationJob {
  const input = record(value, "job");
  if (input.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  const steps = array(input.steps, "steps");
  if (steps.length === 0 || steps.length > 100) {
    throw new TypeError("steps must contain between 1 and 100 actions");
  }
  return {
    ...(input.browsers === undefined
      ? {}
      : {
          browsers: enumArray(input.browsers, automationBrowsers, "browsers"),
        }),
    clientId: clientId(input.clientId),
    ...(input.drivers === undefined
      ? {}
      : {
          drivers: enumArray(input.drivers, automationEngines, "drivers"),
        }),
    schemaVersion: 1,
    steps: steps.map((step, index) => parseStep(step, index)),
  };
}

function parseStep(value: unknown, index: number): AutomationStep {
  const step = record(value, `steps[${String(index)}]`);
  const action = enumeration(step.action, actions, `steps[${String(index)}].action`);
  const selector = (): string => boundedString(step.selector, "selector", 2_000);
  switch (action) {
    case "assert":
      return {
        action,
        ...optionalString(step.attribute, "attribute", 200),
        expected: assertionValue(step.expected),
        kind: enumeration(step.kind, extractKinds, "kind"),
        ...(step.operator === undefined
          ? {}
          : {
              operator: enumeration(step.operator, ["contains", "equals"] as const, "operator"),
            }),
        ...(step.selector === undefined ? {} : { selector: selector() }),
      };
    case "back":
    case "forward":
    case "reload":
      return { action };
    case "check":
    case "focus":
    case "hover":
    case "uncheck":
      return { action, selector: selector() };
    case "click":
      return {
        action,
        ...(step.button === undefined
          ? {}
          : {
              button: enumeration(step.button, ["left", "middle", "right"] as const, "button"),
            }),
        ...(step.clickCount === undefined
          ? {}
          : { clickCount: integer(step.clickCount, "clickCount", 1, 3) }),
        selector: selector(),
      };
    case "extract":
      return {
        action,
        as: outputName(step.as),
        ...optionalString(step.attribute, "attribute", 200),
        kind: enumeration(step.kind, extractKinds, "kind"),
        ...(step.selector === undefined ? {} : { selector: selector() }),
      };
    case "fill":
      return {
        action,
        selector: selector(),
        value: boundedString(step.value, "value", 100_000),
      };
    case "goto": {
      const url = boundedString(step.url, "url", 8_192);
      const protocol = new URL(url).protocol;
      if (!["data:", "http:", "https:"].includes(protocol)) {
        throw new TypeError("goto only supports http, https and data URLs");
      }
      return {
        action,
        url,
        ...(step.waitUntil === undefined
          ? {}
          : {
              waitUntil: enumeration(
                step.waitUntil,
                ["domcontentloaded", "load", "networkidle"] as const,
                "waitUntil",
              ),
            }),
      };
    }
    case "press":
      return {
        action,
        key: boundedString(step.key, "key", 100),
        ...(step.selector === undefined ? {} : { selector: selector() }),
      };
    case "screenshot":
      return {
        action,
        as: outputName(step.as),
        ...(step.fullPage === undefined ? {} : { fullPage: boolean(step.fullPage, "fullPage") }),
      };
    case "scroll":
      return {
        action,
        ...(step.selector === undefined ? {} : { selector: selector() }),
        ...(step.x === undefined ? {} : { x: integer(step.x, "x", -1_000_000, 1_000_000) }),
        ...(step.y === undefined ? {} : { y: integer(step.y, "y", -1_000_000, 1_000_000) }),
      };
    case "select":
      return {
        action,
        selector: selector(),
        values: stringArray(step.values, "values", 100),
      };
    case "setViewport":
      return {
        action,
        height: integer(step.height, "height", 100, 10_000),
        width: integer(step.width, "width", 100, 10_000),
      };
    case "type":
      return {
        action,
        ...(step.delayMs === undefined
          ? {}
          : { delayMs: integer(step.delayMs, "delayMs", 0, 10_000) }),
        selector: selector(),
        text: boundedString(step.text, "text", 100_000),
      };
    case "wait":
      return {
        action,
        durationMs: integer(step.durationMs, "durationMs", 0, 120_000),
      };
    case "waitForSelector":
      return {
        action,
        selector: selector(),
        ...(step.state === undefined
          ? {}
          : {
              state: enumeration(
                step.state,
                ["attached", "detached", "hidden", "visible"] as const,
                "state",
              ),
            }),
        ...(step.timeoutMs === undefined
          ? {}
          : { timeoutMs: integer(step.timeoutMs, "timeoutMs", 1, 120_000) }),
      };
    case "waitForUrl":
      return {
        action,
        contains: boundedString(step.contains, "contains", 8_192),
        ...(step.timeoutMs === undefined
          ? {}
          : { timeoutMs: integer(step.timeoutMs, "timeoutMs", 1, 120_000) }),
      };
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function enumArray<T extends string>(value: unknown, allowed: readonly T[], name: string): T[] {
  const values = array(value, name).map((entry) => enumeration(entry, allowed, name));
  if (values.length === 0) throw new TypeError(`${name} cannot be empty`);
  return [...new Set(values)];
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty string up to ${String(maximum)} characters`);
  }
  return value;
}

function optionalString(value: unknown, name: string, maximum: number): Record<string, string> {
  return value === undefined ? {} : { [name]: boundedString(value, name, maximum) };
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return Number(value);
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

function assertionValue(value: unknown): boolean | number | string {
  if (!["boolean", "number", "string"].includes(typeof value)) {
    throw new TypeError("expected must be a boolean, number or string");
  }
  return value as boolean | number | string;
}

function stringArray(value: unknown, name: string, maximum: number): string[] {
  const values = array(value, name);
  if (values.length === 0 || values.length > maximum) {
    throw new TypeError(`${name} must contain between 1 and ${String(maximum)} strings`);
  }
  return values.map((entry) => boundedString(entry, name, 10_000));
}

function outputName(value: unknown): string {
  const name = boundedString(value, "as", 100);
  if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/u.test(name)) {
    throw new TypeError("as must start with a letter and contain only letters, numbers, . _ -");
  }
  return name;
}

function clientId(value: unknown): string {
  const id = boundedString(value, "clientId", 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/u.test(id)) {
    throw new TypeError("clientId must contain 2-64 letters, numbers, dots, underscores or dashes");
  }
  return id;
}
