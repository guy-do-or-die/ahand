import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { GESTURE_EMOJI, GESTURE_KEYFRAMES, GestureEmoji, type GestureKind } from "./Gesture";
import { SwipeButton } from "./SwipeButton";

/**
 * The gesture emoji move (fixed on 2026-11-21 after the owner reported that they had stopped).
 * Each gesture idles with its own keyframes, the swipe buttons use the same class set, and reduced
 * motion still stops everything. The browser half of this (computed animation-name on the real screens) is
 * tests/e2e/smoke/gesture.spec.ts.
 */

const DESIGN = join(import.meta.dir, "../design");
const components = readFileSync(join(DESIGN, "components.css"), "utf8");
const tokens = readFileSync(join(DESIGN, "tokens.css"), "utf8");
const KINDS = Object.keys(GESTURE_EMOJI) as GestureKind[];

/** The declarations of the one top-level rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = [...css.matchAll(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "gm"))];
  expect(found.length).toBe(1);
  return found[0]![1]!;
}

describe("gesture emoji", () => {
  test.each(KINDS)("%s idles with its own keyframes, and they exist", (kind) => {
    const keyframes = GESTURE_KEYFRAMES[kind];
    expect(rule(components, `.ah-gesture--${kind}`)).toMatch(new RegExp(`animation:\\s*${keyframes}\\s[^;]*infinite`));
    expect(tokens).toMatch(new RegExp(`@keyframes ${keyframes}\\s*\\{[^@]*transform`));
  });

  test("the class can turn: an inline-block box as wide as its glyph", () => {
    const base = rule(components, ".ah-gesture");
    expect(base).toMatch(/display:\s*inline-block/);
    expect(base).toMatch(/width:\s*fit-content/);
    expect(base).toMatch(/transform-origin:/);
    expect(rule(components, ".ah-gesture--still")).toMatch(/animation:\s*none/);
  });

  test("reduced motion stops every animation, and only under reduced motion", () => {
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*\s*\{\s*animation:\s*none !important;/);
    // No other rule stops all animation unconditionally.
    const outside = tokens.replace(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\}\s*\}/g, "");
    expect(outside).not.toMatch(/animation:\s*none !important/);
    expect(components).not.toMatch(/animation:\s*none !important/);
  });

  test("GestureEmoji: decorative, named by its gesture, still on request", () => {
    const html = renderToStaticMarkup(<GestureEmoji kind="cheer" size={64} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-gesture="cheer"');
    expect(html).toContain("ah-gesture ah-gesture--cheer");
    expect(html).toContain("🙌");
    expect(html).toContain("font-size:64px");
    expect(html).not.toContain("ah-gesture--still");
    expect(renderToStaticMarkup(<GestureEmoji kind="raise" still />)).toContain("ah-gesture--still");
    expect(renderToStaticMarkup(<GestureEmoji kind="cheer" emoji="🫴" />)).toContain("🫴");
  });

  test.each(KINDS)("the %s swipe button carries the moving gesture", (kind) => {
    const html = renderToStaticMarkup(<SwipeButton gesture={kind}>Go</SwipeButton>);
    expect(html).toContain(`ah-gesture ah-gesture--${kind} ah-swipe__emoji ah-swipe__emoji--${kind}`);
    expect(html).toContain(GESTURE_EMOJI[kind]);
    expect(html).not.toContain("ah-gesture--still");
    expect(renderToStaticMarkup(<SwipeButton gesture={kind} still>Go</SwipeButton>)).toContain("ah-gesture--still");
  });

  test("a swipe button sets only the loop's pace, never a second animation", () => {
    for (const kind of KINDS) {
      const declarations = rule(components, `.ah-swipe__emoji--${kind}`);
      expect(declarations).toMatch(/--gesture-dur:/);
      expect(declarations).not.toMatch(/animation/);
    }
  });
});
