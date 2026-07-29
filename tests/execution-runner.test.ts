import { describe, expect, it, vi } from "vitest";
import { ExecutionRunner } from "../src/application/execution-runner.js";
import { AdapterRegistry } from "../src/application/adapter-registry.js";
import { SessionConnectorRegistry } from "../src/application/session-connector-registry.js";
import { WeightedSemaphore } from "../src/application/weighted-semaphore.js";
import { InMemoryJobRepository } from "../src/infrastructure/persistence/in-memory-job-repository.js";
import type { ArtifactStore } from "../src/ports/artifact-store.js";
import type { AdapterRuntime, AdapterSession } from "../src/domain/automation-adapter.js";
import { fakeSession } from "./helpers/fake-session.js";
import { executionRecord, fixedNow, jobDefinition, jobRecord } from "./helpers/records.js";

function setup(
  options: {
    definition?: ReturnType<typeof jobDefinition>;
    launchError?: Error;
    session?: ReturnType<typeof fakeSession>;
  } = {},
) {
  const repository = new InMemoryJobRepository();
  const execution = executionRecord();
  const job = jobRecord({ definition: options.definition ?? jobDefinition() });
  void repository.createJob(job, [execution], []);
  const closeProvider = vi.fn(async () => undefined);
  const providerSession: AdapterSession = {
    browser: "chromium",
    close: closeProvider,
    endpoint: "ws://browser",
    adapter: "playwright",
    onClose: vi.fn(),
    protocol: "playwright",
  };
  const provider: AdapterRuntime = {
    browsers: ["chromium"],
    adapter: "playwright",
    launch: options.launchError
      ? vi.fn(async () => Promise.reject(options.launchError))
      : vi.fn(async () => providerSession),
  };
  const session = options.session ?? fakeSession();
  const connector = {
    browser: "chromium" as const,
    connect: vi.fn(async () => session),
    adapter: "playwright" as const,
  };
  const artifacts: ArtifactStore = {
    open: vi.fn(async () => Buffer.alloc(0)),
    put: vi.fn(async (input) => ({
      absolutePath: "/artifact.png",
      contentType: input.contentType,
      createdAt: input.now,
      executionId: input.executionId,
      id: input.id,
      name: input.name,
      path: "artifact.png",
      size: input.content.byteLength,
    })),
    remove: vi.fn(async () => undefined),
  };
  let nextId = 10;
  const runner = new ExecutionRunner(
    "playwright",
    new AdapterRegistry([provider]),
    new SessionConnectorRegistry([connector]),
    repository,
    artifacts,
    {
      id: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
      now: () => fixedNow,
    },
    new WeightedSemaphore(2),
  );
  return {
    artifacts,
    closeProvider,
    connector,
    execution,
    provider,
    repository,
    runner,
    session,
  };
}

describe("ExecutionRunner", () => {
  it("executes steps, persists artifacts and closes the connected session", async () => {
    const context = setup({
      definition: jobDefinition({
        steps: [
          { action: "extract", as: "title", kind: "title" },
          { action: "screenshot", as: "screen" },
        ],
      }),
    });
    await context.runner.execute(context.execution.id);
    const result = await context.repository.findExecution(context.execution.id);
    expect(result).toMatchObject({
      attempt: 1,
      outputs: {
        screen: "00000000-0000-4000-8000-000000000010",
        title: "Example title",
      },
      status: "passed",
    });
    expect(context.artifacts.put).toHaveBeenCalledOnce();
    expect(context.repository.artifacts.size).toBe(1);
    expect(context.session.close).toHaveBeenCalledOnce();
    expect(context.closeProvider).not.toHaveBeenCalled();
  });

  it("classifies step failures as assertion failures", async () => {
    const context = setup({
      definition: jobDefinition({ steps: [{ action: "click", selector: "#button" }] }),
      session: fakeSession({
        click: vi.fn(async () => {
          throw new Error("blocked");
        }),
      }),
    });
    await context.runner.execute(context.execution.id);
    expect(await context.repository.findExecution(context.execution.id)).toMatchObject({
      error: { category: "assertion", message: "blocked" },
      status: "failed",
    });
    expect(context.session.close).toHaveBeenCalledOnce();
  });

  it("classifies launch failures as infrastructure failures", async () => {
    const context = setup({ launchError: new Error("browser unavailable") });
    await context.runner.execute(context.execution.id);
    expect(await context.repository.findExecution(context.execution.id)).toMatchObject({
      error: { category: "infrastructure", message: "browser unavailable" },
      status: "failed",
    });
  });

  it("closes a provider session when connector setup fails", async () => {
    const context = setup();
    context.connector.connect.mockRejectedValue(new Error("protocol rejected"));
    await context.runner.execute(context.execution.id);
    expect(context.closeProvider).toHaveBeenCalledOnce();
    expect(await context.repository.findExecution(context.execution.id)).toMatchObject({
      error: { category: "infrastructure" },
      status: "failed",
    });
  });

  it("tolerates close failures and acquires weighted WebKit capacity", async () => {
    const sessionClose = vi.fn(async () => Promise.reject(new Error("close failed")));
    const connected = setup({ session: fakeSession({ close: sessionClose }) });
    await connected.runner.execute(connected.execution.id);
    expect(sessionClose).toHaveBeenCalled();

    const providerClose = vi.fn(async () => Promise.reject(new Error("provider close failed")));
    const disconnected = setup();
    disconnected.closeProvider.mockImplementation(providerClose);
    disconnected.connector.connect.mockRejectedValue(new Error("connect failed"));
    await disconnected.runner.execute(disconnected.execution.id);
    expect(providerClose).toHaveBeenCalled();

    const webkit = setup();
    webkit.repository.executions.set(webkit.execution.id, executionRecord({ browser: "webkit" }));
    await webkit.runner.execute(webkit.execution.id);
    expect(await webkit.repository.findExecution(webkit.execution.id)).toMatchObject({
      status: "failed",
    });
  });

  it("observes cancellation before a step and after the final step", async () => {
    const before = setup();
    const originalFind = before.repository.findExecution.bind(before.repository);
    let reads = 0;
    before.repository.findExecution = vi.fn(async (id) => {
      reads += 1;
      return reads === 2 ? executionRecord({ id, status: "canceled" }) : originalFind(id);
    });
    await before.runner.execute(before.execution.id);
    expect(await originalFind(before.execution.id)).toMatchObject({ status: "canceled" });

    const after = setup();
    const originalAfterFind = after.repository.findExecution.bind(after.repository);
    let afterReads = 0;
    after.repository.findExecution = vi.fn(async (id) => {
      afterReads += 1;
      return afterReads === 3 ? executionRecord({ id, status: "canceled" }) : originalAfterFind(id);
    });
    await after.runner.execute(after.execution.id);
    expect(await originalAfterFind(after.execution.id)).toMatchObject({ status: "canceled" });
  });

  it("ignores unknown, mismatched, nonqueued and canceled executions", async () => {
    const context = setup();
    await context.runner.execute("missing");
    context.repository.executions.set(
      context.execution.id,
      executionRecord({ adapter: "selenium" }),
    );
    await context.runner.execute(context.execution.id);
    context.repository.executions.set(context.execution.id, executionRecord({ status: "passed" }));
    await context.runner.execute(context.execution.id);
    context.repository.executions.set(context.execution.id, executionRecord());
    const job = context.repository.jobs.get(context.execution.jobId);
    if (!job) throw new Error("fixture job missing");
    context.repository.jobs.set(job.id, { ...job, status: "canceled" });
    await context.runner.execute(context.execution.id);
    expect(context.provider.launch).not.toHaveBeenCalled();
  });

  it("releases capacity when the aggregate disappears after an atomic claim", async () => {
    const context = setup();
    vi.spyOn(context.repository, "findJob").mockResolvedValue(undefined);
    await context.runner.execute(context.execution.id);
    expect(context.provider.launch).not.toHaveBeenCalled();
  });
});
