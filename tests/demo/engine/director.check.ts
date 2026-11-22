/**
 * Checks the director window's controls without a stand: paused, the gate waits; Step lets one
 * step through; Play lets all through; + and − change the speed.
 *
 *   bun tests/demo/engine/director.check.ts
 */
import { chromium } from "@playwright/test";

import timesUp from "../scenarios/times-up";
import { Director } from "./director";

const browser = await chromium.launch();
const director = new Director(timesUp, { on: true, speed: 1, paused: true });
await director.stage(browser, [], ["one", "two", "three"]);
const panel = browser.contexts()[0]!.pages()[0]!;
const settled = (p: Promise<void>) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 400))]);
const fail = (why: string) => {
  console.error(`director: ${why}`);
  process.exit(1);
};

const first = director.gate(0);
if (await settled(first)) fail("a paused gate let the step through");
await panel.click("#step");
if (!(await settled(first))) fail("Step did not let the step through");
const second = director.gate(1);
if (await settled(second)) fail("after Step the director should stay paused");
await panel.click("#play");
if (!(await settled(second))) fail("Play did not let the step through");
if (!(await settled(director.gate(2)))) fail("playing, a gate should not wait");
await panel.click("#faster");
if (director.options.speed !== 1.5) fail(`+ should make ×1.5, made ×${director.options.speed}`);
await panel.keyboard.press(" ");
if (!director.options.paused) fail("space should pause");
if (!(await panel.textContent("#state"))?.includes("paused")) fail("the window should say paused");
await browser.close();
console.log("director: pause, step, play, speed and keys work");
