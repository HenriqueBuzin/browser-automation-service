import { describe, expect, it, vi } from "vitest";
import {
  BrowserAutomationClient,
  BrowserAutomationOutcomeUnknownError,
  BrowserAutomationResponseError,
  BrowserAutomationUnavailableError,
  FailoverBrowserAutomationAdapter,
  type BrowserAutomationExecutor,
  type AutomationJobSnapshot,
  type AutomationRequest,
} from "../src/client/automation-client.js";

const request: AutomationRequest = {
  steps: [{ action: "goto", url: "https://example.com" }],
};

const passed: AutomationJobSnapshot = {
  executions: [],
  jobId: "job-1",
  status: "passed",
};

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function client(
  fetchMock: typeof fetch,
  options: { pollIntervalMs?: number; resultTimeoutMs?: number } = {},
) {
  return new BrowserAutomationClient({
    apiKey: "secret",
    baseUrl: "http://automation///",
    clientId: "consumer",
    fetch: fetchMock,
    pollIntervalMs: options.pollIntervalMs ?? 0,
    requestTimeoutMs: 100,
    resultTimeoutMs: options.resultTimeoutMs ?? 100,
  });
}

describe("BrowserAutomationClient", () => {
  it("uses production-safe timing and global fetch defaults", async () => {
    const fetchMock = vi.fn(async () => response(passed));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const defaultClient = new BrowserAutomationClient({
        apiKey: "secret",
        baseUrl: "http://automation",
        clientId: "consumer",
      });
      await expect(defaultClient.execute(request, "idempotency-key")).resolves.toEqual(passed);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits empty filters so the service runs its complete capability matrix", async () => {
    const fetchMock = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        clientId: "consumer",
        schemaVersion: 2,
        steps: request.steps,
      });
      expect(init?.headers).toMatchObject({
        "idempotency-key": "idempotency-key",
        "x-api-key": "secret",
      });
      return response(passed);
    }) as typeof fetch;

    await expect(
      client(fetchMock).execute({ ...request, browsers: [], adapters: [] }, "idempotency-key"),
    ).resolves.toEqual(passed);
  });

  it("sends explicit browser and adapter filters", async () => {
    const fetchMock = vi.fn(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        browsers: ["firefox"],
        adapters: ["playwright"],
      });
      return response(passed, 202);
    }) as typeof fetch;

    await client(fetchMock).execute(
      { ...request, browsers: ["firefox"], adapters: ["playwright"] },
      "idempotency-key",
    );
  });

  it("polls an accepted job until it reaches a terminal state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ ...passed, status: "queued" }, 202))
      .mockResolvedValueOnce(response({ ...passed, status: "running" }))
      .mockResolvedValueOnce(response(passed)) as typeof fetch;

    await expect(client(fetchMock).execute(request, "idempotency-key")).resolves.toEqual(passed);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://automation/v2/jobs/job-1",
      expect.objectContaining({ headers: { "x-api-key": "secret" } }),
    );
  });

  it("classifies pre-acceptance network and availability failures as safe for fallback", async () => {
    const network = client(vi.fn().mockRejectedValue(new Error("offline")) as typeof fetch);
    await expect(network.execute(request, "idempotency-key")).rejects.toBeInstanceOf(
      BrowserAutomationUnavailableError,
    );

    const unavailable = client(vi.fn().mockResolvedValue(response("busy", 503)) as typeof fetch);
    await expect(unavailable.execute(request, "idempotency-key")).rejects.toBeInstanceOf(
      BrowserAutomationUnavailableError,
    );
  });

  it("does not turn client errors into local fallback", async () => {
    const remote = client(vi.fn().mockResolvedValue(response("invalid", 400)) as typeof fetch);
    await expect(remote.execute(request, "idempotency-key")).rejects.toMatchObject({
      message: "invalid",
      status: 400,
    });

    const statusText = client(
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 401, statusText: "Unauthorized" }),
        ) as typeof fetch,
    );
    await expect(statusText.execute(request, "idempotency-key")).rejects.toMatchObject({
      message: "Unauthorized",
      status: 401,
    });

    const invalid = client(
      vi
        .fn()
        .mockResolvedValue(
          response({ jobId: "missing executions", status: "queued" }),
        ) as typeof fetch,
    );
    await expect(invalid.execute(request, "idempotency-key")).rejects.toBeInstanceOf(
      BrowserAutomationResponseError,
    );
  });

  it("preserves an unknown outcome after acceptance instead of repeating the action locally", async () => {
    const pollingNetwork = client(
      vi
        .fn()
        .mockResolvedValueOnce(response({ ...passed, status: "queued" }, 202))
        .mockRejectedValueOnce(new Error("lost")) as typeof fetch,
    );
    await expect(pollingNetwork.execute(request, "idempotency-key")).rejects.toMatchObject({
      jobId: "job-1",
    });

    const pollingHttp = client(
      vi
        .fn()
        .mockResolvedValueOnce(response({ ...passed, status: "queued" }, 202))
        .mockResolvedValueOnce(response("offline", 502)) as typeof fetch,
    );
    await expect(pollingHttp.execute(request, "idempotency-key")).rejects.toBeInstanceOf(
      BrowserAutomationOutcomeUnknownError,
    );
  });

  it("reports an accepted job that exceeds the result deadline", async () => {
    const fetchMock = vi.fn(async () =>
      response({ ...passed, status: "queued" }, 202),
    ) as typeof fetch;
    await expect(
      client(fetchMock, { pollIntervalMs: 1, resultTimeoutMs: 1 }).execute(
        request,
        "idempotency-key",
      ),
    ).rejects.toBeInstanceOf(BrowserAutomationOutcomeUnknownError);
  });
});

describe("FailoverBrowserAutomationAdapter", () => {
  it("uses local execution only for a failure known to precede remote acceptance", async () => {
    const remote: BrowserAutomationExecutor = {
      execute: vi.fn().mockRejectedValue(new BrowserAutomationUnavailableError("offline")),
    };
    const local: BrowserAutomationExecutor = { execute: vi.fn().mockResolvedValue(passed) };
    const adapter = new FailoverBrowserAutomationAdapter(remote, local);

    await expect(adapter.execute(request, "idempotency-key")).resolves.toEqual(passed);
    expect(local.execute).toHaveBeenCalledOnce();
  });

  it("propagates every post-acceptance or contract failure without local execution", async () => {
    const remote: BrowserAutomationExecutor = {
      execute: vi
        .fn()
        .mockRejectedValue(new BrowserAutomationOutcomeUnknownError("job-1", "unknown")),
    };
    const local: BrowserAutomationExecutor = { execute: vi.fn().mockResolvedValue(passed) };

    await expect(
      new FailoverBrowserAutomationAdapter(remote, local).execute(request, "idempotency-key"),
    ).rejects.toBeInstanceOf(BrowserAutomationOutcomeUnknownError);
    expect(local.execute).not.toHaveBeenCalled();
  });
});
