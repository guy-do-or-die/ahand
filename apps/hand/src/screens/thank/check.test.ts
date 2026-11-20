import { A, B, CHAIN, CORE, SITE, client, deliver, getHand, hashOf, newInbox, until } from "../../../tests/integration/relay-fixture";

import { afterEach, describe, expect, test } from "bun:test";

/**
 * /thank's re-signed warning (R-29, D-24) and its first-seen order (D-25) for answers that came
 * through the relay (FINDINGS E-3, E-4). The inbox is filled the way the app fills it: gift wraps
 * kept by the stand's relay, heard by my/inbox.ts `listenOn`. Each test loads its own copy of the
 * inbox module, as a new tab does.
 */

const db = await import("../../store/db");
const { checkThank } = await import("./check");
const key = db.handKey(CHAIN, CORE, 7n);
const realNow = Date.now;
const NOV_1 = Date.UTC(2026, 10, 1, 12, 0);
const NOV_2 = Date.UTC(2026, 10, 2, 12, 0);
const NOV_5 = Date.UTC(2026, 10, 5, 9, 30);
let tab = 0;

/** A new tab that unlocked the Hand at device time `now`: it listens until `n` records are kept. */
async function session(secret: `0x${string}`, now: number, n: number): Promise<void> {
  Date.now = () => now;
  try {
    const inbox = (await import(`../my/inbox.ts?check-tab=${++tab}`)) as typeof import("../my/inbox");
    inbox.listenOn(key, secret, getHand);
    await settle(n);
  } finally {
    Date.now = realNow;
  }
}

/** Waits until `n` records are kept, and a moment more for anything the relay sends again. */
async function settle(n: number): Promise<void> {
  await until(async () => (await db.forHand("inbox", key)).length >= n, 5_000, `${n} inbox records`);
  await Bun.sleep(100);
}

afterEach(() => {
  Date.now = realNow;
  db.closeDb();
});

describe("thank: a Give that came through the relay", () => {
  test("both Gives from the relay: the second is judged re-signed, and one share is dropped", async () => {
    db.configureDb({ name: `thank-relay-both-${process.pid}` });
    const inbox = newInbox();
    await deliver(inbox, A, 1_793_534_000);
    await session(inbox.secret, NOV_1, 1);
    // The tab stays open; B arrives a day later.
    Date.now = () => NOV_2;
    await deliver(inbox, B, 1_793_620_000);
    await settle(2);
    // A reload days later: the relay sends both again.
    await session(inbox.secret, NOV_5, 2);

    const records = await db.forHand("inbox", key);
    expect(records.map((r) => r.id).sort()).toEqual([await hashOf(A), await hashOf(B)].sort());

    Date.now = () => NOV_5;
    const result = await checkThank(B, SITE, client, getHand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checked.verdict).toBe("resigned");
    expect(result.checked.dropped.length).toBe(1);
    expect(result.checked.firstSeen).toBe(NOV_2);
    expect(result.checked.earlierSeen).toBe(NOV_1);
    // Nothing new was written: the relay's record is the Give's one record.
    expect((await db.forHand("inbox", key)).length).toBe(2);
  });

  test("a single Give from the relay is the first, seen when it arrived", async () => {
    db.configureDb({ name: `thank-relay-single-${process.pid}` });
    const inbox = newInbox();
    await deliver(inbox, A, 1_793_534_000);
    await session(inbox.secret, NOV_1, 1);

    Date.now = () => NOV_5;
    const result = await checkThank(A, SITE, client, getHand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checked.verdict).toBe("first");
    expect(result.checked.dropped).toEqual([]);
    expect(result.checked.firstSeen).toBe(NOV_1);
    expect(result.checked.earlierSeen).toBeUndefined();
    expect((await db.forHand("inbox", key)).map((r) => r.firstSeen)).toEqual([NOV_1]);
  });

  test("a device that kept relay copies under message ids still sees the re-signed Give, at its first time", async () => {
    db.configureDb({ name: `thank-relay-old-ids-${process.pid}` });
    // What builds before this fix wrote for each delivered give.
    await db.put("inbox", { id: `${key}:rumor-of-A`, hand: key, giveLink: A, firstSeen: NOV_1 });
    await db.put("inbox", { id: `${key}:rumor-of-B`, hand: key, giveLink: B, firstSeen: NOV_2 });

    Date.now = () => NOV_5;
    const result = await checkThank(B, SITE, client, getHand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checked.verdict).toBe("resigned");
    expect(result.checked.dropped.length).toBe(1);
    expect(result.checked.firstSeen).toBe(NOV_2);
  });

  test("pasting the same Give again writes nothing over its first-seen time", async () => {
    db.configureDb({ name: `thank-paste-twice-${process.pid}` });
    Date.now = () => NOV_1;
    const first = await checkThank(A, SITE, client, getHand);
    Date.now = () => NOV_5;
    const again = await checkThank(A, SITE, client, getHand);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.checked.firstSeen).toBe(NOV_1);
    expect((await db.forHand("inbox", key)).map((r) => r.firstSeen)).toEqual([NOV_1]);
  });
});
