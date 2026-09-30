import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Config } from "./config.js";
import { SCOPE } from "./config.js";
import { SafeError } from "./errors.js";
export interface Identity {
  issuer: string;
  subject: string;
  expiresAt: number;
  scopes: string[];
}
export type Verify = (token: string) => Promise<Identity>;
export function assertOwner(
  identity: Identity | undefined,
  config: Config,
): void {
  if (!identity || identity.expiresAt <= Date.now() / 1000)
    throw new SafeError("AUTH_REQUIRED");
  if (
    identity.issuer !== config.issuer ||
    identity.subject !== config.subject ||
    !identity.scopes.includes(SCOPE)
  )
    throw new SafeError("FORBIDDEN");
}
export function createVerifier(config: Config, key?: JWTVerifyGetKey): Verify {
  const jwks =
    key ??
    createRemoteJWKSet(
      new URL(
        ".well-known/jwks.json",
        config.issuer.endsWith("/") ? config.issuer : config.issuer + "/",
      ),
      { timeoutDuration: 5000, cooldownDuration: 30_000 },
    );
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ["RS256"],
        requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
        maxTokenAge: "15m",
      });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.exp !== "number" ||
        typeof payload.scope !== "string" ||
        typeof payload.iat !== "number" ||
        payload.exp > payload.iat + 900
      )
        throw new SafeError("AUTH_REQUIRED");
      const identity = {
        issuer: payload.iss!,
        subject: payload.sub,
        expiresAt: payload.exp,
        scopes: payload.scope.split(/\s+/),
      };
      assertOwner(identity, config);
      return identity;
    } catch (e) {
      if (e instanceof SafeError) throw e;
      throw new SafeError("AUTH_REQUIRED");
    }
  };
}
export function challenge(
  config: Config,
  error?: "invalid_token" | "insufficient_scope",
): string {
  const metadata = new URL(
    "/.well-known/oauth-protected-resource",
    config.resource,
  ).href;
  return `Bearer resource_metadata="${metadata}", scope="${SCOPE}"${error ? `, error="${error}"` : ""}`;
}
