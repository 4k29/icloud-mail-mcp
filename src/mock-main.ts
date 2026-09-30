import { writeFile, unlink } from "node:fs/promises";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createVerifier } from "./auth.js";
import { MailService } from "./mail.js";
import { mockState, MockSession } from "./mock.js";
import { createApp } from "./server.js";
// Dedicated local entry point, fixed loopback and synthetic mail; no route can switch modes.
if (process.env.NODE_ENV === "production")
  throw new Error("本番でローカルモックは起動できません。");
const config = Object.freeze({
  mode: "mock" as const,
  port: 8080,
  resource: "http://127.0.0.1:8080/mcp",
  issuer: "https://mock.example.invalid/",
  subject: "mock-owner",
});
const keys = await generateKeyPair("RS256");
const jwk = await exportJWK(keys.publicKey);
jwk.kid = "local-mock";
const token = await new SignJWT({ scope: "mail:read" })
  .setProtectedHeader({ alg: "RS256", kid: "local-mock" })
  .setIssuer(config.issuer)
  .setAudience(config.resource)
  .setSubject(config.subject)
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(keys.privateKey);
await unlink(".mock-token").catch((error: NodeJS.ErrnoException) => {
  if (error.code !== "ENOENT") throw error;
});
await writeFile(".mock-token", token, { mode: 0o600, flag: "wx" });
const state = await mockState();
const app = createApp(
  config,
  new MailService(() => new MockSession(state)),
  createVerifier(config, createLocalJWKSet({ keys: [jwk] })),
);
const server = app.listen(config.port, "127.0.0.1", () =>
  console.info(
    "ローカルモック: http://127.0.0.1:8080/mcp（実メール接続なし）。トークンは .mock-token に保存、15分で期限切れ。",
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    server.close();
    void unlink(".mock-token").finally(() => process.exit(0));
  });
