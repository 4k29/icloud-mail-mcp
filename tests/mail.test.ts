import { beforeEach, describe, expect, it, vi } from "vitest";
import { MailService, htmlToText } from "../src/mail.js";
import { MockSession, mockState, type MockState } from "../src/mock.js";
import { searchSchema, getSchema } from "../src/schemas.js";
import { messageId } from "../src/identifiers.js";
let state: MockState;
let mail: MailService;
beforeEach(async () => {
  state = await mockState();
  mail = new MailService(() => new MockSession(state));
});
describe("read-only mail and MIME mock", () => {
  it("lists with paging", async () => {
    const a = await mail.list({ offset: 0, limit: 1 });
    expect(a.next_offset).toBe(1);
    expect((await mail.list({ offset: 1, limit: 1 })).mailboxes[0]?.path).toBe(
      "Archive",
    );
    expect(state.closes).toBe(2);
  });
  it("searches Japanese sender/recipient/unread/keyword, and preserves Seen", async () => {
    const before = state.messages.map((m) => Array.from(m.flags ?? []));
    const r = await mail.search(
      searchSchema.parse({
        mailbox: "INBOX",
        subject: "日本語",
        from: "sender",
        to: "owner",
        unread: true,
        keyword: "本文",
        include_snippet: true,
      }),
    );
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.subject).toBe("日本語のメール");
    expect(r.messages[0]?.snippet).toContain("日本語の本文");
    const m = await mail.get(
      getSchema.parse({ message_id: r.messages[0]!.message_id }),
    );
    expect(m.body).toContain("日本語の本文");
    expect(m.attachments[0]?.filename).toBe("dummy.pdf");
    expect(state.messages.map((m) => Array.from(m.flags ?? []))).toEqual(
      before,
    );
    expect(state.closes).toBe(2);
  });
  it("paginates UID descending, ignores new arrivals until new search", async () => {
    const input = searchSchema.parse({ mailbox: "INBOX", limit: 1 });
    const a = await mail.search(input);
    expect(a.messages[0]?.subject).toBe("長い本文");
    state.messages.push({ ...state.messages[0]!, uid: 4 });
    const b = await mail.search({ ...input, cursor: a.next_cursor! });
    expect(b.messages[0]?.subject).toBe("HTMLのみ");
    await expect(
      mail.search({ ...input, subject: "changed", cursor: a.next_cursor! }),
    ).rejects.toThrow("引数");
  });
  it("returns empty result, but preserves cursor when older windows remain", async () => {
    expect(
      (
        await mail.search(
          searchSchema.parse({ mailbox: "INBOX", subject: "存在しない" }),
        )
      ).messages,
    ).toEqual([]);
    state.messages[2]!.uid = 501;
    const r = await mail.search(
      searchSchema.parse({ mailbox: "INBOX", subject: "日本語" }),
    );
    expect(r.messages).toEqual([]);
    expect(r.next_cursor).not.toBeNull();
  });
  it("filters exact UTC received dates, not sender Date header", async () => {
    state.messages[0]!.internalDate = new Date("2026-09-29T23:59:59Z");
    const r = await mail.search(
      searchSchema.parse({
        mailbox: "INBOX",
        since: "2026-09-30",
        before: "2026-10-01",
      }),
    );
    expect(r.messages).toHaveLength(2);
  });
  it("converts HTML without scripts, images, or network access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await mail.get(
      getSchema.parse({ message_id: messageId("INBOX", "123", 2) }),
    );
    expect(r.body).toContain("安全な本文");
    expect(r.body).not.toMatch(/危険|https|pixel|script/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(htmlToText("<p>x</p><style>bad</style>")).toBe("x");
  });
  it("provides lossless continuation and never splits emoji", async () => {
    const id = messageId("INBOX", "123", 3);
    let text = "";
    let offset = 0;
    do {
      const r = await mail.get(
        getSchema.parse({ message_id: id, offset, length: 2000 }),
      );
      text += r.body;
      offset = r.next_offset ?? -1;
      expect(r.truncated).toBe(r.next_offset !== null);
    } while (offset !== -1);
    expect(text).toBe(state.texts.get(3));
  });
  it("rejects stale UIDVALIDITY before fetching another mail", async () => {
    const r = await mail.search(
      searchSchema.parse({ mailbox: "INBOX", limit: 1 }),
    );
    state.validity = "124";
    await expect(
      mail.get(getSchema.parse({ message_id: r.messages[0]!.message_id })),
    ).rejects.toThrow("UIDVALIDITY");
    await expect(
      mail.search(
        searchSchema.parse({
          mailbox: "INBOX",
          limit: 1,
          cursor: r.next_cursor,
        }),
      ),
    ).rejects.toThrow("UIDVALIDITY");
    expect(state.closes).toBe(3);
  });
  it("handles missing UID, bad ID and strict input validation", async () => {
    await expect(
      mail.get(getSchema.parse({ message_id: messageId("INBOX", "123", 99) })),
    ).rejects.toThrow("見つかりません");
    await expect(
      mail.get(getSchema.parse({ message_id: "broken" })),
    ).rejects.toThrow("引数");
    expect(
      searchSchema.safeParse({ mailbox: "INBOX", host: "attacker.invalid" })
        .success,
    ).toBe(false);
    expect(
      searchSchema.safeParse({ mailbox: "INBOX", since: "2026-02-30" }).success,
    ).toBe(false);
  });
  it("closes on timeout/auth failure and limits concurrency", async () => {
    mail = new MailService(() => new MockSession(state), 30);
    state.fail = "timeout";
    const a = mail.list({ offset: 0, limit: 1 });
    const b = mail.list({ offset: 0, limit: 1 });
    await expect(mail.list({ offset: 0, limit: 1 })).rejects.toThrow(
      "同時処理",
    );
    const results = await Promise.allSettled([a, b]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(state.closes).toBe(2);
    state.fail = "auth";
    await expect(mail.list({ offset: 0, limit: 1 })).rejects.toThrow(
      "iCloud認証",
    );
    expect(state.closes).toBe(3);
  });
});
