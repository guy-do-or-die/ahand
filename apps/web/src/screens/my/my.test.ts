import { describe, expect, test } from "bun:test";
import {
  describeHand,
  domain as domainOf,
  inboxSecretOf,
  keyOfSeed,
  masterOf,
  matchRoot,
  openAddress,
  readDescription,
  rootSeedOf,
  type Hand,
  type SignedShake,
} from "@ahand/sdk";
import { publicKeyOf } from "@ahand/deliver";
import { HttpRequestError, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { keysTypedData } from "@ahand/sdk";

import en from "./en";
import { answersLines, countLine, daysLeft, formatCode, inboxSight, parseCode, parseHandNumber, predictSplit, secondsLeft, wantsCare, DAY, type InboxSight } from "./logic";
import { readBook } from "./reads";
import ru from "./ru";
import { rebuildBare, rebuildWithWords, seedFitsRoot } from "./rebuild";
import { judgedOf } from "./answers";

const CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309" as Address;
const SITE = "http://127.0.0.1:18351";
const OPTIONS = { canonicalCore: CORE };
const DOMAIN = domainOf(31337, CORE);
// anvil's public test account 1 (local chains only): the asker in the stand's fixtures.
const RAISER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const BOOK = "0x6669787475726573" as Hex;

async function master(): Promise<Hex> {
  return masterOf(await RAISER.signTypedData(keysTypedData(31337, CORE, RAISER.address)), { chainId: 31337, core: CORE, raiser: RAISER.address });
}

function handOf(rootKey: Address, dataHash: Hex, handId = 7n): Hand {
  return { handId, raiser: RAISER.address, token: "0x6B867aFa284Ce84eE76424373420E1170da2eE7b", rootKey, payoutGasK: 250, minClaimBps: 7_000, dataHash };
}

describe("my: the device's code", () => {
  test("is written in groups of four and read back in any spelling", () => {
    expect(formatCode(BOOK)).toBe("6669 7874 7572 6573");
    for (const typed of ["6669 7874 7572 6573", "0x6669787475726573", "6669-7874-7572-6573", " 66697874 75726573 ", "6669787475726573".toUpperCase()]) {
      expect(parseCode(typed)).toBe(BOOK);
    }
  });

  test("refuses anything that is not 8 bytes of hex", () => {
    for (const bad of ["", "6669", "66697874757265", "666978747572657300", "zz69787475726573", "0x"]) expect(parseCode(bad)).toBeUndefined();
  });

  test("a hand's number is a positive whole number", () => {
    expect(parseHandNumber("12")).toBe(12n);
    expect(parseHandNumber(" #12 ")).toBe(12n);
    for (const bad of ["", "0", "-1", "1.5", "12a", "1e3"]) expect(parseHandNumber(bad)).toBeUndefined();
  });
});

describe("my: time left is the network's", () => {
  test("nothing is claimed before a block arrives", () => {
    expect(secondsLeft(1_000, undefined)).toBeUndefined();
    expect(wantsCare("open", undefined)).toBe(false);
  });

  test("days round down; the band shows under seven days of an open hand only", () => {
    expect(secondsLeft(1_000, 400)).toBe(600);
    expect(secondsLeft(1_000, 2_000)).toBe(0);
    expect(daysLeft(7 * DAY - 1)).toBe(6);
    expect(wantsCare("open", 7 * DAY - 1)).toBe(true);
    expect(wantsCare("open", 7 * DAY)).toBe(false);
    expect(wantsCare("expired", 0)).toBe(false);
    expect(wantsCare("thanked", 10)).toBe(false);
  });
});

describe("my: who would get what, by Core's arithmetic", () => {
  const shake = (claimBps: number, nextClaimBps: number, payee: Address = zeroAddress): SignedShake => ({
    shake: { nextKey: zeroAddress, payee, claimBps, nextClaimBps, dataHash: zeroHash },
    keySig: "0x",
  });
  const A = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
  const HELPER = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65" as Address;

  test("each Shake gets its margin rounded down; the helper gets the rest, rounding included", () => {
    // reward 25.000001: 10% of it is 2.5000001 → 2_500_000 units (rounded down)
    const rows = predictSplit(25_000_001n, [shake(10_000, 9_000, A), shake(9_000, 9_000)], { payee: HELPER, claimBps: 9_000 });
    expect(rows).toEqual([
      { role: "passer", position: 0, payee: A, amount: 2_500_000n, bps: 1_000 },
      { role: "passer", position: 1, amount: 0n, bps: 0 },
      { role: "helper", payee: HELPER, amount: 22_500_001n, bps: 9_000 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0n)).toBe(25_000_001n);
  });

  test("with no Shakes the helper gets the whole reward; with no reward, nothing", () => {
    expect(predictSplit(40n, [], { payee: HELPER, claimBps: 10_000 })).toEqual([{ role: "helper", payee: HELPER, amount: 40n, bps: 10_000 }]);
    expect(predictSplit(0n, [shake(10_000, 8_000, A)], { payee: HELPER, claimBps: 8_000 }).map((row) => row.amount)).toEqual([0n, 0n]);
  });
});

describe("my: a link written again from the device's book", () => {
  test("the derived seed is the root key's, and matchRoot finds its number from the code alone", async () => {
    const m = await master();
    const seed = await rootSeedOf(m, BOOK, 3);
    const rootKey = privateKeyToAddress(keyOfSeed(seed));
    expect(seedFitsRoot(seed, rootKey)).toBe(true);
    expect(seedFitsRoot(await rootSeedOf(m, BOOK, 4), rootKey)).toBe(false);
    expect(await matchRoot(m, BOOK, rootKey, 10)).toBe(3);
  });

  for (const mode of ["unlisted", "dark", "public"] as const) {
    test(`${mode}: the kept words ride along only when they give Core's dataHash`, async () => {
      const m = await master();
      const seed = await rootSeedOf(m, BOOK, 0);
      const inbox = publicKeyOf(await inboxSecretOf(m, BOOK, 0));
      const words = { mode, title: "Who can lend a ladder?", content: "Two metres, for Saturday.", ...(mode === "public" ? {} : { salt: `0x${"ab".repeat(32)}` as Hex }) };
      const described = describeHand({ ...words, inbox });
      const hand = handOf(privateKeyToAddress(keyOfSeed(seed)), described.dataHash);

      const rebuilt = await rebuildWithWords({ domain: DOMAIN, hand, seed, inbox, words, site: SITE, options: OPTIONS });
      expect(rebuilt.words).toBe("attached");
      expect(rebuilt.address.startsWith(mode === "dark" ? `${SITE}/#` : `${SITE}/31337/7`)).toBe(true);
      const opened = await openAddress(rebuilt.address, async () => hand, OPTIONS);
      expect(opened.hand.handId).toBe(7n);
      expect(opened.seed).toBe(seed);
      expect(readDescription(opened)).toEqual({ status: "attached", title: words.title, content: words.content, inbox });

      // Words that differ by one character are not attached: the link is bare, and says nothing.
      const other = await rebuildWithWords({ domain: DOMAIN, hand, seed, inbox, words: { ...words, title: "Who can lend a ladder!" }, site: SITE, options: OPTIONS });
      expect(other.words).toBe("mismatch");
      expect(readDescription(await openAddress(other.address, async () => hand, OPTIONS)).status).toBe("lost");
    });
  }

  test("a bare link from another device's code opens, its words not arrived", async () => {
    const m = await master();
    const seed = await rootSeedOf(m, BOOK, 2);
    const hand = handOf(privateKeyToAddress(keyOfSeed(seed)), describeHand({ mode: "dark", title: "x" }).dataHash, 9n);
    const address = await rebuildBare({ domain: DOMAIN, hand, seed, site: SITE, options: OPTIONS });
    expect(address.startsWith(`${SITE}/#`)).toBe(true);
    const opened = await openAddress(address, async () => hand, OPTIONS);
    expect(opened.hand.handId).toBe(9n);
    expect(readDescription(opened).status).toBe("lost");
  });
});

describe("my: what a failed check of an answer says", () => {
  test("the network not answering is offline, not a refusal", () => {
    expect(judgedOf(new HttpRequestError({ url: "http://127.0.0.1:1" }))).toEqual({ verdict: "offline" });
    expect(judgedOf({ name: "CallExecutionError", cause: new TypeError("Failed to fetch") })).toEqual({ verdict: "offline" });
  });

  test("a plain TypeError is an unknown refusal, never offline", () => {
    expect(judgedOf(new TypeError("Cannot read properties of undefined"))).toEqual({ verdict: "refused", messageId: "my.refused.unknown", detail: "Cannot read properties of undefined" });
  });
});

describe("my: what the screen may say about answers", () => {
  const at = { relays: 2, unlocked: true, key: true, read: 2, failed: 0, busy: false };

  test("only an unlocked read that every relay answered is 'read'", () => {
    expect(inboxSight(at)).toBe("read");
    expect(inboxSight({ ...at, unlocked: false })).toBe("locked");
    // Locked wins over anything a past visit left behind.
    expect(inboxSight({ ...at, unlocked: false, key: undefined, read: 0 })).toBe("locked");
    expect(inboxSight({ ...at, key: false })).toBe("no-key");
    expect(inboxSight({ ...at, key: undefined })).toBe("reading");
    expect(inboxSight({ ...at, read: 0 })).toBe("reading");
    expect(inboxSight({ ...at, read: 1 })).toBe("reading"); // one relay has not said yet
    expect(inboxSight({ ...at, read: 1, failed: 1 })).toBe("read"); // the one in reach answered
    expect(inboxSight({ ...at, read: 0, failed: 2 })).toBe("unreachable");
    expect(inboxSight({ ...at, busy: true })).toBe("reading"); // an answer is still being stored or judged
  });

  test("a build with no relay has nothing to unlock for answers: they are pasted", () => {
    expect(inboxSight({ ...at, relays: 0, unlocked: false, read: 0 })).toBe("no-relay");
    expect(inboxSight({ ...at, relays: 0, read: 0, busy: true })).toBe("reading");
  });

  const sights: InboxSight[] = ["no-relay", "locked", "no-key", "reading", "unreachable", "read"];

  test("the list says 'No answers yet' only after a read; locked, it says locked", () => {
    for (const sight of sights) {
      const line = countLine(sight, 0);
      expect(line.id === "my.answers.count").toBe(sight === "read");
      expect(en).toHaveProperty([line.id]);
    }
    expect(countLine("locked", 0)).toEqual({ id: "my.answers.locked" });
    expect(countLine("read", 0)).toEqual({ id: "my.answers.count", values: { n: 0 } });
    // Answers this device already holds are counted; locked, with the note that more may wait.
    expect(countLine("locked", 2)).toEqual({ id: "my.answers.lockedCount", values: { n: 2 } });
    expect(countLine("read", 2)).toEqual({ id: "my.answers.count", values: { n: 2 } });
    expect(countLine("unreachable", 1)).toEqual({ id: "my.answers.count", values: { n: 1 } });
  });

  test("the hand's page says 'Nothing has arrived yet.' only after a read, over no card", () => {
    for (const sight of sights) {
      for (const cards of [0, 1]) {
        const ids = answersLines(sight, cards, 1).map((line) => line.id);
        expect(ids.includes("my.answers.none")).toBe(sight === "read" && cards === 0);
        for (const id of ids) expect(en).toHaveProperty([id]);
      }
    }
    expect(answersLines("locked", 0, 0)).toEqual([{ id: "my.answers.locked" }]);
    expect(answersLines("locked", 1, 0)).toEqual([{ id: "my.answers.lockedMore" }]);
    expect(answersLines("read", 0, 2)).toEqual([{ id: "my.answers.listening", values: { n: 2 } }, { id: "my.answers.none" }]);
  });

  test("the words: locked is said as locked in both languages, and each language quotes its own way", () => {
    expect(en["my.answers.locked"]).toBe("Answers are locked — unlock to check.");
    expect(ru["my.answers.locked"]).toBe("Ответы закрыты — открой доступ, чтобы проверить.");
    expect(en["my.answer.quoted"]).toBe("“{words}”");
    expect(ru["my.answer.quoted"]).toBe("«{words}»");
  });
});

describe("my: whether a relay has answered a read of an inbox", () => {
  /** A socket that does nothing by itself: the test plays the relay. */
  class FakeSocket extends EventTarget {
    static made: FakeSocket[] = [];
    sent: string[] = [];
    constructor(public url: string) {
      super();
      FakeSocket.made.push(this);
    }
    send(data: string): void {
      this.sent.push(data);
    }
    open(): void {
      this.dispatchEvent(new Event("open"));
    }
    hear(message: unknown): void {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
    }
    drop(): void {
      this.dispatchEvent(new Event("close"));
    }
  }
  const INBOX = `0x${"ab".repeat(32)}`;
  const OTHER = `0x${"cd".repeat(32)}`;
  const A = "ws://127.0.0.1:1";
  const B = "ws://127.0.0.1:2";

  function book() {
    let changes = 0;
    const made = readBook(FakeSocket as unknown as typeof WebSocket, () => changes++);
    const connect = (relay: string) => new made.Socket(relay) as unknown as FakeSocket;
    const ask = (socket: FakeSocket, sub: string, inbox: string) => (socket as unknown as WebSocket).send(JSON.stringify(["REQ", sub, { kinds: [1059], "#p": [inbox.slice(2)] }]));
    return { ...made, connect, ask, changes: () => changes };
  }

  test("a relay has answered once it ends the stored messages of that subscription, not before", () => {
    const b = book();
    expect(b.marksOf(INBOX)).toBeUndefined();
    b.expect(INBOX);
    expect(b.marksOf(INBOX)).toEqual({ read: 0, failed: 0 });

    const socket = b.connect(A);
    socket.open();
    b.ask(socket, "sub-1", INBOX);
    expect(socket.sent).toHaveLength(1); // the transport's own frame went out untouched
    expect(JSON.parse(socket.sent[0]!)[0]).toBe("REQ");
    socket.hear(["EVENT", "sub-1", { id: "x" }]);
    socket.hear(["EOSE", "another-sub"]);
    socket.hear("not a frame");
    expect(b.marksOf(INBOX)).toEqual({ read: 0, failed: 0 });
    socket.hear(["EOSE", "sub-1"]);
    expect(b.marksOf(INBOX)).toEqual({ read: 1, failed: 0 });
    expect(b.changes()).toBe(1);

    // A relay that drops the connection afterwards has still been read.
    socket.drop();
    expect(b.marksOf(INBOX)).toEqual({ read: 1, failed: 0 });
    expect(b.changes()).toBe(1);
  });

  test("a relay that cannot be reached, or drops before it answered in full, is not read; a later answer is", () => {
    const b = book();
    b.expect(INBOX);
    b.expect(OTHER);

    // Never opened: out of reach for every inbox still unread there.
    b.connect(A).drop();
    expect(b.marksOf(INBOX)).toEqual({ read: 0, failed: 1 });
    expect(b.marksOf(OTHER)).toEqual({ read: 0, failed: 1 });

    // Opened, asked, dropped before the end: only what that socket asked.
    const cut = b.connect(B);
    cut.open();
    b.ask(cut, "sub-2", INBOX);
    cut.drop();
    expect(b.marksOf(INBOX)).toEqual({ read: 0, failed: 2 });
    expect(b.marksOf(OTHER)).toEqual({ read: 0, failed: 1 });

    // The transport connects again, and this time the relay answers.
    const again = b.connect(A);
    again.open();
    b.ask(again, "sub-3", INBOX);
    again.hear(["EOSE", "sub-3"]);
    expect(b.marksOf(INBOX)).toEqual({ read: 1, failed: 1 });
    expect(b.marksOf(OTHER)).toEqual({ read: 0, failed: 1 });
  });
});
