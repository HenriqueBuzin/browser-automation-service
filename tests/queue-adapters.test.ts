import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const connection = {
    disconnect: vi.fn(),
    options: undefined as unknown,
    ping: vi.fn(async () => "PONG"),
    url: "",
  };
  const queues: {
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getJob: ReturnType<typeof vi.fn>;
    name: string;
    options: unknown;
  }[] = [];
  const workers: {
    close: ReturnType<typeof vi.fn>;
    name: string;
    options: unknown;
    processor: (job: { data: { executionId: string } }) => Promise<void>;
    waitUntilReady: ReturnType<typeof vi.fn>;
  }[] = [];
  return { connection, queues, workers };
});

vi.mock("ioredis", () => ({
  Redis: class {
    public readonly url: string;
    public readonly options: unknown;
    constructor(url: string, options: unknown) {
      this.url = url;
      this.options = options;
      return mocks.connection;
    }
  },
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    getJob = vi.fn(async () => undefined);
    constructor(
      public name: string,
      public options: unknown,
    ) {
      mocks.queues.push(this);
    }
  },
  Worker: class {
    close = vi.fn(async () => undefined);
    waitUntilReady = vi.fn(async () => undefined);
    constructor(
      public name: string,
      public processor: (job: { data: { executionId: string } }) => Promise<void>,
      public options: unknown,
    ) {
      mocks.workers.push(this);
    }
  },
}));

import {
  BullMqExecutionQueue,
  queueName,
} from "../src/infrastructure/queue/bullmq-execution-queue.js";
import { BullMqWorkerHost } from "../src/infrastructure/queue/bullmq-worker-host.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queues.length = 0;
  mocks.workers.length = 0;
});

describe("BullMQ adapters", () => {
  it("creates isolated queues and enqueues durable execution IDs", async () => {
    const queue = new BullMqExecutionQueue("redis://queue");
    expect(mocks.queues.map((item) => item.name)).toEqual([
      "browser-execution-playwright",
      "browser-execution-puppeteer",
      "browser-execution-selenium",
      "browser-execution-webdriverio",
      "browser-execution-nightwatch",
      "browser-execution-testcafe",
      "browser-execution-taiko",
      "browser-execution-cypress",
      "browser-execution-cdp",
      "browser-execution-webdriver-bidi",
      "browser-execution-appium",
    ]);
    expect(queueName("selenium")).toBe("browser-execution-selenium");
    await queue.enqueue("execution", "puppeteer");
    expect(mocks.queues[1]?.add).toHaveBeenCalledWith(
      "execute",
      { executionId: "execution" },
      { jobId: "execution" },
    );
    await expect(queue.ready()).resolves.toBe(true);
    expect(mocks.connection.ping).toHaveBeenCalled();
    await queue.close();
    expect(mocks.queues.every((item) => item.close.mock.calls.length === 1)).toBe(true);
    expect(mocks.connection.disconnect).toHaveBeenCalled();
    await expect(queue.enqueue("execution", "unknown" as never)).rejects.toThrow(
      "Queue is not configured",
    );
  });

  it("removes only cancelable waiting jobs", async () => {
    const queue = new BullMqExecutionQueue("redis://queue");
    const remove = vi.fn(async () => undefined);
    const target = mocks.queues[0];
    if (!target) throw new Error("queue fixture missing");
    target.getJob
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ getState: async () => "active", remove })
      .mockResolvedValueOnce({ getState: async () => "waiting", remove });
    await queue.cancel("missing", "playwright");
    await queue.cancel("active", "playwright");
    await queue.cancel("waiting", "playwright");
    expect(remove).toHaveBeenCalledOnce();
  });

  it("hosts a adapter worker and delegates execution", async () => {
    const execute = vi.fn(async () => undefined);
    const host = new BullMqWorkerHost("redis://worker", "selenium", { execute } as never, 4);
    const worker = mocks.workers[0];
    if (!worker) throw new Error("worker fixture missing");
    expect(worker.name).toBe("browser-execution-selenium");
    expect(worker.options).toMatchObject({ concurrency: 4 });
    await worker.processor({ data: { executionId: "execution" } });
    expect(execute).toHaveBeenCalledWith("execution");
    await host.waitUntilReady();
    expect(worker.waitUntilReady).toHaveBeenCalled();
    await host.close();
    expect(worker.close).toHaveBeenCalled();
    expect(mocks.connection.disconnect).toHaveBeenCalled();
  });
});
