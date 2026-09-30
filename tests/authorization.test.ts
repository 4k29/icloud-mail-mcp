import { expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcp } from "../src/server.js";
import { mockState, MockSession } from "../src/mock.js";
import { MailService } from "../src/mail.js";
import { SafeError } from "../src/errors.js";
it("reauthorizes every tool invocation and supplies tool-level OAuth challenge", async () => {
  const config = {
    mode: "mock" as const,
    port: 8080,
    resource: "https://mail.example.invalid/mcp",
    issuer: "https://issuer.example.invalid/",
    subject: "owner",
  };
  const state = await mockState();
  let expiresAt = Date.now() / 1000 + 300;
  const verify = vi.fn(async () => ({
    issuer: config.issuer,
    subject: config.subject,
    expiresAt,
    scopes: ["mail:read"],
  }));
  const mcp = buildMcp(
    config,
    new MailService(() => new MockSession(state)),
    verify,
    "dummy-token",
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "auth-test", version: "1.0" });
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    expect(
      (await client.callTool({ name: "list_mailboxes", arguments: {} }))
        .isError,
    ).not.toBe(true);
    expiresAt = 1;
    const rejected = await client.callTool({
      name: "search_messages",
      arguments: { mailbox: "INBOX" },
    });
    expect(rejected.isError).toBe(true);
    expect(rejected._meta?.["mcp/www_authenticate"]).toEqual([
      expect.stringContaining("invalid_token"),
    ]);
    expect(state.opens).toBe(0);
    expect(verify).toHaveBeenCalledTimes(2);
  } finally {
    await client.close();
    await mcp.close();
  }
});
it("enforces aggregate body budget before returning private body data", async () => {
  const state = await mockState();
  state.texts.set(3, "x".repeat(1_048_577));
  const mail = new MailService(() => new MockSession(state));
  const { messageId } = await import("../src/identifiers.js");
  await expect(
    mail.get({
      message_id: messageId("INBOX", "123", 3),
      offset: 0,
      length: 8000,
    }),
  ).rejects.toEqual(new SafeError("BODY_TOO_LARGE"));
  expect(state.closes).toBe(1);
});
