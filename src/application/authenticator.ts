export type AuthenticationCredentials = {
  apiKey: string | undefined;
  authorization: string | undefined;
};

export type AuthenticationScope = "engines:read" | "jobs:run" | "leases:write" | "metrics:read";

export type Authenticator = {
  authorize: (
    credentials: AuthenticationCredentials,
    requiredScope: AuthenticationScope,
  ) => Promise<boolean>;
};
