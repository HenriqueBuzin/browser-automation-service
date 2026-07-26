import type {
  AutomationBrowser,
  AutomationEngine,
  AutomationStep,
} from "../contracts/job-contract.js";

const terminalStatuses = new Set(["passed", "partial", "failed", "canceled"]);
const fallbackStatuses = new Set([429, 502, 503, 504]);

export type AutomationRequest = {
  browsers?: readonly AutomationBrowser[];
  drivers?: readonly AutomationEngine[];
  steps: readonly AutomationStep[];
};

export type AutomationExecutionSnapshot = {
  browser: AutomationBrowser;
  driver: AutomationEngine;
  error?: { category: string; message: string; name: string };
  executionId: string;
  outputs: Record<string, boolean | number | string>;
  status: string;
};

export type AutomationJobSnapshot = {
  executions: AutomationExecutionSnapshot[];
  jobId: string;
  status: string;
};

export type AutomationAdapter = {
  execute: (request: AutomationRequest, idempotencyKey: string) => Promise<AutomationJobSnapshot>;
};

export class BrowserAutomationUnavailableError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BrowserAutomationUnavailableError";
  }
}

export class BrowserAutomationOutcomeUnknownError extends Error {
  public constructor(
    public readonly jobId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BrowserAutomationOutcomeUnknownError";
  }
}

export class BrowserAutomationResponseError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BrowserAutomationResponseError";
  }
}

export type BrowserAutomationClientOptions = {
  apiKey: string;
  baseUrl: string;
  clientId: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  resultTimeoutMs?: number;
};

export class BrowserAutomationClient implements AutomationAdapter {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #clientId: string;
  readonly #fetch: typeof fetch;
  readonly #pollIntervalMs: number;
  readonly #requestTimeoutMs: number;
  readonly #resultTimeoutMs: number;

  public constructor(options: BrowserAutomationClientOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.#clientId = options.clientId;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#pollIntervalMs = options.pollIntervalMs ?? 500;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#resultTimeoutMs = options.resultTimeoutMs ?? 120_000;
  }

  public async execute(
    request: AutomationRequest,
    idempotencyKey: string,
  ): Promise<AutomationJobSnapshot> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/v2/jobs`, {
        body: JSON.stringify(this.#body(request)),
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
          "x-api-key": this.#apiKey,
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      throw new BrowserAutomationUnavailableError(
        "Browser automation service was unavailable before accepting the job",
        { cause: error },
      );
    }

    if (!response.ok) {
      const message = await response.text();
      if (fallbackStatuses.has(response.status)) {
        throw new BrowserAutomationUnavailableError(
          `Browser automation service did not accept the job (${String(response.status)})`,
        );
      }
      throw new BrowserAutomationResponseError(response.status, message || response.statusText);
    }

    const accepted = await this.#snapshot(response);
    if (terminalStatuses.has(accepted.status)) return accepted;
    return this.#waitForResult(accepted.jobId);
  }

  #body(request: AutomationRequest) {
    return {
      ...(request.browsers?.length ? { browsers: request.browsers } : {}),
      clientId: this.#clientId,
      ...(request.drivers?.length ? { drivers: request.drivers } : {}),
      schemaVersion: 1 as const,
      steps: request.steps,
    };
  }

  async #snapshot(response: Response): Promise<AutomationJobSnapshot> {
    const value = (await response.json()) as Partial<AutomationJobSnapshot>;
    if (
      typeof value.jobId !== "string" ||
      typeof value.status !== "string" ||
      !Array.isArray(value.executions)
    ) {
      throw new BrowserAutomationResponseError(
        response.status,
        "Invalid browser automation response",
      );
    }
    return value as AutomationJobSnapshot;
  }

  async #waitForResult(jobId: string): Promise<AutomationJobSnapshot> {
    const deadline = Date.now() + this.#resultTimeoutMs;
    while (Date.now() < deadline) {
      if (this.#pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.#pollIntervalMs));
      }
      let response: Response;
      try {
        response = await this.#fetch(`${this.#baseUrl}/v2/jobs/${encodeURIComponent(jobId)}`, {
          headers: { "x-api-key": this.#apiKey },
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
        });
      } catch (error) {
        throw new BrowserAutomationOutcomeUnknownError(
          jobId,
          "The remote job was accepted, but its outcome could not be recovered",
          { cause: error },
        );
      }
      if (!response.ok) {
        throw new BrowserAutomationOutcomeUnknownError(
          jobId,
          `The remote job was accepted, but polling returned ${String(response.status)}`,
        );
      }
      const snapshot = await this.#snapshot(response);
      if (terminalStatuses.has(snapshot.status)) return snapshot;
    }
    throw new BrowserAutomationOutcomeUnknownError(
      jobId,
      "The remote job was accepted, but it did not finish before the client deadline",
    );
  }
}

export class FailoverBrowserAutomationAdapter implements AutomationAdapter {
  public constructor(
    private readonly remote: AutomationAdapter,
    private readonly local: AutomationAdapter,
  ) {}

  public async execute(
    request: AutomationRequest,
    idempotencyKey: string,
  ): Promise<AutomationJobSnapshot> {
    try {
      return await this.remote.execute(request, idempotencyKey);
    } catch (error) {
      if (error instanceof BrowserAutomationUnavailableError) {
        return this.local.execute(request, idempotencyKey);
      }
      throw error;
    }
  }
}
