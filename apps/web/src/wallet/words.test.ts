import { expect, test } from "bun:test";

import { safeIcon } from "./icons";
import { WALLET_WORDS } from "./words";

/** Every sentence of a language, with functions called on sample values. */
function sentences(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (typeof node === "function") out.push(String((node as (...args: unknown[]) => unknown)(2, 3)));
  else if (node && typeof node === "object") for (const value of Object.values(node)) sentences(value, out);
  return out;
}

const human = (lang: "en" | "ru") => {
  const { dev: _dev, ...rest } = WALLET_WORDS[lang];
  return sentences(rest);
};

test("no banned word on the human layer; 'wallet' only in 'Connect a wallet'", () => {
  const banned = /\b(gas|transactions?|sign(s|ed|ing|ature|atures|er|ers)?|escrow|custody|donations?|bounty|fees?|safe)\b/i;
  expect(human("en").filter((s) => banned.test(s))).toEqual([]);
  expect(human("en").filter((s) => /wallet/i.test(s))).toEqual(["Connect a wallet"]);
  const bannedRu = /газ(?!\p{L})|транзакци|подпи[сш]|эскроу|комисси|безопасн/iu;
  expect(human("ru").filter((s) => bannedRu.test(s))).toEqual([]);
  expect(human("ru").filter((s) => /кошел/i.test(s))).toEqual(["Подключить кошелёк"]);
});

test("Russian has every sentence, in Russian, speaking as «ты»", () => {
  const en = sentences(WALLET_WORDS.en);
  const ru = sentences(WALLET_WORDS.ru);
  expect(ru.length).toBe(en.length);
  expect(ru.filter((s) => !/[а-яё]/i.test(s))).toEqual([]);
  expect(ru.filter((s) => /(?<!\p{L})(вы|вас|вам|ваш\p{L}*)(?!\p{L})/iu.test(s))).toEqual([]);
});

test("a wallet's icon is accepted only as a data: image", () => {
  expect(safeIcon("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
  expect(safeIcon("data:image/svg+xml;charset=utf-8,%3Csvg%3E")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%3E");
  for (const bad of ["https://evil.example/i.png", "//evil.example/i.png", "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "blob:https://x/1", "", undefined, 42]) {
    expect(safeIcon(bad)).toBeUndefined();
  }
  expect(safeIcon(`data:image/png;base64,${"A".repeat(300_000)}`)).toBeUndefined();
});

test("the connected state's control is not a second 'Connect a wallet'", () => {
  expect(WALLET_WORDS.en.another).toBe("Use another account");
  expect(WALLET_WORDS.ru.another).toBe("Сменить аккаунт");
  for (const lang of ["en", "ru"] as const) expect(WALLET_WORDS[lang].another).not.toBe(WALLET_WORDS[lang].title);
});
