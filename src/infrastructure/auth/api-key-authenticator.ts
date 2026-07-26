import { timingSafeEqual } from "node:crypto";
import type { AuthenticationCredentials, Authenticator } from "../../application/authenticator.js";

function equalSecret(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  return authorization.slice("Bearer ".length).trim();
}

export class ApiKeyAuthenticator implements Authenticator {
  public constructor(private readonly expected: string) {}

  public authorize(credentials: AuthenticationCredentials): Promise<boolean> {
    const received = readBearerToken(credentials.authorization) ?? credentials.apiKey;
    return Promise.resolve(received !== undefined && equalSecret(this.expected, received));
  }
}
