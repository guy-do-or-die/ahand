import { A, Abroken, B, CHAIN, CORE, SITE, client, deliver, getHand, hashOf, newInbox, offlineGetHand, until } from "../../../tests/integration/relay-fixture";

import { afterEach, describe, expect, test } from "bun:test";

import type { InboxRecord } from "../../store/db";
import type { Judged } from "./answers";

/**
 * The raiser's inbox keeps one record per Give (FINDINGS E-3, E-4): keyed by its giveHash, the id
 * /thank uses, and written once. The relay sends every wrap it keeps to every new subscription, so
 * each new tab gets the same Give again; its first-seen time must stay the first tab's. Each test
 * loads its own copy of inbox.ts, as a new tab does.
 */

const db = await import("../../store/db");
const { onePerGive } = await import("./answers");
const { checkThank } = await import("../thank/check");
const key = db.handKey(CHAIN, CORE, 7n);
const realNow = Date.now;
const NOV_1 = Date.UTC(2026, 10, 1, 12, 0);
const NOV_5 = Date.UTC(2026, 10, 5, 9, 30);
let tab = 0;

async function session(secret: `0x${string}`, now: number, n: number, read = getHand): Promise<InboxRecord[]> {
  Date.now = () => now;
  try {
    const inbox = (await import(`./inbox.ts?inbox-tab=${++tab}`)) as typeof import("./inbox");
    inbox.listenOn(key, secret, read);
    await until(async () => (await db.forHand("inbox", key)).length >= n, 5_000, `${n} inbox records`);
    await Bun.sleep(150); // anything the relay sends again, and its write
    return await db.forHand("inbox", key);
  } finally {
    Date.now = realNow;
  }
}

afterEach(() => {
  Date.now = realNow;
  db.closeDb();
});

describe("my: one inbox record per Give", () => {
  test("a second session at a later clock keeps the 1 Nov first-seen time", async () => {
    db.configureDb({ name: `inbox-later-session-${process.pid}` });
    const inbox = newInbox();
    await deliver(inbox, A, 1_793_534_000, "I know a quiet flat");

    const day1 = await session(inbox.secret, NOV_1, 1);
    expect(day1.map((r) => [r.id, r.firstSeen])).toEqual([[await hashOf(A), NOV_1]]);

    const day5 = await session(inbox.secret, NOV_5, 1);
    expect(day5.map((r) => [r.id, r.firstSeen, r.words])).toEqual([[await hashOf(A), NOV_1, "I know a quiet flat"]]);
  });

  test("an answer that cannot be opened when it arrives is kept under its message id, then moves to its giveHash with its first time", async () => {
    db.configureDb({ name: `inbox-offline-then-open-${process.pid}` });
    const inbox = newInbox();
    const sent = await deliver(inbox, A, 1_793_534_000);

    const away = await session(inbox.secret, NOV_1, 1, offlineGetHand);
    expect(away.map((r) => [r.id, r.firstSeen])).toEqual([[`${key}:${sent.id}`, NOV_1]]);

    const back = await session(inbox.secret, NOV_5, 1);
    expect(back.length).toBe(1);
    const now = await db.forHand("inbox", key);
    expect(now.map((r) => [r.id, r.firstSeen, r.replyTo])).toEqual([[await hashOf(A), NOV_1, sent.replyTo]]);
  });

  test("a pasted copy first, then the relay's: one record, the paste's time, the relay's words and chat key", async () => {
    db.configureDb({ name: `inbox-paste-then-relay-${process.pid}` });
    Date.now = () => NOV_1;
    const pasted = await checkThank(A, SITE, client, getHand);
    Date.now = realNow;
    expect(pasted.ok).toBe(true);

    const inbox = newInbox();
    const sent = await deliver(inbox, A, 1_793_534_000, "here is my answer");
    await session(inbox.secret, NOV_5, 1);
    const records = await db.forHand("inbox", key);
    expect(records.map((r) => [r.id, r.firstSeen, r.words, r.replyTo])).toEqual([[await hashOf(A), NOV_1, "here is my answer", sent.replyTo]]);
  });

  test("a copy with a broken confirmation, kept first, never takes the good copy's place", async () => {
    db.configureDb({ name: `inbox-broken-first-${process.pid}` });
    const inbox = newInbox();
    await deliver(inbox, Abroken, 1_793_534_000, "the same, badly confirmed");
    await session(inbox.secret, NOV_1, 1);
    // The tab stays open; the good copy arrives an hour later.
    Date.now = () => NOV_1 + 3_600_000;
    await deliver(inbox, A, 1_793_535_000, "the good one");
    await until(async () => (await db.forHand("inbox", key)).length >= 2, 5_000, "the second copy");
    await Bun.sleep(100);
    Date.now = realNow;
    const records = await db.forHand("inbox", key);
    const hash = await hashOf(A);
    expect(await hashOf(Abroken)).toBe(hash); // one giveHash: the signatures are not in it
    const byLink = new Map(records.map((r) => [r.giveLink, r]));
    expect(byLink.get(Abroken)?.id).toBe(hash);
    expect(byLink.get(A)?.id).toMatch(new RegExp(`^${key}:${hash}:[0-9a-f]{16}$`));
    expect(byLink.get(A)?.words).toBe("the good one");

    // /thank on the good copy finds its own record, and its time is the Give's earliest.
    Date.now = () => NOV_5;
    const result = await checkThank(A, SITE, client, getHand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checked.record.id).toBe(byLink.get(A)!.id);
    expect(result.checked.firstSeen).toBe(NOV_1);
    expect(result.checked.verdict).toBe("first");
    expect((await db.forHand("inbox", key)).length).toBe(2);
  });

  test("two Gives stay two records", async () => {
    db.configureDb({ name: `inbox-two-gives-${process.pid}` });
    const inbox = newInbox();
    await deliver(inbox, A, 1_793_534_000);
    await deliver(inbox, B, 1_793_535_000);
    const records = await session(inbox.secret, NOV_1, 2);
    expect(records.map((r) => r.id).sort()).toEqual([await hashOf(A), await hashOf(B)].sort());
  });
});

describe("my: one card per Give", () => {
  const answer = (giveHash: `0x${string}`): Judged => ({ verdict: "answer", giveHash, opened: {} as never, needsSetup: false, block: 1n });
  const record = (id: string, firstSeen: number, extra: Partial<InboxRecord> = {}): InboxRecord => ({ id, hand: key, giveLink: A, firstSeen, ...extra });

  test("copies of one Give are one card, at the earliest time, with the words of whichever copy carried them", () => {
    const shown = onePerGive([
      { record: record("0xaa", NOV_5, { words: "hello", replyTo: "0x01" }), judged: answer("0xaa") },
      { record: record(`${key}:rumor`, NOV_1), judged: answer("0xAA") },
      { record: record("0xbb", NOV_5 + 1), judged: answer("0xbb") },
      { record: record("refused", 0), judged: { verdict: "refused", messageId: "my.refused.notGive" } },
      { record: record("checking", 1) },
    ]);
    expect(shown.map((read) => [read.record.id, read.record.firstSeen, read.record.words ?? null, read.record.replyTo ?? null])).toEqual([
      [`${key}:rumor`, NOV_1, "hello", "0x01"],
      ["0xbb", NOV_5 + 1, null, null],
      ["checking", 1, null, null],
      ["refused", 0, null, null],
    ]);
  });
});
