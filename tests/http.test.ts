import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createServer, type Server } from "node:http";
import type { Express } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/server.js";
import { createVerifier } from "../src/auth.js";
import { MailService, type ReadSession } from "../src/mail.js";
import { mockState, MockSession, type MockState } from "../src/mock.js";
import type { Config } from "../src/config.js";
let server: Server;
let url: string;
let token: string;
let expired: string;
let stranger: string;
let state: MockState;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let config: Config;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test";
  state = await mockState();
  config = {
    mode: "mock",
    port: 0,
    resource: "http://127.0.0.1:0/mcp",
    issuer: "https://mock.example.invalid/",
    subject: "owner",
  };
  let app: Express;
  server = createServer((req, res) => app(req, res));
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error();
  url = `http://127.0.0.1:${addr.port}/mcp`;
  config.resource = url;
  app = createApp(
    config,
    new MailService(() => new MockSession(state)),
    createVerifier(config, createLocalJWKSet({ keys: [jwk] })),
  );
  async function sign(subject: string, exp: number) {
    return new SignJWT({ scope: "mail:read" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(config.issuer)
      .setAudience(url)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(keys.privateKey);
  }
  token = await sign("owner", Math.floor(Date.now() / 1000) + 300);
  expired = await sign("owner", 1);
  stranger = await sign("stranger", Math.floor(Date.now() / 1000) + 300);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function post(
  t?: string,
  body: unknown = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "list_mailboxes", arguments: {} },
  },
  headers: Record<string, string> = {},
) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
describe("HTTP MCP", () => {
  it("publishes protected-resource discovery and challenges anonymous requests", async () => {
    const r = await fetch(
      new URL("/.well-known/oauth-protected-resource/mcp", url),
    );
    expect((await r.json()).resource).toBe(url);
    const before = state.opens;
    const no = await post();
    expect(no.status).toBe(401);
    expect(no.headers.get("www-authenticate")).toContain("resource_metadata");
    expect(state.opens).toBe(before);
  });
  it("rejects invalid, expired and unauthorized user tokens before mail access", async () => {
    expect((await post("invalid")).status).toBe(401);
    expect((await post(expired)).status).toBe(401);
    expect((await post(stranger)).status).toBe(403);
  });
  it("runs initialize, tools/list, tools/call through the official HTTP client", async () => {
    const client = new Client({ name: "integration-test", version: "1.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual([
      "list_mailboxes",
      "search_messages",
      "get_message",
    ]);
    for (const t of tools.tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t._meta?.securitySchemes).toEqual([
        { type: "oauth2", scopes: ["mail:read"] },
      ]);
    }
    // The standard SDK client strips unknown top-level extensions; inspect the HTTP wire too.
    const rawTools = await post(token, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/list",
      params: {},
    });
    for (const tool of (await rawTools.json()).result.tools)
      expect(tool.securitySchemes).toEqual([
        { type: "oauth2", scopes: ["mail:read"] },
      ]);
    const result = await client.callTool({
      name: "search_messages",
      arguments: { mailbox: "INBOX", subject: "日本語" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      messages: [{ subject: "日本語のメール" }],
    });
    await client.close();
  });
  it("rejects foreign Origin, unknown tools and arbitrary host arguments", async () => {
    expect(
      (await post(token, undefined, { origin: "https://attacker.invalid" }))
        .status,
    ).toBe(403);
    const r = await post(token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "search_messages",
        arguments: { mailbox: "INBOX", host: "attacker.invalid" },
      },
    });
    expect((await r.json()).result.isError).toBe(true);
    const wrong = await post(token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "send_mail", arguments: {} },
    });
    expect((await wrong.json()).result.isError).toBe(true);
  });
  it("sanitizes backend exceptions and never logs their contents", async () => {
    const marker = "dummy-secret-and-private-body";
    const spy = vi.spyOn(console, "error");
    const log = vi.spyOn(console, "log");
    const failing = {
      list: async () => {
        throw new Error(marker);
      },
      close: () => {},
    } as unknown as ReadSession;
    const app = createApp(config, new MailService(() => failing), async () => ({
      issuer: config.issuer,
      subject: "owner",
      expiresAt: Date.now() / 1000 + 300,
      scopes: ["mail:read"],
    }));
    const local = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => local.once("listening", r));
    const addr = local.address();
    if (!addr || typeof addr === "string") throw new Error();
    const old = config.resource;
    config.resource = `http://127.0.0.1:${addr.port}/mcp`;
    try {
      const r = await fetch(config.resource, {
        method: "POST",
        headers: {
          authorization: "Bearer dummy",
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "list_mailboxes", arguments: {} },
        }),
      });
      const text = await r.text();
      expect(text).not.toContain(marker);
      expect(text).toContain("INTERNAL");
      expect(spy).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      config.resource = old;
      local.closeAllConnections();
      await new Promise<void>((r) => local.close(() => r()));
      spy.mockRestore();
      log.mockRestore();
    }
  });
});
