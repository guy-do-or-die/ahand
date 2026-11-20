import { afterAll, describe, expect, test } from "bun:test";
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

  test("any other chain keeps the name its configuration gives", () => {
    for (const lang of ["en", "ru"]) {
      i18n.activate(lang);
      expect(chainName({ id: 8453, name: "Base" })).toBe("Base");
      expect(chainName({ id: 84532, name: "Base Sepolia" })).toBe("Base Sepolia");
    }
  });

  test("the ribbon and the name are the same words", () => {
    expect(en["common.ribbon"]).toStartWith(`${en["common.chain.31337"]} · `);
    expect(ru["common.ribbon"]).toStartWith(`${ru["common.chain.31337"]} · `);
  });
});
