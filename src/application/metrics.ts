type CounterName =
  | "browser_connections_total"
  | "browser_launch_failures_total"
  | "browser_leases_closed_total"
  | "browser_leases_granted_total"
  | "browser_leases_requested_total"
  | "browser_queue_rejections_total"
  | "browser_queue_timeouts_total";

const descriptions: Record<CounterName, string> = {
  browser_connections_total: "WebSocket browser connections established.",
  browser_launch_failures_total: "Browser processes that failed to launch.",
  browser_leases_closed_total: "Browser leases closed for any reason.",
  browser_leases_granted_total: "Browser leases successfully granted.",
  browser_leases_requested_total: "Browser lease requests received.",
  browser_queue_rejections_total: "Lease requests rejected because the queue was full.",
  browser_queue_timeouts_total: "Lease requests that timed out in the queue.",
};

export class Metrics {
  readonly #counters = new Map<CounterName, number>();

  public increment(name: CounterName): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + 1);
  }

  public render(active: number, queued: number): string {
    const lines: string[] = [];
    for (const [name, description] of Object.entries(descriptions) as [CounterName, string][]) {
      lines.push(`# HELP ${name} ${description}`, `# TYPE ${name} counter`);
      lines.push(`${name} ${String(this.#counters.get(name) ?? 0)}`);
    }
    lines.push(
      "# HELP browser_active_leases Current browser processes reserved or connected.",
      "# TYPE browser_active_leases gauge",
      `browser_active_leases ${String(active)}`,
      "# HELP browser_queued_requests Current lease requests waiting for capacity.",
      "# TYPE browser_queued_requests gauge",
      `browser_queued_requests ${String(queued)}`,
      "",
    );
    return lines.join("\n");
  }
}
