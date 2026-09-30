import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, type Server, type TLSSocket } from "node:tls";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { ICloudSession, imapOptions } from "../src/imap.js";
import { MailService } from "../src/mail.js";
import { getSchema, searchSchema } from "../src/schemas.js";
import { messageId } from "../src/identifiers.js";
import type { Config } from "../src/config.js";
const config: Config = {
  mode: "icloud",
  port: 8080,
  resource: "https://mail.example.invalid/mcp",
  issuer: "https://issuer.example.invalid/",
  subject: "owner",
  username: "dummy-user",
  password: "dummy-app-password",
};
let server: Server;
let directory: string;
let ca: Buffer;
let port: number;
let commands: string[];
let seen: boolean;
let authFail: boolean;
let stall: boolean;
let validity: number;
let live: Set<TLSSocket>;
const plain = "日本語 MIME テスト\r\n";
const encoded = Buffer.from(plain).toString("base64");
const headers =
  "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
const subject = Buffer.from("日本語のメール").toString("base64");
const structure = `("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "BASE64" ${encoded.length} 1 NIL NIL NIL NIL)`;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "icloud-imap-test-"));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  ca = readFileSync(join(directory, "cert.pem"));
  live = new Set();
  server = createServer(
    { key: readFileSync(join(directory, "key.pem")), cert: ca },
    (socket) => {
      live.add(socket);
      socket.on("close", () => live.delete(socket));
      socket.on("error", () => {});
      socket.write("* OK synthetic IMAP ready\r\n");
      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString();
        let end: number;
        while ((end = buffer.indexOf("\r\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const tag = line.split(" ")[0]!;
          const cmd = line.slice(tag.length + 1);
          const upper = cmd.toUpperCase();
          // Do not record LOGIN arguments, even though these are dummy credentials.
          commands.push(upper.startsWith("LOGIN") ? "LOGIN" : cmd);
          const ok = () => socket.write(`${tag} OK complete\r\n`);
          if (upper.startsWith("CAPABILITY")) {
            socket.write("* CAPABILITY IMAP4rev1\r\n");
            ok();
          } else if (upper.startsWith("LOGIN")) {
            if (authFail)
              socket.write(
                `${tag} NO [AUTHENTICATIONFAILED] dummy-sensitive-server-error\r\n`,
              );
            else ok();
          } else if (upper.startsWith("LIST")) {
            socket.write(
              `* LIST () "/" ${upper.endsWith('""') ? '""' : '"INBOX"'}\r\n`,
            );
            ok();
          } else if (
            upper.startsWith("EXAMINE") ||
            upper.startsWith("SELECT")
          ) {
            socket.write(
              `* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY ${validity}] valid\r\n* OK [UIDNEXT 2] next\r\n${tag} OK [${upper.startsWith("EXAMINE") ? "READ-ONLY" : "READ-WRITE"}] selected\r\n`,
            );
          } else if (upper.startsWith("UID SEARCH")) {
            socket.write("* SEARCH 1\r\n");
            ok();
          } else if (upper.startsWith("UID FETCH")) {
            if (stall) continue;
            if (/BODY\[|STORE/i.test(cmd)) seen = true;
            const fields = [
              `UID 1`,
              `FLAGS (${seen ? "\\Seen" : ""})`,
              `INTERNALDATE "30-Sep-2026 09:00:00 +0000"`,
              `RFC822.SIZE ${encoded.length}`,
              `ENVELOPE ("Wed, 30 Sep 2026 09:00:00 +0000" "=?UTF-8?B?${subject}?=" ((NIL NIL "sender" "example.invalid")) NIL NIL ((NIL NIL "owner" "example.invalid")) NIL NIL NIL "<wire@example.invalid>")`,
              `BODYSTRUCTURE ${structure}`,
            ];
            let response = `* 1 FETCH (${fields.join(" ")}`;
            for (const match of cmd.matchAll(
              /BODY\.PEEK\[([^\]]+)\](?:<(\d+)\.(\d+)>)?/gi,
            )) {
              const section = match[1]!;
              const value =
                section.toUpperCase().startsWith("HEADER") ||
                section.endsWith(".MIME")
                  ? headers
                  : encoded;
              const start = Number(match[2] ?? 0);
              const content = match[3]
                ? value.slice(start, start + Number(match[3]))
                : value;
              response += ` BODY[${section}]${match[2] !== undefined ? `<${start}>` : ""} {${Buffer.byteLength(content)}}\r\n${content}`;
            }
            socket.write(response + ")\r\n");
            ok();
          } else if (upper.startsWith("LOGOUT")) {
            socket.write(`* BYE\r\n${tag} OK logout\r\n`);
            socket.end();
          } else ok();
        }
      });
    },
  );
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error();
  port = addr.port;
});
beforeEach(() => {
  commands = [];
  seen = false;
  authFail = false;
  stall = false;
  validity = 321;
});
afterAll(async () => {
  for (const socket of live) socket.destroy();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(directory, { recursive: true, force: true });
});
function session() {
  return new ICloudSession(config, (options) => {
    // Only test injection changes the destination; certificate validation remains enabled.
    expect(options.host).toBe("imap.mail.me.com");
    expect(options.secure).toBe(true);
    expect(options.tls?.rejectUnauthorized).toBe(true);
    return new ImapFlow({
      ...options,
      host: "127.0.0.1",
      port,
      tls: { ...options.tls, ca, servername: "localhost" },
      connectionTimeout: 1000,
      socketTimeout: 1000,
    });
  });
}
async function disconnected() {
  await vi.waitFor(() => expect(live.size).toBe(0), { timeout: 2000 });
}
describe("actual ImapFlow against TLS IMAP mock", () => {
  it("uses EXAMINE, UID FETCH and BODY.PEEK; decodes MIME without marking read", async () => {
    const mail = new MailService(session);
    const found = await mail.search(searchSchema.parse({ mailbox: "INBOX" }));
    expect(found.messages[0]?.subject).toBe("日本語のメール");
    const r = await mail.get(
      getSchema.parse({ message_id: found.messages[0]!.message_id }),
    );
    expect(r.body).toBe(plain);
    expect(seen).toBe(false);
    expect(commands.some((c) => c.startsWith("EXAMINE"))).toBe(true);
    expect(commands.some((c) => c.includes("BODY.PEEK[TEXT]"))).toBe(true);
    expect(
      commands.some((c) => /^(SELECT|STORE|APPEND|EXPUNGE|MOVE|COPY)/i.test(c)),
    ).toBe(false);
    await disconnected();
  });
  it("sanitizes IMAP authentication failures and releases connection", async () => {
    authFail = true;
    const spy = vi.spyOn(console, "error");
    await expect(
      new MailService(session).list({ offset: 0, limit: 1 }),
    ).rejects.toThrow("iCloud認証に失敗");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    await disconnected();
  });
  it("destroys sockets on operation timeout", async () => {
    stall = true;
    await expect(
      new MailService(session, 500).get(
        getSchema.parse({ message_id: messageId("INBOX", "321", 1) }),
      ),
    ).rejects.toThrow("タイムアウト");
    await disconnected();
  });
  it("rejects stale validity before UID FETCH", async () => {
    validity = 322;
    await expect(
      new MailService(session).get(
        getSchema.parse({ message_id: messageId("INBOX", "321", 1) }),
      ),
    ).rejects.toThrow("UIDVALIDITY");
    expect(commands.some((c) => c.startsWith("UID FETCH"))).toBe(false);
    await disconnected();
  });
  it("fixes host, TLS and privacy limits in production options", () => {
    const options = imapOptions(config);
    expect(options).toMatchObject({
      host: "imap.mail.me.com",
      port: 993,
      secure: true,
      logger: false,
      emitLogs: false,
      tls: { rejectUnauthorized: true },
      maxLiteralSize: 65536,
    });
  });
});
