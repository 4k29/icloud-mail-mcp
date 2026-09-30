import type {
  FetchMessageObject,
  MessageStructureObject,
  SearchObject,
} from "imapflow";
import { simpleParser } from "mailparser";
import { convert } from "html-to-text";
import { LIMITS } from "./config.js";
import { SafeError } from "./errors.js";
import {
  fingerprint,
  messageId,
  parseCursor,
  parseMessageId,
  searchCursor,
} from "./identifiers.js";
import type { SearchInput, GetInput } from "./schemas.js";
export interface Folder {
  path: string;
  name: string;
  selectable: boolean;
  special_use?: string;
}
export interface ReadSession {
  list(): Promise<Folder[]>;
  open(path: string): Promise<{ validity: string; uidNext: number }>;
  search(query: SearchObject): Promise<number[]>;
  fetch(uid: number, body: boolean): Promise<FetchMessageObject | false>;
  text(uid: number, part: string): Promise<string>;
  close(): void;
}
export type SessionFactory = () => ReadSession;
const clip = (s: string | undefined, n = 1024) => s?.slice(0, n);
function summary(mailbox: string, validity: string, m: FetchMessageObject) {
  const address = (xs: NonNullable<typeof m.envelope>["from"]) =>
    (xs ?? [])
      .slice(0, 20)
      .map((x) => ({ name: clip(x.name, 256), address: clip(x.address, 320) }));
  return {
    message_id: messageId(mailbox, validity, m.uid),
    rfc_message_id: clip(m.envelope?.messageId),
    subject: clip(m.envelope?.subject),
    from: address(m.envelope?.from),
    to: address(m.envelope?.to),
    date:
      m.envelope?.date instanceof Date
        ? m.envelope.date.toISOString()
        : undefined,
    received_at:
      m.internalDate instanceof Date ? m.internalDate.toISOString() : undefined,
    unread: !m.flags?.has("\\Seen"),
  };
}
function parts(root: MessageStructureObject | undefined) {
  const attachments: Record<string, unknown>[] = [];
  let count = 0;
  function walk(
    n: MessageStructureObject,
    depth: number,
  ): MessageStructureObject[] {
    if (++count > 200 || depth > 20) throw new SafeError("RESPONSE_TOO_LARGE");
    const filename = n.dispositionParameters?.filename ?? n.parameters?.name;
    if (
      n.disposition?.toLowerCase() === "attachment" ||
      filename ||
      (!n.childNodes && !["text/plain", "text/html"].includes(n.type))
    ) {
      attachments.push({
        part: clip(n.part),
        filename: clip(filename, 512),
        content_type: clip(n.type, 128),
        size: n.size,
        disposition: clip(n.disposition, 64),
        content_id: clip(n.id, 512),
      });
      return [];
    }
    if (n.childNodes) {
      const children = n.childNodes.map((c) => walk(c, depth + 1));
      if (n.type === "multipart/alternative")
        return (
          children.find((xs) => xs.some((x) => x.type === "text/plain")) ??
          children.find((xs) => xs.length > 0) ??
          []
        );
      return children.flat();
    }
    return [n];
  }
  return { bodies: root ? walk(root, 0) : [], attachments };
}
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    limits: { maxInputLength: LIMITS.bodyBytes },
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  });
}
async function bodyText(session: ReadSession, m: FetchMessageObject) {
  const p = parts(m.bodyStructure);
  const texts: string[] = [];
  let bytes = 0;
  for (const body of p.bodies) {
    const raw = await session.text(m.uid, body.part || "1");
    bytes += Buffer.byteLength(raw);
    if (bytes > LIMITS.bodyBytes) throw new SafeError("BODY_TOO_LARGE");
    texts.push(body.type === "text/html" ? htmlToText(raw) : raw);
  }
  return { attachments: p.attachments, text: texts.join("\n") };
}
function utfSlice(s: string, start: number, length: number) {
  // UTF-16 offsets, never split a surrogate pair; clients use returned next_offset.
  let end = Math.min(s.length, start + length);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(s[start] ?? ""))
    throw new SafeError("INVALID_INPUT");
  if (end < s.length && /[\uDC00-\uDFFF]/.test(s[end] ?? "")) end--;
  return { text: s.slice(start, end), end };
}
export class MailService {
  private active = 0;
  constructor(
    private factory: SessionFactory,
    private timeoutMs: number = LIMITS.operationMs,
  ) {}
  private async run<T>(fn: (s: ReadSession) => Promise<T>): Promise<T> {
    if (this.active >= LIMITS.connections) throw new SafeError("BUSY");
    this.active++;
    let s: ReadSession | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      s = this.factory();
      const session = s;
      return await Promise.race([
        fn(session),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            session.close();
            reject(new SafeError("TIMEOUT"));
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      s?.close();
      this.active--;
    }
  }
  async list(input: { offset: number; limit: number }) {
    return this.run(async (s) => {
      const all = await s.list();
      if (all.length > 10_000) throw new SafeError("RESPONSE_TOO_LARGE");
      const folders = all.slice(
        input.offset,
        input.offset + Math.min(input.limit, LIMITS.mailboxes),
      );
      return {
        mailboxes: folders,
        next_offset:
          input.offset + folders.length < all.length
            ? input.offset + folders.length
            : null,
      };
    });
  }
  async search(input: SearchInput) {
    return this.run(async (s) => {
      const box = await s.open(input.mailbox);
      const hash = fingerprint(input);
      let high = box.uidNext - 1;
      if (input.cursor) {
        const c = parseCursor(input.cursor);
        if (c.mailbox !== input.mailbox || c.fingerprint !== hash)
          throw new SafeError("INVALID_INPUT");
        if (c.validity !== box.validity) throw new SafeError("STALE_ID");
        high = c.next;
      }
      if (high <= 0)
        return { messages: [], next_cursor: null, scanned_uid_range: null };
      const low = Math.max(1, high - LIMITS.uidWindow + 1);
      const q: SearchObject = { uid: `${low}:${high}` };
      if (input.from) q.from = input.from;
      if (input.to) q.to = input.to;
      if (input.subject) q.subject = input.subject;
      if (input.keyword) q.text = input.keyword;
      if (input.unread !== undefined) q.seen = !input.unread;
      // IMAP date searches ignore timezone; widen by one day and filter exact UTC INTERNALDATE below.
      if (input.since)
        q.since = new Date(Date.parse(input.since) - 86_400_000)
          .toISOString()
          .slice(0, 10);
      if (input.before)
        q.before = new Date(Date.parse(input.before) + 86_400_000)
          .toISOString()
          .slice(0, 10);
      const uids = (await s.search(q))
        .filter((u) => u >= low && u <= high)
        .sort((a, b) => b - a);
      if (uids.length > LIMITS.uidWindow)
        throw new SafeError("RESPONSE_TOO_LARGE");
      const messages = [];
      let next = low - 1;
      for (const uid of uids) {
        const m = await s.fetch(uid, input.include_snippet);
        if (!m) continue;
        const date =
          m.internalDate instanceof Date ? m.internalDate.valueOf() : NaN;
        if ((input.since || input.before) && !Number.isFinite(date)) continue;
        if (input.since && date < Date.parse(input.since)) continue;
        if (input.before && date >= Date.parse(input.before)) continue;
        const item: {
          snippet?: string;
          snippet_truncated?: boolean;
        } & ReturnType<typeof summary> = summary(
          input.mailbox,
          box.validity,
          m,
        );
        if (input.include_snippet) {
          try {
            const b = await bodyText(s, m);
            item.snippet = utfSlice(b.text, 0, 300).text;
            item.snippet_truncated = b.text.length > 300;
          } catch (e) {
            if (!(e instanceof SafeError && e.code === "BODY_TOO_LARGE"))
              throw e;
            item.snippet_truncated = true;
          }
        }
        messages.push(item);
        if (messages.length === input.limit) {
          next = uid - 1;
          break;
        }
      }
      return {
        messages,
        next_cursor:
          next > 0
            ? searchCursor(input.mailbox, box.validity, next, hash)
            : null,
        scanned_uid_range: { low, high },
        order: "UID descending",
        date_timezone: "UTC; INTERNALDATE",
        untrusted_content: true,
      };
    });
  }
  async get(input: GetInput) {
    const id = parseMessageId(input.message_id);
    return this.run(async (s) => {
      const box = await s.open(id.mailbox);
      if (box.validity !== id.validity) throw new SafeError("STALE_ID");
      const m = await s.fetch(id.uid, true);
      if (!m) throw new SafeError("NOT_FOUND");
      const b = await bodyText(s, m);
      if (input.offset > b.text.length) throw new SafeError("INVALID_INPUT");
      const page = utfSlice(b.text, input.offset, input.length);
      if ((m.headers?.length ?? 0) > 65_536)
        throw new SafeError("RESPONSE_TOO_LARGE");
      const parsed = await simpleParser(m.headers ?? Buffer.alloc(0), {
        skipHtmlToText: true,
        skipTextToHtml: true,
        skipImageLinks: true,
      });
      return {
        ...summary(id.mailbox, box.validity, m),
        headers: {
          cc: clip(
            Array.isArray(parsed.cc)
              ? parsed.cc.map((x) => x.text).join(", ")
              : parsed.cc?.text,
            2048,
          ),
          reply_to: clip(parsed.replyTo?.text, 2048),
          in_reply_to: clip(parsed.inReplyTo),
          references: Array.isArray(parsed.references)
            ? parsed.references.slice(0, 20).map((x) => clip(x))
            : clip(parsed.references),
        },
        body: page.text,
        body_format: "text",
        offset: input.offset,
        total_length: b.text.length,
        truncated: page.end < b.text.length,
        next_offset: page.end < b.text.length ? page.end : null,
        attachments: b.attachments,
        untrusted_content: true,
      };
    });
  }
}
