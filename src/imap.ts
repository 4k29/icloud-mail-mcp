import { ImapFlow, type ImapFlowOptions, type SearchObject } from "imapflow";
import type { Config } from "./config.js";
import { LIMITS } from "./config.js";
import { SafeError } from "./errors.js";
import type { ReadSession } from "./mail.js";
export function imapOptions(config: Config): ImapFlowOptions {
  if (!config.username || !config.password)
    throw new SafeError("IMAP_UNAVAILABLE");
  return {
    host: "imap.mail.me.com",
    port: 993,
    secure: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user: config.username, pass: config.password },
    logger: false,
    emitLogs: false,
    disableAutoIdle: true,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10_000,
    maxLineLength: 65_536,
    maxLiteralSize: 65_536,
    maxResponseSize: 131_072,
  };
}
function imapError(e: unknown): SafeError {
  if (e instanceof SafeError) return e;
  const error = e as { authenticationFailed?: boolean; code?: string };
  if (error?.authenticationFailed || error?.code === "AUTHENTICATIONFAILED")
    return new SafeError("IMAP_AUTH_FAILED");
  if (["CONNECT_TIMEOUT", "ETIMEDOUT", "ETIMEOUT"].includes(error?.code ?? ""))
    return new SafeError("TIMEOUT");
  if (
    ["LiteralTooLarge", "LineTooLarge", "ResponseTooLarge"].includes(
      error?.code ?? "",
    )
  )
    return new SafeError("RESPONSE_TOO_LARGE");
  return new SafeError("IMAP_UNAVAILABLE");
}
export class ICloudSession implements ReadSession {
  private client: ImapFlow;
  private connected = false;
  private closed = false;
  constructor(
    config: Config,
    factory: (options: ImapFlowOptions) => ImapFlow = (options) =>
      new ImapFlow(options),
  ) {
    this.client = factory(imapOptions(config));
    // Never log transport errors, commands, credentials, or server response text.
    this.client.on("error", () => {});
  }
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) throw new SafeError("IMAP_UNAVAILABLE");
    try {
      if (!this.connected) {
        await this.client.connect();
        this.connected = true;
        if (this.closed) {
          this.client.close();
          throw new SafeError("TIMEOUT");
        }
      }
      return await fn();
    } catch (e) {
      throw imapError(e);
    }
  }
  async list() {
    return this.call(async () => {
      const all = await this.client.list({ listOnly: true });
      if (all.length > 10_000) throw new SafeError("RESPONSE_TOO_LARGE");
      return all.map((b) => ({
        path: b.path,
        name: b.name,
        selectable: !b.flags.has("\\Noselect"),
        special_use: b.specialUse,
      }));
    });
  }
  async open(path: string) {
    return this.call(async () => {
      const box = await this.client.mailboxOpen(path, { readOnly: true });
      if (!box.readOnly) throw new SafeError("IMAP_UNAVAILABLE");
      return { validity: box.uidValidity.toString(), uidNext: box.uidNext };
    });
  }
  async search(query: SearchObject) {
    return this.call(async () => {
      const results = await this.client.search(query, { uid: true });
      return results || [];
    });
  }
  async fetch(uid: number, body: boolean) {
    return this.call(
      async () =>
        (await this.client.fetchOne(
          uid,
          {
            uid: true,
            envelope: true,
            flags: true,
            internalDate: true,
            ...(body
              ? {
                  bodyStructure: true,
                  headers: ["cc", "reply-to", "in-reply-to", "references"],
                }
              : {}),
          },
          { uid: true },
        )) || false,
    );
  }
  async text(uid: number, part: string) {
    return this.call(async () => {
      // ImapFlow uses BODY.PEEK, decodes MIME transfer encoding and charset, and limits output bytes.
      const download = await this.client.download(uid, part, {
        uid: true,
        maxBytes: LIMITS.bodyBytes + 1,
        chunkSize: 16_384,
      });
      if (!download.content) throw new SafeError("NOT_FOUND");
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of download.content) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += b.length;
        if (bytes > LIMITS.bodyBytes) {
          download.content.destroy();
          throw new SafeError("BODY_TOO_LARGE");
        }
        chunks.push(b);
      }
      return Buffer.concat(chunks).toString("utf8");
    });
  }
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.client.close();
    }
  }
}
