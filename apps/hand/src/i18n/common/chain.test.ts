import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { i18n } from "@lingui/core";

import { compileCatalogue } from "../catalogue";
import { chainName } from "./chain";
import en from "./en";
import ru from "./ru";

/** The network's name in the reader's language (review round 1: an English name on Russian screens). */
describe("chainName", () => {
  const before = i18n.locale;
  i18n.load("en", compileCatalogue(en));
  i18n.load("ru", compileCatalogue(ru));
  afterAll(() => {
    if (before) i18n.activate(before);
  });

  const local = { id: 31337, name: "Local test network" };

  test("the local network reads in the language shown", () => {
    i18n.activate("ru");
    expect(chainName(local)).toBe("Локальная тестовая сеть");
    i18n.activate("en");
    expect(chainName(local)).toBe("Local test network");
  });

  test("the catalogue's name wins over the configuration's for a chain it knows", () => {
    i18n.activate("ru");
    expect(chainName({ id: 31337, name: "anvil" })).toBe("Локальная тестовая сеть");
  });

  test("Base and Base Sepolia have names of their own; Base Sepolia says it is a test network", () => {
    i18n.activate("en");
    expect(chainName({ id: 84532, name: "whatever" })).toBe("Base Sepolia (test network)");
    expect(chainName({ id: 8453, name: "whatever" })).toBe("Base");
    i18n.activate("ru");
    expect(chainName({ id: 84532, name: "whatever" })).toBe("Base Sepolia (тестовая сеть)");
    expect(chainName({ id: 8453, name: "whatever" })).toBe("Base");
  });

  test("any other chain keeps the name its configuration gives, and lingui is never asked for an id it lacks", () => {
    // lingui answers a missing id with the id and warns "Uncompiled message detected".
    const asked = spyOn(i18n, "_");
    try {
      for (const lang of ["en", "ru"]) {
        i18n.activate(lang);
        expect(chainName({ id: 10, name: "OP Mainnet" })).toBe("OP Mainnet");
      }
      expect(asked).not.toHaveBeenCalled();
    } finally {
      asked.mockRestore();
    }
  });

  test("a network error names Base Sepolia in the reader's language, never the configuration's English name", () => {
    // Review of the public test deployment: "Выбранное приложение не знает сеть Base Sepolia (test network)".
    const base = { id: 84532, name: "Base Sepolia" };
    i18n.activate("ru");
    expect(i18n._("common.error.wrongNetwork", { network: chainName(base) })).toBe("Аккаунт сейчас в другой сети. Переключи его на Base Sepolia (тестовая сеть) и попробуй ещё раз. Ничего не отправлено.");
    expect(i18n._("common.error.unknownNetwork", { network: chainName(base) })).toContain("сеть Base Sepolia (тестовая сеть).");
    i18n.activate("en");
    expect(i18n._("common.error.wrongNetwork", { network: chainName(base) })).toContain("Switch it to Base Sepolia (test network) and try again.");
  });

  test("a public test network's ribbon is its name and test dollars, in both languages", () => {
    i18n.activate("en");
    expect(i18n._("common.ribbon.testnet", { network: chainName({ id: 84532, name: "Base Sepolia" }) })).toBe("Base Sepolia (test network) · Test dollars");
    i18n.activate("ru");
    expect(i18n._("common.ribbon.testnet", { network: chainName({ id: 84532, name: "Base Sepolia" }) })).toBe("Base Sepolia (тестовая сеть) · Тестовые доллары");
  });

  test("the ribbon and the name are the same words", () => {
    expect(en["common.ribbon"]).toStartWith(`${en["common.chain.31337"]} · `);
    expect(ru["common.ribbon"]).toStartWith(`${ru["common.chain.31337"]} · `);
  });
});
