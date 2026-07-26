import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AutomationJobSchema, SubmitJobHeadersSchema } from "../src/contracts/job-contract.js";
import { aggregateJobStatus, canRetry, type ExecutionStatus } from "../src/domain/job-state.js";
import {
  DestinationNotAllowedError,
  DestinationPolicy,
  isPrivateAddress,
} from "../src/application/destination-policy.js";
import { JobCompiler, portableActions } from "../src/application/job-compiler.js";
import { capabilityManifests } from "../src/application/capability-manifests.js";
import { executionRecord, jobDefinition } from "./helpers/records.js";

describe("contracts, compiler and state", () => {
  it("validates the public job and idempotency contracts", () => {
    expect(Value.Check(AutomationJobSchema, jobDefinition())).toBe(true);
    expect(Value.Check(AutomationJobSchema, { ...jobDefinition(), steps: [] })).toBe(false);
    expect(Value.Check(SubmitJobHeadersSchema, { "idempotency-key": "12345678" })).toBe(true);
    expect(Value.Check(SubmitJobHeadersSchema, { "idempotency-key": "short" })).toBe(false);
  });

  it("builds the deployed capability matrix", () => {
    expect(
      capabilityManifests({ seleniumBrowsers: ["edge"], seleniumRemoteUrl: undefined }),
    ).toHaveLength(5);
    const all = capabilityManifests({
      seleniumBrowsers: ["chromium", "firefox", "edge"],
      seleniumRemoteUrl: "http://grid",
    });
    expect(all).toHaveLength(8);
    expect(all.every((manifest) => manifest.actions === portableActions)).toBe(true);
  });

  it("expands defaults, one-axis filters and the requested Cartesian product", () => {
    const compiler = new JobCompiler(
      capabilityManifests({ seleniumBrowsers: ["edge"], seleniumRemoteUrl: "http://grid" }),
    );
    expect(compiler.manifests()).toHaveLength(6);
    expect(compiler.compile(jobDefinition())).toHaveLength(6);
    expect(compiler.compile(jobDefinition({ drivers: ["puppeteer"] }))).toEqual([
      { browser: "chromium", driver: "puppeteer", supported: true },
      { browser: "firefox", driver: "puppeteer", supported: true },
    ]);
    expect(compiler.compile(jobDefinition({ browsers: ["edge"] }))).toHaveLength(3);
    expect(
      compiler.compile(
        jobDefinition({ browsers: ["webkit"], drivers: ["playwright", "puppeteer"] }),
      ),
    ).toEqual([
      { browser: "webkit", driver: "playwright", supported: true },
      {
        browser: "webkit",
        driver: "puppeteer",
        reason: "puppeteer does not support webkit in this deployment",
        supported: false,
      },
    ]);
  });

  it("marks actions absent from a manifest as unsupported and blocks unsafe protocols", () => {
    const compiler = new JobCompiler([
      { actions: ["goto"], browser: "chromium", driver: "playwright" },
    ]);
    expect(compiler.compile(jobDefinition({ steps: [{ action: "reload" }] }))).toEqual([
      {
        browser: "chromium",
        driver: "playwright",
        reason: "playwright/chromium does not support 'reload'",
        supported: false,
      },
    ]);
    expect(() =>
      compiler.compile(jobDefinition({ steps: [{ action: "goto", url: "file:///etc/passwd" }] })),
    ).toThrow("http, https and data");
  });

  it.each([
    [["running"], "running"],
    [["queued"], "queued"],
    [["canceled"], "canceled"],
    [["passed"], "passed"],
    [["failed"], "failed"],
    [["timed_out"], "failed"],
    [["unsupported"], "failed"],
    [["passed", "failed"], "partial"],
    [["passed", "unsupported"], "partial"],
  ] as [ExecutionStatus[], string][])("aggregates %j as %s", (statuses, expected) => {
    expect(
      aggregateJobStatus(
        statuses.map((status, index) =>
          executionRecord({ id: `execution-${String(index)}`, status }),
        ),
      ),
    ).toBe(expected);
  });

  it("only retries bounded infrastructure failures", () => {
    expect(
      canRetry(
        executionRecord({
          attempt: 2,
          error: { category: "infrastructure", message: "lost", name: "Error" },
          status: "failed",
        }),
      ),
    ).toBe(true);
    expect(
      canRetry(
        executionRecord({
          attempt: 3,
          error: { category: "infrastructure", message: "lost", name: "Error" },
          status: "failed",
        }),
      ),
    ).toBe(false);
    expect(canRetry(executionRecord({ status: "passed" }))).toBe(false);
  });
});

describe("destination policy", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.0.0.1", true],
    ["100.64.0.1", true],
    ["169.254.1.1", true],
    ["172.31.1.1", true],
    ["192.168.1.1", true],
    ["198.18.1.1", true],
    ["198.20.1.1", false],
    ["224.0.0.1", true],
    ["::1", true],
    ["::", true],
    ["fc00::1", true],
    ["fe80::1", true],
    ["::ffff:192.168.1.2", true],
    ["8.8.8.8", false],
    ["2001:4860:4860::8888", false],
  ])("classifies %s", (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });

  it("permits data URLs, public addresses and explicit wildcard allowlists", async () => {
    const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
    await expect(
      new DestinationPolicy([], lookup).validate(
        jobDefinition({
          steps: [
            { action: "goto", url: "data:text/html,ok" },
            { action: "goto", url: "https://public.test" },
          ],
        }),
      ),
    ).resolves.toBeUndefined();
    const noLookup = async (): Promise<never> => {
      throw new Error("lookup must not run");
    };
    await expect(
      new DestinationPolicy(["*.internal.test", "localhost"], noLookup).validate(
        jobDefinition({
          steps: [
            { action: "goto", url: "https://app.internal.test" },
            { action: "goto", url: "http://localhost" },
          ],
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("blocks literal and DNS-resolved private destinations", async () => {
    await expect(
      new DestinationPolicy([]).validate(
        jobDefinition({ steps: [{ action: "goto", url: "http://127.0.0.1" }] }),
      ),
    ).rejects.toBeInstanceOf(DestinationNotAllowedError);
    await expect(
      new DestinationPolicy([], async () => [{ address: "10.0.0.1", family: 4 }]).validate(
        jobDefinition({ steps: [{ action: "goto", url: "https://private.test" }] }),
      ),
    ).rejects.toThrow("private.test");
    await expect(
      new DestinationPolicy([]).validate(
        jobDefinition({ steps: [{ action: "goto", url: "http://localhost" }] }),
      ),
    ).rejects.toThrow("localhost");
  });
});
