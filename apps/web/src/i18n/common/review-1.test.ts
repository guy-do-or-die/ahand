import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The words that review round 1 found wrong, kept right. Each test names the rule, not only the sentence, so a new sentence that breaks the
 * same rule fails here too.
 */

type Catalogue = Record<string, string>;

const SRC = resolve(import.meta.dirname, "../..");
const load = async (path: string) => ((await import(join(SRC, path))) as { default: Catalogue }).default;

const screens = readdirSync(join(SRC, "screens")).filter((name) => !name.startsWith(".")).sort();
const en: Catalogue = { ...(await load("i18n/common/en.ts")) };
const ru: Catalogue = { ...(await load("i18n/common/ru.ts")) };
for (const screen of screens) {
  Object.assign(en, await load(`screens/${screen}/en.ts`));
  Object.assign(ru, await load(`screens/${screen}/ru.ts`));
}

/** The specialist layer: keys with a `lens` segment, where Core's own names and formulas stand. */
const lens = (key: string) => key.split(".").includes("lens");
const found = (words: Catalogue, keys: RegExp, pattern: RegExp) =>
  Object.entries(words)
    .filter(([key, message]) => keys.test(key) && !lens(key) && pattern.test(message))
    .map(([key, message]) => `${key}: ${message}`);

describe("words: review round 1", () => {
  // `Paid` is what left the contract. A token that takes its own cut delivers
  // less, so no screen that shows paid amounts may say anyone "got" or "received" them.
  const PAID_SCREENS = /^(thank|proof|print|hand|my|waiting|check|care)\./;

  test("no paid amount is presented as what someone got or received", () => {
    expect(found(en, PAID_SCREENS, /\b(got|received)\b/i)).toEqual([]);
    expect(found(ru, PAID_SCREENS, /(?<!\p{L})(получил[аио]?|получен[аоы]?|зачислен[аоы]?)(?!\p{L})/iu)).toEqual([]);
  });

  // "Payout" covers a Paid and a Pending alike, so the headline is true when one of them waits.
  test("after a thank the headline names the payouts, not who got them", () => {
    for (const key of ["thank.done", "thank.done.before"]) {
      expect(en[key]).toEndWith("Here's every payout — straight from the chain.");
      expect(ru[key]).toEndWith("Все выплаты — прямо из сети.");
    }
    expect(en["print.receipt.lead"]).toStartWith("Every payout, ");
    expect(ru["print.receipt.lead"]).toStartWith("Все выплаты — ");
  });

  test("Russian quotes are «…» everywhere on the human layer", () => {
    expect(found(ru, /./, /[„“”"]/)).toEqual([]);
  });

  test("the local network has a name in each language, keyed by its chain id", () => {
    expect(en["common.chain.31337"]).toBe("Local test network");
    expect(ru["common.chain.31337"]).toBe("Локальная тестовая сеть");
  });

  test("the fit line says the worst case is only a check, and what is sent is the wallet's estimate", () => {
    expect(en["thank.lens.fit"]).toMatch(/Worst case \{gas\} gas.*only to check.*estimate is what is sent/);
    expect(ru["thank.lens.fit"]).toMatch(/В худшем случае \{gas\} gas.*только.*проверк.*отправляется оценка/);
  });

  test("a long hand is promised a button, not a reminder that arrives by itself", () => {
    expect(en["raise.expiry.nudge"]).not.toMatch(/You'll get a calendar reminder/);
    expect(ru["raise.expiry.nudge"]).not.toMatch(/Добавим в календарь/);
    expect(en["raise.expiry.nudge"]).toMatch(/button/);
    expect(ru["raise.expiry.nudge"]).toMatch(/кнопка/);
  });

  test("a position on a route is a pass, never a hand", () => {
    for (const key of ["proof.route", "proof.route.to", "proof.keys", "proof.share", "proof.share.to"]) {
      expect(en[key]).toStartWith("Pass {n} ");
      expect(ru[key]).toStartWith("Передача {n} ");
    }
    expect(found(en, /./, /\bHand \{n\}/)).toEqual([]);
    expect(found(ru, /./, /Рука \{n\}/)).toEqual([]);
  });

  test("the give screen's third step can say that only the tick is missing", () => {
    expect(en["give.agree.tick"]).toBeString();
    expect(ru["give.agree.tick"]).toBeString();
    expect(ru["give.agree.tick"]).not.toBe(ru["give.agree.pick"]);
  });

  test("the unlock line reads right on a page with one hand and on the list", () => {
    expect(en["my.unlock.connect"]).not.toMatch(/these hands/);
    expect(ru["my.unlock.connect"]).not.toMatch(/эти руки/);
  });

  test("the Russian sentences a reader stumbled on are gone", () => {
    const all = Object.values(ru).join("\n");
    for (const phrase of ["уйдут автору сообщением, а не в сеть", "У кого была старая ссылка", "двенадцати слов, здесь", "Кто подтверждает"]) {
      expect(all).not.toContain(phrase);
    }
  });
});
