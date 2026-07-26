export class CapacityError extends Error {
  public constructor(
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = "CapacityError";
  }
}

export class QueueFullError extends Error {
  public constructor() {
    super("The browser queue is full");
    this.name = "QueueFullError";
  }
}

export class QueueTimeoutError extends Error {
  public constructor() {
    super("Timed out while waiting for browser capacity");
    this.name = "QueueTimeoutError";
  }
}

export class LeaseNotFoundError extends Error {
  public constructor() {
    super("Lease not found");
    this.name = "LeaseNotFoundError";
  }
}

export class InvalidLeaseTokenError extends Error {
  public constructor() {
    super("Invalid lease token");
    this.name = "InvalidLeaseTokenError";
  }
}

export class LeaseStateError extends Error {
  public constructor() {
    super("Lease is not available for connection");
    this.name = "LeaseStateError";
  }
}

export class ServiceShuttingDownError extends Error {
  public constructor() {
    super("The service is shutting down");
    this.name = "ServiceShuttingDownError";
  }
}
