export type AuthenticationCredentials = {
  apiKey: string | undefined;
  authorization: string | undefined;
};

export type AuthenticationScope =
  "artifacts:read" | "capabilities:read" | "jobs:read" | "jobs:write" | "metrics:read";

export type Authenticator = {
  authorize: (
    credentials: AuthenticationCredentials,
    requiredScope: AuthenticationScope,
  ) => Promise<boolean>;
};
