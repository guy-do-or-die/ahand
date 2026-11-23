import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { GESTURE_EMOJI, GESTURE_KEYFRAMES, GestureEmoji, type GestureKind } from "./Gesture";
import { SwipeButton } from "./SwipeButton";

/**
 * The gesture emoji move. Each gesture moves
 * with its own keyframes, once in a round and one at a time, the
 * swipe buttons use the same class set, and reduced motion still stops everything. The browser
 * half of this (computed animation-name on the real screens) is tests/e2e/smoke/gesture.spec.ts.
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

  test("a swipe button says only when its gesture moves, never a second animation", () => {
    expect(rule(components, ".ah-swipe__emoji")).toMatch(/--gesture-turn:\s*1\.25s/);
    // A gesture's own rule on the hand, where there is one, says when it moves and nothing of how:
    // no rule whose selector names a gesture's hand holds an animation, however the selector is written.
    expect(components.match(/^\.ah-swipe__emoji--[a-z]+\s*\{[^}]*\}/gm)).toHaveLength(1);
    const named = components.match(/[^{}]*\.ah-swipe__emoji--[a-z]+[^{}]*\{[^}]*\}/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const found of named) expect(found.slice(found.indexOf("{"))).not.toMatch(/animation/);
    // "Pass it on" stands beside "I can help": the two never move together.
    expect(rule(components, ".ah-swipe__emoji--shake")).toMatch(/--gesture-turn:\s*3\.75s/);
  });

  test("one round for every gesture: a move at its start, then rest", () => {
    expect(tokens).toMatch(/--dur-gesture:\s*5s/);
    for (const kind of KINDS) {
      expect(rule(components, `.ah-gesture--${kind}`)).toMatch(/var\(--dur-gesture\)[^;]*var\(--gesture-turn, 0s\)/);
      // Each gesture is back at rest well before the round's middle: the last moving keyframe is under 25%.
      const frames = tokens.match(new RegExp(`@keyframes ${GESTURE_KEYFRAMES[kind]}\\s*\\{([\\s\\S]*?)\\n\\}`))![1]!;
      const moving = [...frames.matchAll(/([0-9%,\s]+)\{\s*transform:\s*(?=\S)(?!none)/g)].flatMap((found) => found[1]!.match(/[0-9]+/g)!.map(Number));
      expect(moving.length).toBeGreaterThan(0);
      expect(Math.max(...moving)).toBeLessThan(25);
    }
  });

  test("a gesture given a turn carries it; the Deal card's hand greets once", () => {
    expect(renderToStaticMarkup(<GestureEmoji kind="shake" turn={3.1} />)).toContain("--gesture-turn:3.1s");
    expect(renderToStaticMarkup(<GestureEmoji kind="shake" />)).not.toContain("--gesture-turn");
    expect(rule(components, ".ah-deal__gesture")).toMatch(/animation-iteration-count:\s*1/);
  });
});

/**
 * The swipe button's fill: a layer under a mask, a fade of its own for each fill, and an answer to
 * the pointer and to a press that is one clear step of tone. The browser half (computed colours,
 * the press held for a tap) is tests/e2e/smoke/gesture.spec.ts.
 */
describe("the swipe button's fill", () => {
  const base = rule(components, ".ah-swipe");
  const amber = rule(components, ".ah-swipe--amber");
  const layer = rule(components, ".ah-swipe::before");

  test("the fill is a layer under a mask, so its colour can change as one tone", () => {
    expect(base).toMatch(/background:\s*none/);
    expect(base).not.toMatch(/background:\s*linear-gradient/);
    expect(layer).toMatch(/background-color:\s*var\(--swipe-fill\)/);
    expect(layer).toMatch(/-webkit-mask-image:\s*var\(--swipe-mask\)/);
    expect(layer).toMatch(/[^-]mask-image:\s*var\(--swipe-mask\)/);
    expect(layer).toMatch(/transition:\s*background-color var\(--dur-tone-out\)/);
  });

  test("each fill has its own fade, anchored from the edge where the hand is: a short one for ink, a long one for amber that is nearly gone where the hand begins", () => {
    // Every anchor is a place on the hand, written from the hand's one size and place, so the fade
    // is the same on every button: the ink fade begins nearly two hands back and is gone under
    // the hand's middle; the amber one begins three hands back, is nearly gone where the hand
    // begins and gone under it. A button too narrow for that keeps the fade off its label.
    expect(base).toMatch(/--hand-size:\s*64px/);
    expect(base).toMatch(/--hand-right:\s*2px/);
    expect(base).toMatch(/--label-room:\s*150px/);
    expect(base).toMatch(/--swipe-from:\s*max\(calc\(var\(--swipe-to\) \+ 8px\), min\(calc\(var\(--hand-right\) \+ var\(--hand-size\) \* 1\.8\), calc\(100% - var\(--label-room\)\)\)\)/);
    expect(base).toMatch(/--swipe-to:\s*calc\(var\(--hand-right\) \+ var\(--hand-size\) \* 0\.4\)/);
    // Neither fade begins inside the label's room: a narrow button has a shorter fade, never a faded label.
    expect(amber).toMatch(/--swipe-from:\s*max\(calc\(var\(--swipe-hand\) \+ 8px\), min\(calc\(var\(--hand-right\) \+ var\(--hand-size\) \* 3\), calc\(100% - var\(--label-room\)\)\)\)/);
    expect(amber).toMatch(/--swipe-hand:\s*calc\(var\(--hand-right\) \+ var\(--hand-size\) \* 1\.1\)/);
    expect(amber).toMatch(/--swipe-to:\s*calc\(var\(--hand-right\) \+ var\(--hand-size\) \* 0\.2\)/);
    // Every stop is placed from the right edge by the variables, so a variant only moves the anchors.
    for (const declarations of [base, amber]) {
      const mask = declarations.match(/--swipe-mask:\s*linear-gradient\(([\s\S]*?)\n  \);/)![1]!;
      const stops = mask.split(",\n").slice(1);
      expect(stops.length).toBeGreaterThan(10);
      for (const stop of stops) expect(stop).toMatch(/calc\(100% - var\(--swipe-(from|hand)\)/);
      // The curve only thins: no stop is more opaque than the one before it.
      const alphas = stops.slice(1).map((stop) => (stop.trim().startsWith("transparent") ? 0 : Number(stop.match(/rgb\(var\(--ink-rgb\) \/ ([0-9.]+)\)/)![1])));
      expect(alphas).toEqual([...alphas].sort((a, b) => b - a));
      expect(alphas.at(-1)).toBe(0);
    }
    // No stop is made with color-mix(): a browser without it would drop the whole mask and leave a hard edge.
    for (const declarations of [base, amber]) expect(declarations).not.toContain("color-mix(");
    // Amber keeps 22% of itself where the hand begins.
    expect(amber).toMatch(/rgb\(var\(--ink-rgb\) \/ 0\.2\d+\) calc\(100% - var\(--swipe-from\) \+ \(var\(--swipe-from\) - var\(--swipe-hand\)\) \* (0\.9\d+|1\.0+)\)/);
  });

  test("there is one button: one hand of one size in one place for every gesture, and no variant by size", () => {
    // The hand is drawn from the same two numbers the fade reads, in a box of one width in every emoji font.
    const hand = rule(components, ".ah-swipe__emoji");
    expect(hand).toMatch(/right:\s*var\(--hand-right\)/);
    expect(hand).toMatch(/font-size:\s*var\(--hand-size\)/);
    expect(hand).toMatch(/width:\s*1\.2em/);
    // Centred by layout: a glyph wider than the box hangs over both sides alike (text-align would start-align it).
    expect(hand).toMatch(/display:\s*flex/);
    expect(hand).toMatch(/justify-content:\s*center/);
    expect(hand).not.toMatch(/text-align\s*:/);
    // Two fills, and nothing else: no compact, hero or card button, and no size or place of a gesture's own.
    expect([...new Set(components.match(/\.ah-swipe--[a-z]+/g))].sort()).toEqual([".ah-swipe--amber"]);
    expect(components.match(/--hand-(?:size|right):/g)).toHaveLength(2);
    expect(components.match(/--swipe-(?:from|to|hand):/g)).toHaveLength(5);
    expect(components).not.toMatch(/\.ah-swipe__emoji--[a-z]+\s*\{[^}]*(?:font-size|right|bottom):/);
    // And the component offers none.
    const html = renderToStaticMarkup(<SwipeButton gesture="shake">Go</SwipeButton>);
    expect(html).toMatch(/class="ah-swipe ah-swipe--ink"/);
  });

  test("the answer is a step of tone: under the pointer, deeper under a press at once, and the button gives 2%", () => {
    expect(components).toMatch(/\.ah-swipe:not\(:disabled\):hover::before\s*\{\s*background-color:\s*var\(--swipe-fill-hover\);\s*transition-duration:\s*var\(--dur-tone\)/);
    expect(components).toMatch(/\.ah-swipe:not\(:disabled\):is\(:active, \[data-pressed\]\)::before\s*\{\s*background-color:\s*var\(--swipe-fill-press\);\s*transition-duration:\s*0s/);
    expect(components).toMatch(/\.ah-swipe:not\(:disabled\):is\(:active, \[data-pressed\]\)\s*\{\s*transform:\s*scale\(0\.98\)/);
    // No sweep and no second animation on the button: the tone is the whole answer.
    expect(components).not.toMatch(/\.ah-swipe[^{]*\{[^}]*background-position/);
  });

  test("every theme scope names both answers of the ink fill, and paper steps darker, not lighter", () => {
    const scopes = [...tokens.matchAll(/--ink:\s*var\(--ah-raw-(ink|paper)\);[^}]*?--ink-hover:\s*var\(--ah-raw-(ink|paper)-hover\);\s*--ink-press:\s*var\(--ah-raw-(ink|paper)-press\);/g)];
    expect(scopes.length).toBe(3);
    for (const scope of scopes) expect(scope[2]).toBe(scope[1]);
    const hex = (name: string) => parseInt(tokens.match(new RegExp(`--ah-raw-${name}:\\s*#([0-9a-f]{6})`))![1]!.slice(0, 2), 16);
    expect(hex("paper-hover")).toBeLessThan(hex("paper"));
    expect(hex("paper-press")).toBeLessThan(hex("paper-hover"));
    expect(hex("ink-hover")).toBeGreaterThan(hex("ink"));
    expect(hex("amber-press")).toBeLessThan(hex("amber"));
  });

  test("a press is held on the button itself, and a disabled button never shows one", () => {
    expect(renderToStaticMarkup(<SwipeButton gesture="cheer">Go</SwipeButton>)).not.toContain("data-pressed");
    expect(renderToStaticMarkup(<SwipeButton gesture="cheer" disabled>Go</SwipeButton>)).not.toContain("data-pressed");
  });
});
