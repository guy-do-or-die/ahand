import { describe, expect, test } from "bun:test";

import en from "./en";
import ru from "./ru";

describe("defaults: the mono line under each row is Russian on the Russian page", () => {
  const values = (words: Record<string, string>) => Object.entries(words).filter(([key]) => key.startsWith("defaults.value."));

  test("every app-made value has both languages", () => {
    expect(values(en).length).toBeGreaterThanOrEqual(11);
    expect(values(ru).map(([key]) => key)).toEqual(values(en).map(([key]) => key));
  });

  test("Russian values keep Core's and the platform's own names, and nothing else in English", () => {
    const allowed = /\b(?:expiry|reward|forwarder|NIP-17|EXPIRY_MARGIN|REPLACESTATE|AES-GCM)\b/g;
    for (const [key, text] of values(ru)) expect(text.replace(allowed, "").replace(/\{\w+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
  });

  test("units are Russian: days and minutes", () => {
    expect(ru["defaults.value.d26b"]).toBe("expiry = время блока + {days} дн.");
    expect(ru["defaults.value.d61"]).toContain("10 МИН");
  });
});
