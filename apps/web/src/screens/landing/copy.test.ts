import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import en from "./en";
import ru from "./ru";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("landing: a newcomer meets the gestures before the paste box", () => {
  test("the paste box comes after the four gestures, folded into one question", () => {
    const screen = source("./index.tsx");
    const body = screen.slice(screen.indexOf("export default function LandingScreen"));
    expect(body.indexOf("<OpenLink />")).toBeGreaterThan(body.indexOf("GESTURES.map("));
    expect(screen).toContain('const GESTURES: readonly Gesture[] = ["raise", "pass", "help", "thank"];');
    expect(en["landing.open.ask"]).toBe("Got a link?");
    expect(ru["landing.open.ask"]).toBe("Есть ссылка?");
    expect(en["landing.open.title"]).toBe("Got a link? Paste it");
    expect(ru["landing.open.title"]).toBe("Есть ссылка? Вставь её");
    expect(screen).not.toContain("ah-card ah-card--lg");
  });

  test("a card's front takes its own height, and «твои люди» does not break", () => {
    const css = source("./landing.css");
    expect(css).toMatch(/\.lp-flip:not\(\[data-open="true"\]\) \.lp-flip__back,\s*\.lp-flip\[data-open="true"\] \.lp-flip__front \{\s*position: absolute;/);
    expect(css).toMatch(/\.lp-mark \{[^}]*white-space: nowrap;/);
  });

  test("the last card says who gets the money in words a native would use", () => {
    expect(ru["landing.thank.say"]).toBe("Поблагодари, и все получат своё");
  });

  test("four gestures, one short title each, of a like length, with no dash, no semicolon and no full stop (a title over a description takes none)", () => {
    for (const words of [en, ru]) {
      const says = (["raise", "pass", "help", "thank"] as const).map((gesture) => words[`landing.${gesture}.say`]);
      for (const say of says) {
        expect(say).toMatch(/^[^.;—]+$/);
        expect(say.length).toBeLessThanOrEqual(36);
      }
      expect(Math.max(...says.map((say) => say.length)) - Math.min(...says.map((say) => say.length))).toBeLessThanOrEqual(12);
    }
    expect(en["landing.how"]).toBe("Four gestures");
    expect(ru["landing.how"]).toBe("Четыре жеста");
  });

  test("under each gesture one quiet line of two short sentences, of a like length, with no dash and no semicolon", () => {
    for (const words of [en, ru]) {
      const more = (["raise", "pass", "help", "thank"] as const).map((gesture) => words[`landing.${gesture}.more`]);
      for (const line of more) {
        expect(line).toMatch(/^[^.;—]+\. [^.;—]+\.$/);
        expect(line.length).toBeLessThanOrEqual(84);
      }
      expect(Math.max(...more.map((line) => line.length)) - Math.min(...more.map((line) => line.length))).toBeLessThanOrEqual(20);
    }
    const screen = source("./index.tsx");
    expect(screen.match(/t\(`landing\.\$\{gesture\}\.more`\)/g)).toHaveLength(2);
  });

  test("the first screen says the thing in two sentences and shows a Hand in the card's own words", () => {
    for (const words of [en, ru]) {
      expect(words["landing.lead"].match(/\./g)).toHaveLength(2);
      expect(words["landing.lead"].length).toBeLessThanOrEqual(130);
      expect(words["landing.raise.note"]).toMatch(/^[^.;—]+\.$/);
    }
    const screen = source("./index.tsx");
    // The example is the receiver's own card drawn as a picture, so the picture and the screen cannot part (examples.test.tsx).
    expect(source("./Sample.tsx")).toContain("<DealPicture ");
    const body = screen.slice(screen.indexOf("export default function LandingScreen"));
    expect(body.indexOf("<Sample ")).toBeGreaterThan(body.indexOf("TID.landing.raise"));
    expect(body.indexOf("<Sample ")).toBeLessThan(body.indexOf("GESTURES.map("));
  });

  test("the next example comes by itself and can be held: it waits near the pointer and the focus, on a page nobody sees and while paused, and where less motion is asked for it comes by tone alone", () => {
    const drawn = source("./Sample.tsx");
    expect(drawn).toContain("export const STANDS_MS = 9_000;");
    expect(drawn).toContain("const running = !paused && !near;");
    expect(drawn).toContain("if (document.hidden) return;");
    // Asking for less motion does not stop the change itself, so the component does not read that wish: the stylesheet does.
    expect(drawn).not.toContain("prefers-reduced-motion");
    // It draws no lot: the order is the set's own (that it reads no clock is the clock guard's to hold).
    expect(drawn).not.toContain("Math.random");
    const css = source("./landing.css");
    // Every example lies in one cell, so the place is as tall as the tallest.
    expect(css).toMatch(/\.lp-sample__one \{\s*grid-area: 1 \/ 1;/);
    // Under reduced motion a beat arrives by tone alone: no animation is asked for there, only a step of opacity.
    const calm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(calm).toMatch(/\.lp-sample__one\[data-current="true"\] \.ah-spine__row \{\s*opacity: 1;\s*transition: opacity var\(--dur-reach\) var\(--ease-tone\);/);
    // The example's own rules there (up to the gesture cards') ask for no animation and no move.
    expect(calm.slice(0, calm.indexOf(".lp-flip")).replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/animation|transform/);
    // The receiver's two actions are not drawn, and no address of the page brings them.
    const screen = source("./index.tsx");
    expect(screen).toContain("<Sample />");
    expect(screen).not.toContain("location.search");
    expect(drawn).not.toContain("SwipeButton");
  });

  test("the landing repeats neither the header's own button nor the footer's link", () => {
    const screen = source("./index.tsx");
    expect(screen).not.toContain('href="/my"');
    expect(screen).not.toContain('href="/without-us"');
  });
});
