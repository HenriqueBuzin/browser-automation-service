import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  AutomationEngine,
  AutomationProtocol,
  ProviderSession,
} from "../domain/automation-provider.js";
import {
  CapacityError,
  InvalidLeaseTokenError,
  LeaseNotFoundError,
  LeaseStateError,
  QueueFullError,
  QueueTimeoutError,
  ServiceShuttingDownError,
} from "../domain/errors.js";
import { Metrics } from "./metrics.js";
import { ProviderRegistry } from "./provider-registry.js";

type LeaseState = "starting" | "awaiting_connection" | "connecting" | "connected" | "closing";

type Lease = {
  clientId: string;
  connectTimer?: NodeJS.Timeout;
  engine: AutomationEngine;
  expiresAt: Date;
  id: string;
  lifetimeTimer?: NodeJS.Timeout;
  session?: ProviderSession;
  state: LeaseState;
  token: string;
};

type PendingRequest = {
  clientId: string;
  engine: AutomationEngine;
  reject: (reason: Error) => void;
  resolve: (lease: LeaseGrant) => void;
  timer: NodeJS.Timeout;
};

export type LeaseGrant = {
  directEndpoint?: string;
  engine: AutomationEngine;
  expiresAt: Date;
  id: string;
  protocol: AutomationProtocol;
  token: string;
};

export type LeaseConnection = {
  id: string;
  protocol: Exclude<AutomationProtocol, "webdriver">;
  wsEndpoint: string;
};

export type LeaseManagerOptions = {
  connectionTimeoutMs: number;
  maxLeaseDurationMs: number;
  maxConcurrent: number;
  maxQueueSize: number;
  metrics: Metrics;
};

export class LeaseManager {
  readonly #leases = new Map<string, Lease>();
  readonly #options: LeaseManagerOptions;
  readonly #providers: ProviderRegistry;
  readonly #queue: PendingRequest[] = [];
  #shuttingDown = false;

  public constructor(providers: ProviderRegistry, options: LeaseManagerOptions) {
    this.#providers = providers;
    this.#options = options;
  }

  public get activeCount(): number {
    return this.#leases.size;
  }

  public get queuedCount(): number {
    return this.#queue.length;
  }

  public async request(
    clientId: string,
    engine: AutomationEngine,
    waitTimeoutMs: number,
  ): Promise<LeaseGrant> {
    this.#options.metrics.increment("browser_leases_requested_total");
    if (this.#shuttingDown) throw new ServiceShuttingDownError();
    if (this.#leases.size < this.#options.maxConcurrent) return this.#allocate(clientId, engine);
    if (waitTimeoutMs === 0) throw new CapacityError("No browser capacity is available", 1);
    if (this.#queue.length >= this.#options.maxQueueSize) {
      this.#options.metrics.increment("browser_queue_rejections_total");
      throw new QueueFullError();
    }

    return new Promise<LeaseGrant>((resolve, reject) => {
      const pending: PendingRequest = {
        clientId,
        engine,
        reject,
        resolve,
        timer: setTimeout(() => {
          const index = this.#queue.indexOf(pending);
          if (index >= 0) this.#queue.splice(index, 1);
          this.#options.metrics.increment("browser_queue_timeouts_total");
          reject(new QueueTimeoutError());
        }, waitTimeoutMs),
      };
      this.#queue.push(pending);
    });
  }

  public connect(id: string, token: string): LeaseConnection {
    const lease = this.#getAuthorized(id, token);
    if (
      lease.state !== "awaiting_connection" ||
      !lease.session ||
      lease.session.protocol === "webdriver"
    ) {
      throw new LeaseStateError();
    }
    if (lease.connectTimer) clearTimeout(lease.connectTimer);
    lease.state = "connecting";
    return { id, protocol: lease.session.protocol, wsEndpoint: lease.session.endpoint };
  }

  public markConnected(id: string): void {
    const lease = this.#leases.get(id);
    if (lease?.state !== "connecting") throw new LeaseStateError();
    lease.state = "connected";
    this.#options.metrics.increment("browser_connections_total");
  }

  public async release(id: string): Promise<boolean> {
    const lease = this.#leases.get(id);
    if (!lease || lease.state === "closing") return false;
    lease.state = "closing";
    this.#leases.delete(id);
    if (lease.connectTimer) clearTimeout(lease.connectTimer);
    if (lease.lifetimeTimer) clearTimeout(lease.lifetimeTimer);
    try {
      await lease.session?.close();
    } finally {
      this.#options.metrics.increment("browser_leases_closed_total");
      this.#drainQueue();
    }
    return true;
  }

  public async releaseAuthorized(id: string, token: string): Promise<boolean> {
    this.#getAuthorized(id, token);
    return this.release(id);
  }

  public async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    for (const pending of this.#queue.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new ServiceShuttingDownError());
    }
    await Promise.allSettled([...this.#leases.keys()].map((id) => this.release(id)));
  }

  async #allocate(clientId: string, engine: AutomationEngine): Promise<LeaseGrant> {
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.#options.maxLeaseDurationMs);
    const lease: Lease = { clientId, engine, expiresAt, id, state: "starting", token };
    this.#leases.set(id, lease);

    try {
      const session = await this.#providers.get(engine).launch(id);
      lease.session = session;
      lease.state = session.protocol === "webdriver" ? "connected" : "awaiting_connection";
      session.onClose(() => void this.release(id));
      lease.lifetimeTimer = setTimeout(
        () => void this.release(id),
        this.#options.maxLeaseDurationMs,
      );
      if (session.protocol !== "webdriver") {
        lease.connectTimer = setTimeout(
          () => void this.release(id),
          this.#options.connectionTimeoutMs,
        );
      }
      this.#options.metrics.increment("browser_leases_granted_total");
      return {
        ...(session.protocol === "webdriver" ? { directEndpoint: session.endpoint } : {}),
        engine,
        expiresAt,
        id,
        protocol: session.protocol,
        token,
      };
    } catch (error) {
      this.#leases.delete(id);
      this.#options.metrics.increment("browser_launch_failures_total");
      this.#drainQueue();
      throw error;
    }
  }

  #drainQueue(): void {
    if (this.#shuttingDown || this.#leases.size >= this.#options.maxConcurrent) return;
    const pending = this.#queue.shift();
    if (!pending) return;
    clearTimeout(pending.timer);
    void this.#allocate(pending.clientId, pending.engine).then(pending.resolve, pending.reject);
  }

  #getAuthorized(id: string, token: string): Lease {
    const lease = this.#leases.get(id);
    if (!lease) throw new LeaseNotFoundError();
    const expected = Buffer.from(lease.token);
    const received = Buffer.from(token);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new InvalidLeaseTokenError();
    }
    return lease;
  }
}
