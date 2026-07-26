import { describe, expect, it } from "vitest";
import {
  ApiKeyAuthenticator,
  readBearerToken,
} from "../src/infrastructure/auth/api-key-authenticator.js";

describe("authentication", () => {
  it("reads a bearer token", () => {
    expect(readBearerToken("Bearer secret")).toBe("secret");
    expect(readBearerToken("Basic secret")).toBeUndefined();
  });

  it("accepts bearer or API key and rejects invalid values", async () => {
    const authenticator = new ApiKeyAuthenticator("secret");
    await expect(
      authenticator.authorize({ apiKey: undefined, authorization: "Bearer secret" }),
    ).resolves.toBe(true);
    await expect(
      authenticator.authorize({ apiKey: "secret", authorization: undefined }),
    ).resolves.toBe(true);
    await expect(
      authenticator.authorize({ apiKey: undefined, authorization: "Bearer wrong" }),
    ).resolves.toBe(false);
    await expect(
      authenticator.authorize({ apiKey: undefined, authorization: undefined }),
    ).resolves.toBe(false);
  });
});
