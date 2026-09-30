import { createHash } from "node:crypto";
import { z } from "zod";
import { mailbox, type SearchInput } from "./schemas.js";
import { SafeError } from "./errors.js";
const idSchema = z
  .object({
    v: z.literal(1),
    mailbox,
    validity: z.string().regex(/^[1-9]\d{0,9}$/),
    uid: z.number().int().min(1).max(4294967295),
  })
  .strict();
const cursorSchema = z
  .object({
    v: z.literal(1),
    mailbox,
    validity: z.string().regex(/^[1-9]\d{0,9}$/),
    next: z.number().int().min(0).max(4294967295),
    fingerprint: z.string().length(64),
  })
  .strict();
function encode(x: unknown): string {
  return Buffer.from(JSON.stringify(x)).toString("base64url");
}
function decode(s: string): unknown {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error();
    return JSON.parse(Buffer.from(s, "base64url").toString());
  } catch {
    throw new SafeError("INVALID_INPUT");
  }
}
export function messageId(
  mailbox: string,
  validity: string,
  uid: number,
): string {
  return encode({ v: 1, mailbox, validity, uid });
}
export function parseMessageId(s: string) {
  const r = idSchema.safeParse(decode(s));
  if (!r.success) throw new SafeError("INVALID_INPUT");
  return r.data;
}
export function fingerprint(s: SearchInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        s.mailbox,
        s.from,
        s.to,
        s.subject,
        s.keyword,
        s.since,
        s.before,
        s.unread,
        s.include_snippet,
      ]),
    )
    .digest("hex");
}
export function searchCursor(
  mailbox: string,
  validity: string,
  next: number,
  fingerprint: string,
): string {
  return encode({ v: 1, mailbox, validity, next, fingerprint });
}
export function parseCursor(s: string) {
  const r = cursorSchema.safeParse(decode(s));
  if (!r.success) throw new SafeError("INVALID_INPUT");
  return r.data;
}
