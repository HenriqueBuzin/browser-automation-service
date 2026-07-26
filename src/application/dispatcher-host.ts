import type { OutboxDispatcher } from "./outbox-dispatcher.js";

export class DispatcherHost {
  #running = false;

  public constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly intervalMs: number,
    private readonly maintenance: () => Promise<unknown> = () => Promise.resolve(),
  ) {}

  public async run(signal: AbortSignal): Promise<void> {
    this.#running = true;
    while (!signal.aborted) {
      await this.dispatcher.dispatch();
      await this.maintenance();
      await wait(this.intervalMs, signal);
    }
    this.#running = false;
  }

  public get running(): boolean {
    return this.#running;
  }
}

function wait(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, durationMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
