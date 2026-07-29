import { metrics, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type { ExecutionRecord } from "../domain/job-state.js";

export class PlatformObservability {
  readonly #executionDuration = metrics
    .getMeter("browser-automation")
    .createHistogram("browser.execution.duration", { unit: "ms" });
  readonly #executions = metrics.getMeter("browser-automation").createCounter("browser.executions");
  readonly #jobs = metrics.getMeter("browser-automation").createCounter("browser.jobs");
  readonly #outbox = metrics.getMeter("browser-automation").createCounter("browser.outbox");
  readonly #tracer = trace.getTracer("browser-automation");

  public jobSubmitted(created: boolean): void {
    this.#jobs.add(1, { created });
  }

  public outboxPublished(status: "failed" | "published"): void {
    this.#outbox.add(1, { status });
  }

  public startExecution(execution: ExecutionRecord): {
    finish: (status: ExecutionRecord["status"], durationMs: number, error?: unknown) => void;
  } {
    const attributes = {
      "browser.name": execution.browser,
      "browser.adapter": execution.adapter,
      "execution.id": execution.id,
      "job.id": execution.jobId,
    };
    const span = this.#tracer.startSpan("browser.execution", { attributes });
    return {
      finish: (status, durationMs, error) => {
        this.#executions.add(1, { ...attributes, status });
        this.#executionDuration.record(durationMs, attributes);
        finishSpan(span, status, error);
      },
    };
  }
}

function finishSpan(span: Span, status: ExecutionRecord["status"], error?: unknown): void {
  if (error) {
    span.recordException(error instanceof Error ? error : JSON.stringify(error));
  }
  span.setStatus(
    error instanceof Error
      ? {
          code: status === "passed" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
          message: error.message,
        }
      : { code: status === "passed" ? SpanStatusCode.OK : SpanStatusCode.ERROR },
  );
  span.setAttribute("execution.status", status);
  span.end();
}
