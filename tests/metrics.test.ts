import { describe, expect, it } from "vitest";
import { Metrics } from "../src/application/metrics.js";

describe("Metrics", () => {
  it("renders Prometheus counters and gauges", () => {
    const metrics = new Metrics();
    metrics.increment("browser_leases_requested_total");
    const output = metrics.render(2, 3);
    expect(output).toContain("browser_leases_requested_total 1");
    expect(output).toContain("browser_active_leases 2");
    expect(output).toContain("browser_queued_requests 3");
  });
});
