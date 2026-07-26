import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import packageJson from "../../package.json" with { type: "json" };
import type { AuthenticationScope, Authenticator } from "../application/authenticator.js";
import {
  automationBrowsers,
  automationEngines,
  type AutomationBrowser,
  type AutomationEngine,
} from "../domain/automation-provider.js";
import type { AppConfig } from "../config.js";
import {
  CapacityError,
  InvalidLeaseTokenError,
  LeaseNotFoundError,
  LeaseStateError,
  QueueFullError,
  QueueTimeoutError,
  ServiceShuttingDownError,
} from "../domain/errors.js";
import type { LeaseManager } from "../application/lease-manager.js";
import type { MatrixJobRunner } from "../application/matrix-job-runner.js";
import type { Metrics } from "../application/metrics.js";
import {
  ProviderNotAvailableError,
  type ProviderRegistry,
} from "../application/provider-registry.js";
import { BrowserNotSupportedError } from "../application/provider-registry.js";
import { parseAutomationJob } from "./job-parser.js";

type CreateLeaseBody = {
  browser?: unknown;
  clientId?: unknown;
  engine?: unknown;
  waitTimeoutMs?: unknown;
};

type ServerDependencies = {
  authenticator: Authenticator;
  config: AppConfig;
  leaseManager: LeaseManager;
  matrixJobRunner: MatrixJobRunner;
  metrics: Metrics;
  metricsAuthenticator: Authenticator;
  providers: ProviderRegistry;
};

function errorStatus(error: unknown): number {
  if (error instanceof CapacityError || error instanceof QueueFullError) return 429;
  if (error instanceof QueueTimeoutError) return 408;
  if (error instanceof ServiceShuttingDownError) return 503;
  return 500;
}

function parseClientId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/u.test(value)) {
    throw new TypeError("clientId must contain 2-64 letters, numbers, dots, underscores or dashes");
  }
  return value;
}

function parseEngine(value: unknown): AutomationEngine {
  if (typeof value !== "string" || !automationEngines.includes(value as AutomationEngine)) {
    throw new TypeError(`engine must be one of: ${automationEngines.join(", ")}`);
  }
  return value as AutomationEngine;
}

function parseBrowser(value: unknown): AutomationBrowser {
  if (typeof value !== "string" || !automationBrowsers.includes(value as AutomationBrowser)) {
    throw new TypeError(`browser must be one of: ${automationBrowsers.join(", ")}`);
  }
  return value as AutomationBrowser;
}

function parseWaitTimeout(value: unknown, maximum: number): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new TypeError(`waitTimeoutMs must be an integer between 0 and ${String(maximum)}`);
  }
  return Number(value);
}

function websocketBaseUrl(request: FastifyRequest, configured?: string): string {
  if (configured) return configured;
  const forwarded = request.headers["x-forwarded-proto"];
  const protocol = forwarded === "https" ? "wss" : "ws";
  return `${protocol}://${request.headers.host ?? "localhost"}`;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  socket.end(
    `HTTP/1.1 ${String(status)} ${status === 401 ? "Unauthorized" : "Bad Request"}\r\n` +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${String(Buffer.byteLength(body))}\r\n` +
      "Connection: close\r\n\r\n" +
      body,
  );
}

export function buildServer({
  authenticator,
  config,
  leaseManager,
  matrixJobRunner,
  metrics,
  metricsAuthenticator,
  providers,
}: ServerDependencies): FastifyInstance {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
  });
  const websocketServer = new WebSocketServer({ noServer: true });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/v1/engines", async (request, reply) => {
    if (!(await authorize(authenticator, request, "engines:read"))) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return { capabilities: providers.capabilities(), engines: providers.engines() };
  });
  app.get("/health/ready", async (_request, reply) => {
    if (leaseManager.activeCount > config.maxConcurrentBrowsers) {
      return reply.code(503).send({ status: "not_ready" });
    }
    return { status: "ready" };
  });

  app.get("/metrics", async (request, reply) => {
    if (!(await authorize(metricsAuthenticator, request, "metrics:read"))) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return reply
      .type("text/plain; version=0.0.4")
      .send(metrics.render(leaseManager.activeCount, leaseManager.queuedCount));
  });

  app.post<{ Body: unknown }>("/v1/jobs/run", async (request, reply) => {
    if (!(await authorize(authenticator, request, "jobs:run"))) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    try {
      const job = parseAutomationJob(request.body);
      return await matrixJobRunner.run(job);
    } catch (error) {
      if (error instanceof TypeError) return reply.code(400).send({ error: error.message });
      request.log.error({ error }, "matrix job failed");
      return reply
        .code(500)
        .send({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.post<{ Body: CreateLeaseBody | undefined }>("/v1/leases", async (request, reply) => {
    if (!(await authorize(authenticator, request, "leases:write"))) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    try {
      const clientId = parseClientId(request.body?.clientId);
      const engine = parseEngine(request.body?.engine);
      const browser = parseBrowser(request.body?.browser);
      if (engine === "puppeteer" && browser === "firefox") {
        return reply.code(422).send({
          error:
            "Puppeteer/Firefox is available through /v1/jobs/run but does not support reconnectable native leases",
        });
      }
      const waitTimeoutMs = parseWaitTimeout(request.body?.waitTimeoutMs, config.maxQueueWaitMs);
      const lease = await leaseManager.request(clientId, engine, browser, waitTimeoutMs);
      const connection =
        lease.protocol === "webdriver"
          ? { endpoint: lease.directEndpoint, protocol: lease.protocol }
          : {
              endpoint: `${websocketBaseUrl(request, config.publicWsUrl)}/v1/leases/${lease.id}/connect?token=${encodeURIComponent(lease.token)}`,
              protocol: lease.protocol,
            };
      return reply.code(201).send({
        connection,
        browser: lease.browser,
        engine: lease.engine,
        expiresAt: lease.expiresAt.toISOString(),
        leaseId: lease.id,
        leaseToken: lease.token,
        versions: {
          playwright: packageJson.dependencies.playwright,
          puppeteer: packageJson.dependencies["puppeteer-core"],
          selenium: packageJson.dependencies["selenium-webdriver"],
        },
      });
    } catch (error) {
      if (error instanceof TypeError) return reply.code(400).send({ error: error.message });
      if (error instanceof ProviderNotAvailableError || error instanceof BrowserNotSupportedError) {
        return reply.code(422).send({ error: error.message });
      }
      const status = errorStatus(error);
      if (error instanceof CapacityError) reply.header("retry-after", error.retryAfterSeconds);
      request.log.warn({ error, status }, "lease request failed");
      return reply
        .code(status)
        .send({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  app.delete<{ Params: { id: string }; Querystring: { token?: string } }>(
    "/v1/leases/:id",
    async (request, reply) => {
      if (!(await authorize(authenticator, request, "leases:write"))) {
        return reply.code(401).send({ error: "Unauthorized" });
      }
      try {
        const token = request.query.token;
        if (!token) return reply.code(400).send({ error: "token is required" });
        await leaseManager.releaseAuthorized(request.params.id, token);
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof LeaseNotFoundError)
          return reply.code(404).send({ error: error.message });
        if (error instanceof InvalidLeaseTokenError) {
          return reply.code(401).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.server.on("upgrade", (request, socket, head) => {
    void handleUpgrade(request, socket, head);
  });

  async function handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let leaseId: string | undefined;
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const match = /^\/v1\/leases\/([^/]+)\/connect$/u.exec(url.pathname);
      if (!match?.[1]) return rejectUpgrade(socket, 404, "WebSocket endpoint not found");
      leaseId = decodeURIComponent(match[1]);
      const token = url.searchParams.get("token");
      if (!token) return rejectUpgrade(socket, 401, "Lease token is required");
      const connection = leaseManager.connect(leaseId, token);
      const upstream = new WebSocket(connection.wsEndpoint);

      upstream.once("open", () => {
        websocketServer.handleUpgrade(request, socket, head, (client) => {
          leaseManager.markConnected(connection.id);
          bridgeWebSockets(client, upstream, () => void leaseManager.release(connection.id));
        });
      });
      upstream.once("error", (error) => {
        app.log.error({ error, leaseId }, "browser websocket connection failed");
        rejectUpgrade(socket, 502, "Could not connect to browser");
        void leaseManager.release(connection.id);
      });
    } catch (error) {
      const status =
        error instanceof InvalidLeaseTokenError
          ? 401
          : error instanceof LeaseNotFoundError
            ? 404
            : error instanceof LeaseStateError
              ? 409
              : 500;
      app.log.warn({ error, leaseId, status }, "websocket upgrade rejected");
      rejectUpgrade(socket, status, error instanceof Error ? error.message : "Upgrade failed");
    }
  }

  return app;
}

function authorize(
  authenticator: Authenticator,
  request: FastifyRequest,
  scope: AuthenticationScope,
): Promise<boolean> {
  return authenticator.authorize(
    {
      apiKey: request.headers["x-api-key"] as string | undefined,
      authorization: request.headers.authorization,
    },
    scope,
  );
}

function bridgeWebSockets(client: WebSocket, upstream: WebSocket, onClose: () => void): void {
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    if (client.readyState === WebSocket.OPEN) client.close();
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
    onClose();
  };
  client.on("message", (data, binary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
  });
  upstream.on("message", (data, binary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
  });
  client.once("close", finish);
  client.once("error", finish);
  upstream.once("close", finish);
  upstream.once("error", finish);
}
