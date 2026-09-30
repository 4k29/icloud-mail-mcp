import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createVerifier } from "../src/auth.js";
import { loadConfig, type Config } from "../src/config.js";
export const config: Config = {
  mode: "mock",
  port: 8080,
  resource: "https://mail.example.invalid/mcp",
  issuer: "https://issuer.example.invalid/",
  subject: "owner",
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: ReturnType<typeof createVerifier>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test";
  verify = createVerifier(config, createLocalJWKSet({ keys: [jwk] }));
});
async function token(
  options: {
    subject?: string;
    issuer?: string;
    audience?: string;
    scope?: string;
    exp?: number;
    iat?: number;
    missingExp?: boolean;
  } = {},
) {
  let jwt = new SignJWT({ scope: options.scope ?? "mail:read" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(options.issuer ?? config.issuer)
    .setAudience(options.audience ?? config.resource)
    .setSubject(options.subject ?? config.subject)
    .setIssuedAt(options.iat ?? Math.floor(Date.now() / 1000));
  if (!options.missingExp)
    jwt = jwt.setExpirationTime(
      options.exp ?? Math.floor(Date.now() / 1000) + 300,
    );
  return jwt.sign(keys.privateKey);
}
describe("JWT resource server", () => {
  it("accepts only owner", async () => {
    expect((await verify(await token())).subject).toBe("owner");
  });
  it.each([
    { subject: "stranger" },
    { scope: "other" },
    { issuer: "https://wrong.invalid/" },
    { audience: "other" },
    { exp: 1 },
    { missingExp: true },
    { iat: 1 },
    { exp: Math.floor(Date.now() / 1000) + 3600 },
  ])("rejects invalid claims %j", async (opts) => {
    await expect(verify(await token(opts))).rejects.toThrow();
  });
  it("rejects malformed and forged signatures without echoing token", async () => {
    const secret = "dummy-sensitive-marker";
    await expect(verify(secret)).rejects.toThrow("OAuth認証が必要");
    const other = await generateKeyPair("RS256");
    const bad = await new SignJWT({ scope: "mail:read" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(config.issuer)
      .setSubject("owner")
      .setAudience(config.resource)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    await expect(verify(bad)).rejects.toThrow("OAuth認証が必要");
  });
});
describe("startup fail closed", () => {
  const env = {
    PUBLIC_URL: config.resource,
    OAUTH_ISSUER: config.issuer,
    OAUTH_ALLOWED_SUBJECT: "owner",
    ICLOUD_IMAP_USERNAME: "dummy",
    ICLOUD_APP_PASSWORD: "dummy",
  };
  it("requires auth and iCloud settings; errors never expose secret", () => {
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ ...env, OAUTH_ALLOWED_SUBJECT: "" })).toThrow();
    expect(() =>
      loadConfig({ ...env, ICLOUD_APP_PASSWORD: undefined }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...env, MAIL_MODE: "mock", NODE_ENV: "production" }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...env, PUBLIC_URL: "http://unsafe.invalid/mcp" }),
    ).toThrow();
    expect(Object.isFrozen(loadConfig(env))).toBe(true);
  });
});
