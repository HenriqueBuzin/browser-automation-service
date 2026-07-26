import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { AutomationJob } from "../contracts/job-contract.js";

export type ResolvedAddress = {
  address: string;
  family: number;
};

export type AddressLookup = (hostname: string) => Promise<ResolvedAddress[]>;

export class DestinationNotAllowedError extends Error {
  public constructor(host: string) {
    super(`Navigation to private destination '${host}' is not allowed`);
    this.name = "DestinationNotAllowedError";
  }
}

export class DestinationPolicy {
  public constructor(
    private readonly allowedHosts: readonly string[],
    private readonly resolveAddresses: AddressLookup = (hostname) =>
      lookup(hostname, { all: true, verbatim: true }),
  ) {}

  public async validate(job: AutomationJob): Promise<void> {
    const hosts = [
      ...new Set(
        job.steps
          .filter((step) => step.action === "goto" && !step.url.startsWith("data:"))
          .map((step) => new URL(step.action === "goto" ? step.url : "").hostname),
      ),
    ];
    for (const host of hosts) {
      if (this.#allowed(host)) continue;
      const addresses = isIP(host)
        ? [{ address: host, family: isIP(host) }]
        : await this.resolveAddresses(host);
      if (addresses.some((entry) => isPrivateAddress(entry.address))) {
        throw new DestinationNotAllowedError(host);
      }
    }
  }

  #allowed(host: string): boolean {
    return this.allowedHosts.some(
      (pattern) =>
        pattern === host ||
        (pattern.startsWith("*.") &&
          host.endsWith(pattern.slice(1)) &&
          host.length > pattern.length - 1),
    );
  }
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized)?.[1];
  const ipv4 = mapped ?? (isIP(normalized) === 4 ? normalized : undefined);
  if (!ipv4) return false;
  const octets = ipv4.split(".").map(Number);
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}
