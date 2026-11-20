import { describe, expect, test } from "bun:test";
import { setupI18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";

import en from "./en";
import ru from "./ru";

/** One message of this screen, rendered as the app renders it (compiled ICU, in that language). */
function say(lang: "en" | "ru", id: keyof typeof en, values: Record<string, unknown>): string {
  const i18n = setupI18n();
  i18n.load(lang, { [id]: compileMessage((lang === "en" ? en : ru)[id]) });
  i18n.activate(lang);
  return i18n._(id, values).replace(/ /g, " ");
}

describe("core: numbers and units read as each language writes them (F10)", () => {
  test("the code's size takes the plural its number needs", () => {
    expect(say("ru", "core.code", { bytes: 10_733 })).toBe("Его код на месте: 10 733 байта.");
    expect(say("ru", "core.code", { bytes: 10_735 })).toBe("Его код на месте: 10 735 байт.");
    expect(say("ru", "core.code", { bytes: 21 })).toBe("Его код на месте: 21 байт.");
    expect(say("en", "core.code", { bytes: 10_733 })).toBe("Its code is there: 10,733 bytes.");
  });

  test("the cap's row is in seconds and days, in the reader's own units", () => {
    expect(say("ru", "core.cap.row", { seconds: "15 552 000", days: 180 })).toBe("15 552 000 с = 180 дн.");
    expect(say("en", "core.cap.row", { seconds: "15 552 000", days: 180 })).toBe("15 552 000 s = 180 d");
    expect(say("ru", "core.cap.body", { days: 180 })).toStartWith("Не дальше чем на 180 дней вперёд");
  });

  test("an app-made label is Russian on the Russian page", () => {
    expect(say("ru", "core.chainId", { id: 31337 })).toBe("ID сети 31337");
  });

  test("the Russian names the deployer as a CREATE2 factory and the limits page by its title (F16)", () => {
    expect(ru["core.derive.body"]).toContain("фабрика развёртывания (CREATE2) по фиксированному адресу");
    expect(ru["core.limits.body"]).toContain("«Чего aHand не обещает»");
    expect(ru["core.lens.limit.1.body"]).not.toContain("дать руке истечь");
  });
});
