import { Type, type Static, type TProperties } from "@sinclair/typebox";

const BrowserSchema = Type.Union(
  [Type.Literal("chromium"), Type.Literal("firefox"), Type.Literal("webkit"), Type.Literal("edge")],
  { $id: "AutomationBrowser" },
);

const AdapterSchema = Type.Union(
  [
    Type.Literal("playwright"),
    Type.Literal("puppeteer"),
    Type.Literal("selenium"),
    Type.Literal("webdriverio"),
    Type.Literal("nightwatch"),
    Type.Literal("testcafe"),
    Type.Literal("taiko"),
    Type.Literal("cypress"),
    Type.Literal("cdp"),
    Type.Literal("webdriver-bidi"),
    Type.Literal("appium"),
  ],
  { $id: "AutomationAdapter" },
);

const Selector = Type.String({ minLength: 1, maxLength: 2_000 });
const Timeout = Type.Integer({ minimum: 1, maximum: 120_000 });
const OutputName = Type.String({
  maxLength: 100,
  minLength: 1,
  pattern: "^[a-zA-Z][a-zA-Z0-9_.-]*$",
});

const ExtractKindSchema = Type.Union([
  Type.Literal("attribute"),
  Type.Literal("count"),
  Type.Literal("html"),
  Type.Literal("text"),
  Type.Literal("title"),
  Type.Literal("url"),
  Type.Literal("value"),
  Type.Literal("visible"),
]);

function action<T extends string, P extends TProperties>(name: T, properties: P) {
  return Type.Object(
    {
      action: Type.Literal(name),
      ...properties,
    },
    { additionalProperties: false },
  );
}

const AutomationStepSchema = Type.Union(
  [
    action("back", {}),
    action("forward", {}),
    action("reload", {}),
    action("check", { selector: Selector }),
    action("focus", { selector: Selector }),
    action("hover", { selector: Selector }),
    action("uncheck", { selector: Selector }),
    action("click", {
      button: Type.Optional(
        Type.Union([Type.Literal("left"), Type.Literal("middle"), Type.Literal("right")]),
      ),
      clickCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 3 })),
      selector: Selector,
    }),
    action("extract", {
      as: OutputName,
      attribute: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      kind: ExtractKindSchema,
      selector: Type.Optional(Selector),
    }),
    action("fill", {
      selector: Selector,
      value: Type.String({ maxLength: 100_000 }),
    }),
    action("goto", {
      url: Type.String({
        maxLength: 8_192,
        pattern: "^(?:https?://|data:)",
      }),
      waitUntil: Type.Optional(
        Type.Union([
          Type.Literal("domcontentloaded"),
          Type.Literal("load"),
          Type.Literal("networkidle"),
        ]),
      ),
    }),
    action("press", {
      key: Type.String({ minLength: 1, maxLength: 100 }),
      selector: Type.Optional(Selector),
    }),
    action("screenshot", {
      as: OutputName,
      fullPage: Type.Optional(Type.Boolean()),
    }),
    action("scroll", {
      selector: Type.Optional(Selector),
      x: Type.Optional(Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 })),
      y: Type.Optional(Type.Integer({ minimum: -1_000_000, maximum: 1_000_000 })),
    }),
    action("select", {
      selector: Selector,
      values: Type.Array(Type.String({ maxLength: 10_000 }), {
        maxItems: 100,
        minItems: 1,
      }),
    }),
    action("setViewport", {
      height: Type.Integer({ maximum: 10_000, minimum: 100 }),
      width: Type.Integer({ maximum: 10_000, minimum: 100 }),
    }),
    action("type", {
      delayMs: Type.Optional(Type.Integer({ maximum: 10_000, minimum: 0 })),
      selector: Selector,
      text: Type.String({ maxLength: 100_000 }),
    }),
    action("wait", {
      durationMs: Type.Integer({ maximum: 120_000, minimum: 0 }),
    }),
    action("waitForSelector", {
      selector: Selector,
      state: Type.Optional(
        Type.Union([
          Type.Literal("attached"),
          Type.Literal("detached"),
          Type.Literal("visible"),
          Type.Literal("hidden"),
        ]),
      ),
      timeoutMs: Type.Optional(Timeout),
    }),
    action("waitForUrl", {
      contains: Type.String({ minLength: 1, maxLength: 8_192 }),
      timeoutMs: Type.Optional(Timeout),
    }),
    action("assert", {
      attribute: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      expected: Type.Union([Type.Boolean(), Type.Number(), Type.String()]),
      kind: ExtractKindSchema,
      operator: Type.Optional(Type.Union([Type.Literal("contains"), Type.Literal("equals")])),
      selector: Type.Optional(Selector),
    }),
  ],
  { $id: "AutomationStep" },
);

export const AutomationJobSchema = Type.Object(
  {
    browsers: Type.Optional(
      Type.Array(BrowserSchema, { maxItems: 4, minItems: 1, uniqueItems: true }),
    ),
    clientId: Type.String({
      maxLength: 64,
      minLength: 2,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$",
    }),
    adapters: Type.Optional(
      Type.Array(AdapterSchema, { maxItems: 11, minItems: 1, uniqueItems: true }),
    ),
    schemaVersion: Type.Literal(2),
    steps: Type.Array(AutomationStepSchema, { maxItems: 100, minItems: 1 }),
  },
  { $id: "AutomationJob", additionalProperties: false },
);

export const SubmitJobHeadersSchema = Type.Object(
  {
    "idempotency-key": Type.String({ maxLength: 200, minLength: 8 }),
  },
  { additionalProperties: true },
);

export type AutomationJob = Static<typeof AutomationJobSchema>;
export type AutomationStep = Static<typeof AutomationStepSchema>;
export type AutomationBrowser = Static<typeof BrowserSchema>;
export type AutomationAdapter = Static<typeof AdapterSchema>;
export type ExtractKind = Static<typeof ExtractKindSchema>;
export type MouseButton = "left" | "middle" | "right";
export type SelectorState = "attached" | "detached" | "visible" | "hidden";
