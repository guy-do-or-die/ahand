import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import en from "./en";
import ru from "./ru";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("landing: a newcomer meets the gestures before the paste box (F17)", () => {
  test("the paste box comes after the three gestures, as a quiet row with a question for a label", () => {
    const screen = source("./index.tsx");
    const body = screen.slice(screen.indexOf("export default function LandingScreen"));
    expect(body.indexOf("<OpenLink />")).toBeGreaterThan(body.indexOf('<GestureCard gesture="thank" />'));
    expect(en["landing.open.title"]).toBe("Got a link? Paste it");
    expect(ru["landing.open.title"]).toBe("Есть ссылка? Вставь её");
    expect(screen).not.toContain("ah-card ah-card--lg");
  });

  test("a card's front takes its own height, and «твои люди» does not break", () => {
    const css = source("./landing.css");
    expect(css).toMatch(/\.lp-flip:not\(\[data-open="true"\]\) \.lp-flip__back,\s*\.lp-flip\[data-open="true"\] \.lp-flip__front \{\s*position: absolute;/);
    expect(css).toMatch(/\.lp-mark \{[^}]*white-space: nowrap;/);
  });

  test("the third card says who gets the money in words a native would use (F16)", () => {
    expect(ru["landing.thank.say"]).toStartWith("Скажи спасибо тому, кто помог, — деньги получат все, кто передавал ссылку.");
    expect(ru["landing.limits"]).toBe("Чего aHand не обещает");
  });
});
