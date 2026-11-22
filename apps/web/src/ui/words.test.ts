import { expect, test } from "bun:test";

import { english, mnemonicToAccount } from "viem/accounts";

import { count, day, inBothZones, money, percent, second, shortAddress, unitsText } from "./format";
import { makeWords } from "./land";
import { WORDS } from "./words";

/** Every sentence of a language, with functions called on sample values. */
function sentences(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (typeof node === "function") out.push(String((node as (...args: unknown[]) => unknown)("1", "2")));
  else if (Array.isArray(node)) for (const item of node) sentences(item, out);
  else if (node && typeof node === "object") for (const value of Object.values(node)) sentences(value, out);
  return out;
}

test("no banned word stands on the human layer", () => {
  const banned = /\b(gas|transactions?|sign(s|ed|ing)?|escrow|custody|donations?|bounty|fees?|pot|pocket|hops?|recipients?)\b/i;
  const all = sentences(WORDS.en);
  expect(all.length).toBeGreaterThan(80);
  expect(all.filter((sentence) => banned.test(sentence))).toEqual([]);
  // "wallet" has exactly one use.
  expect(all.filter((sentence) => /wallet/i.test(sentence))).toEqual(["Connect a wallet"]);
  expect(sentences(WORDS.ru).filter((sentence) => /кошел/i.test(sentence))).toEqual(["Подключить кошелёк"]);
});

test("Russian has a sentence for every English one, and none is left in English", () => {
  const en = sentences(WORDS.en);
  const ru = sentences(WORDS.ru);
  expect(ru.length).toBe(en.length);
  // The one empty string is the half of "[$40] reward" that a language does not use.
  const untranslated = ru.filter((sentence) => sentence !== "" && !/[а-яё]/i.test(sentence));
  expect(untranslated).toEqual([]);
});

test("the Deal card's lead-in is a whole sentence, so a title of any shape can follow it", () => {
  // "Someone is looking for" / «Кто-то ищет» needs a title that completes it; people type
  // questions (the raise screen's own placeholder is one). The asker is always "Someone".
  expect(WORDS.en.deal.intro).toBe("Someone raised a hand:");
  expect(WORDS.ru.deal.intro).toBe("Кто-то поднял руку:");
  // It is the bare card's own sentence, with a colon where that one ends.
  expect(WORDS.en.deal.intro).toBe(WORDS.en.deal.bare.replace(/\.$/, ":"));
  expect(WORDS.ru.deal.intro).toBe(WORDS.ru.deal.bare.replace(/\.$/, ":"));
});

test("the receipt says what was sent, never what somebody got", () => {
  expect(WORDS.en.receipt.caption).toBe("What was sent to whom, from the chain's own records");
  expect(WORDS.ru.receipt.caption).toBe("Кому сколько отправлено — по записям самой сети");
  expect(sentences(WORDS.en.receipt).filter((sentence) => /\b(got|gets?|received?)\b/i.test(sentence))).toEqual([]);
  expect(sentences(WORDS.ru.receipt).filter((sentence) => /получ/i.test(sentence))).toEqual([]);
});

test("the Russian deal card keeps the condition, and the hand is what is open", () => {
  expect(WORDS.ru.deal.ifHelp).toBe("Если поможешь и тебя поблагодарят");
  expect(WORDS.ru.deal.openUntil("29 янв")).toBe("рука открыта до 29 янв");
  expect(WORDS.ru.deal.wasOpenUntil("29 янв")).toBe("рука была открыта до 29 янв");
  expect(`${WORDS.ru.deal.reward[0]}$50 · ${WORDS.ru.deal.openUntil("29 янв")}`).toBe("Награда $50 · рука открыта до 29 янв");
});

test("the asker's words, the amount note and the copy buttons are said in both languages", () => {
  expect(WORDS.en.deal.wordsLabel).toBe("In the asker's words — not checked");
  expect(WORDS.ru.deal.wordsLabel).toBe("Словами автора — не проверено");
  // On the asker's own screens the same label speaks to the asker (viewer "asker").
  expect(WORDS.en.deal.asker.wordsLabel).toBe("In your own words — nobody checked them");
  expect(WORDS.ru.deal.asker.wordsLabel).toBe("Твоими словами — их никто не проверял");
  expect(WORDS.en.deal.amountFlag("$5,000", "$1")).toBe("The words mention $5,000. The reward on chain is $1.");
  expect(WORDS.ru.deal.amountFlag("$5 000", "$1")).toBe("В тексте написано $5 000. Награда в контракте — $1.");
  expect([WORDS.en.deal.readAll, WORDS.ru.deal.readAll]).toEqual(["Read all", "Читать целиком"]);
  expect([WORDS.en.copy.link, WORDS.ru.copy.link, WORDS.en.copy.share, WORDS.ru.copy.share]).toEqual(["Copy link", "Скопировать ссылку", "Share", "Поделиться"]);
  expect(WORDS.en.money.thousands("1000")).toBe("Is that a thousand or more? Write it without a comma: 1000.");
  expect(WORDS.ru.money.thousands("1000")).toBe("Это тысяча или больше? Напиши без запятой: 1000.");
});

test("hands are counted in proper Russian", () => {
  expect([1, 2, 5, 11, 21, 22].map(WORDS.ru.rail.count)).toEqual(["Уже 1 рука.", "Уже 2 руки.", "Уже 5 рук.", "Уже 11 рук.", "Уже 21 рука.", "Уже 22 руки."]);
  expect([1, 2].map(WORDS.en.rail.count)).toEqual(["1 hand so far.", "2 hands so far."]);
});

test("money is cut to cents and never rounded up", () => {
  expect(money(40_000_000n, 6, "en")).toBe("$40");
  expect(money(28_000_000n, 6, "ru")).toBe("$28");
  expect(money(800_000n, 6, "en")).toBe("$0.80");
  expect(money(800_000n, 6, "ru")).toBe("$0,80");
  expect(money(27_999_999n, 6, "en")).toBe("$27.99");
  expect(money(40_000_000n, 6, "en", { cents: true })).toBe("$40.00");
  expect(money(1_234_500_000n, 6, "en")).toBe("$1,234.50");
  expect(money(9n, 6, "en")).toBe("under $0.01");
  expect(money(0n, 6, "en")).toBe("$0");
});

test("dates, shares and addresses", () => {
  const noon20Dec = Date.UTC(2026, 11, 20, 12) / 1000;
  expect(day(noon20Dec, "en", "UTC")).toBe("20 Dec");
  expect(day(noon20Dec, "ru", "UTC")).toBe("20 дек");
  expect(percent(7000, "en")).toBe("70%");
  expect(percent(250, "ru")).toBe("2,5%");
  expect(count(1234n)).toBe("1\u00a0234");
  expect(count(182_000)).toBe("182\u00a0000");
  expect(count(999)).toBe("999");
  expect(unitsText(40_000_000n, 6)).toBe("40");
  expect(unitsText(1n, 6)).toBe("0.000001");
  expect(shortAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")).toBe("0xf39F…2266");
});

test("a second of the chain's clock reads in the reader's zone and in UTC", () => {
  const expiry = 1_797_768_000; // 20 Dec 2026, 12:00:00 UTC
  expect(second(expiry, "en", "UTC")).toBe("20 Dec 2026, 12:00:00 UTC");
  expect(second(expiry, "en", "Asia/Tbilisi")).toBe("20 Dec 2026, 16:00:00 GMT+4");
  expect(second(expiry, "ru", "Asia/Tbilisi")).toBe("20 дек. 2026 г., 16:00:00 GMT+4");
  expect(second(expiry + 59, "en", "America/New_York")).toBe("20 Dec 2026, 07:00:59 GMT-5");
  expect(inBothZones(expiry, "en", "Asia/Tbilisi")).toEqual(["20 Dec 2026, 16:00:00 GMT+4", "20 Dec 2026, 12:00:00 UTC"]);
  // A date that falls on another day there is said so: the two lines differ by the day too.
  expect(inBothZones(expiry + 9 * 3600, "en", "Asia/Tbilisi")).toEqual(["21 Dec 2026, 01:00:00 GMT+4", "20 Dec 2026, 21:00:00 UTC"]);
  // A reader in UTC gets the one line.
  expect(inBothZones(expiry, "ru", "UTC")).toEqual(["20 дек. 2026 г., 12:00:00 UTC"]);
});

test("twelve words come from viem's English list and open the address shown", () => {
  const made = makeWords();
  expect(made.words).toHaveLength(12);
  expect(made.words.every((word) => english.includes(word))).toBe(true);
  expect(mnemonicToAccount(made.words.join(" ")).address).toBe(made.account.address);
  expect(makeWords().account.address).not.toBe(made.account.address);
});
