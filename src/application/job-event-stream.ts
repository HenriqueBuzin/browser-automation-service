export type JobSnapshot = {
  status: string;
  updatedAt: string;
};

const terminalStatuses = new Set(["passed", "partial", "failed", "canceled"]);

export async function streamJobEvents<T extends JobSnapshot>(options: {
  heartbeatMs: number;
  lastEventId?: string;
  load: () => Promise<T | undefined>;
  pollMs: number;
  signal: AbortSignal;
  write: (chunk: string) => void;
}): Promise<"closed" | "missing" | "terminal"> {
  let lastEventId = options.lastEventId;
  let lastWriteAt = Date.now();
  while (!options.signal.aborted) {
    const snapshot = await options.load();
    if (!snapshot) return "missing";
    const eventId = snapshot.updatedAt;
    if (eventId !== lastEventId) {
      options.write(`id: ${eventId}\nevent: job\ndata: ${JSON.stringify(snapshot)}\n\n`);
      lastEventId = eventId;
      lastWriteAt = Date.now();
    }
    if (terminalStatuses.has(snapshot.status)) return "terminal";
    if (Date.now() - lastWriteAt >= options.heartbeatMs) {
      options.write(": heartbeat\n\n");
      lastWriteAt = Date.now();
    }
    await wait(options.pollMs, options.signal);
  }
  return "closed";
}

function wait(durationMs: number, signal: AbortSignal): Promise<void> {
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
