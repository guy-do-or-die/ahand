/**
 * The director: what makes a scenario watchable. Off (DEMO unset) it does nothing but wait zero
 * milliseconds, so the same scenario runs at full speed in CI.
 *
 * On (DEMO=1, headed):
 *   - every persona's page carries an overlay in a closed shadow root: a badge with the persona's
 *     name and role, a caption bar, and a ring drawn around the element about to be pressed;
 *   - a director window lists the steps, marks the current one, and has Pause, Step, Play and a
 *     speed control (keys: space, →, +, −); the engine waits at its gate before every step;
 *   - the windows are tiled left to right on the screen through the Chrome DevTools Protocol
 *     (Browser.setWindowBounds), so all personas are visible at once for a live show.
 */
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";

import { DIRECTOR_WORDS, nameIn, roleIn, titleOf } from "./lang";
import type { Persona, Scenario } from "./scenario";

export interface DirectorOptions {
  on: boolean;
  /** 1 = normal pace; 2 = twice as fast; 0.5 = half. */
  speed: number;
  /** Start paused, waiting for Step or Play in the director window. */
  paused: boolean;
}

export function directorOptionsFromEnv(env = process.env): DirectorOptions {
  const on = env.DEMO === "1";
  const speed = Number(env.DEMO_SPEED ?? 1);
  return { on, speed: speed > 0 ? speed : 1, paused: on && env.DEMO_PAUSED === "1" };
}

const COLORS = ["#d9480f", "#1971c2", "#2f9e44", "#9c36b5", "#e67700", "#0c8599"];

/** Installed before the app's scripts in every page of a persona's context. Draws nothing until called. */
function overlayScript(me: { name: string; role: string; color: string }): void {
  type Api = { caption(text: string): void; ring(box: { x: number; y: number; width: number; height: number } | null): void };
  const host = document.createElement("ahand-demo-overlay");
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .badge { position: fixed; top: 6px; right: 6px; z-index: 2147483647; pointer-events: none;
        font: 600 12px/1.2 system-ui, sans-serif; color: #fff; background: ${me.color};
        padding: 4px 8px; border-radius: 999px; box-shadow: 0 1px 4px #0004; }
      .caption { position: fixed; left: 8px; right: 8px; bottom: 10px; z-index: 2147483647; pointer-events: none;
        font: 500 14px/1.35 system-ui, sans-serif; color: #fff; background: #111d; border-left: 4px solid ${me.color};
        padding: 8px 10px; border-radius: 8px; opacity: 0; transition: opacity .25s; }
      .caption.on { opacity: 1; }
      .ring { position: fixed; z-index: 2147483646; pointer-events: none; border: 3px solid ${me.color};
        border-radius: 10px; box-shadow: 0 0 0 4px ${me.color}44; transition: all .2s; display: none; }
    </style>
    <div class="badge">${me.name} · ${me.role}</div>
    <div class="caption"></div>
    <div class="ring"></div>`;
  const caption = root.querySelector(".caption") as HTMLElement;
  const ring = root.querySelector(".ring") as HTMLElement;
  const api: Api = {
    caption(text) {
      caption.textContent = text;
      caption.classList.toggle("on", text !== "");
    },
    ring(box) {
      if (!box) return void (ring.style.display = "none");
      Object.assign(ring.style, { display: "block", left: `${box.x - 6}px`, top: `${box.y - 6}px`, width: `${box.width + 6}px`, height: `${box.height + 6}px` });
    },
  };
  (window as unknown as { __ahandDemo: Api }).__ahandDemo = api;
  const mount = () => document.documentElement.appendChild(host);
  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount);
}

const PANEL = `<!doctype html><meta charset="utf-8"><title>aHand · director</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 0; padding: 14px; background: #0f1115; color: #e8e8e8; }
  h1 { font-size: 15px; margin: 0 0 4px; } p.story { color: #aab; font-size: 12px; margin: 0 0 10px; }
  .who { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .who span { padding: 2px 8px; border-radius: 999px; color: #fff; font-size: 12px; }
  ol { padding-left: 22px; margin: 0; } li { padding: 3px 0; color: #889; }
  li.done { color: #8c8; } li.now { color: #fff; font-weight: 600; } li.now::marker { color: #ffd43b; }
  .bar { position: sticky; top: 0; display: flex; gap: 6px; align-items: center; background: #0f1115; padding-bottom: 10px; }
  button { font: inherit; background: #222832; color: #fff; border: 1px solid #3a4250; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  .state { margin-left: auto; font-size: 12px; color: #ffd43b; }
</style>
<div class="bar"><button id="pause">❚❚</button><button id="step">Step ›</button><button id="play">▶</button>
<button id="slower">−</button><span id="speed"></span><button id="faster">+</button><span class="state" id="state"></span></div>
<h1 id="title"></h1><p class="story" id="story"></p><div class="who" id="who"></div><ol id="steps"></ol>
<script>
  const send = (cmd) => window.__director(cmd);
  for (const id of ["pause", "step", "play", "slower", "faster"]) document.getElementById(id).onclick = () => send(id);
  addEventListener("keydown", (e) => { const k = { " ": "toggle", ArrowRight: "step", "+": "faster", "=": "faster", "-": "slower" }[e.key]; if (k) { e.preventDefault(); send(k); } });
  window.render = (s) => {
    document.getElementById("title").textContent = s.title;
    document.getElementById("story").textContent = s.story;
    document.getElementById("speed").textContent = "×" + s.speed;
    document.getElementById("state").textContent = s.paused ? s.words.paused : s.finished ? s.words.finished : s.words.playing;
    document.getElementById("step").textContent = s.words.step + " ›";
    document.getElementById("who").innerHTML = s.personas.map((p) => '<span style="background:' + p.color + '">' + p.name + " · " + p.role + "</span>").join("");
    document.getElementById("steps").innerHTML = s.steps.map((t, i) => '<li class="' + (i < s.at ? "done" : i === s.at ? "now" : "") + '">' + t + "</li>").join("");
    document.querySelector("li.now")?.scrollIntoView({ block: "nearest" });
  };
</script>`;

export interface Cast {
  persona: Persona & { color: string };
  context: BrowserContext;
  page: Page;
}

export class Director {
  readonly options: DirectorOptions;
  private panel?: Page;
  private at = 0;
  private stepRequested = false;
  private finished = false;
  private captions: string[] = [];

  constructor(
    private readonly scenario: Scenario,
    options: DirectorOptions,
  ) {
    this.options = { ...options };
  }

  colorOf(index: number, persona: Persona): string {
    return persona.color ?? COLORS[index % COLORS.length]!;
  }

  /** Called by the engine for every new persona context, before its first page. */
  async dress(context: BrowserContext, persona: Persona & { color: string }): Promise<void> {
    if (!this.options.on) return;
    await context.addInitScript(overlayScript, { name: nameIn(persona.name), role: roleIn(persona.role), color: persona.color });
  }

  /** Opens the director window and tiles every persona's window beside it. */
  async stage(browser: Browser, cast: Cast[], captions: string[]): Promise<void> {
    this.captions = captions;
    if (!this.options.on) return;
    const context = await browser.newContext({ viewport: { width: 380, height: 760 } });
    await context.exposeBinding("__director", (_source, cmd: string) => this.command(cmd));
    this.panel = await context.newPage();
    await this.panel.setContent(PANEL);
    await this.render();
    const width = 380 + 16;
    await tile(this.panel, 0, width, 900);
    let left = width + 4;
    for (const one of cast) {
      const size = one.page.viewportSize() ?? { width: 390, height: 844 };
      await tile(one.page, left, size.width + 16, size.height + 90);
      left += size.width + 20;
      // Playwright's own annotations (1.59+): an animated cursor and a box on every pressed element.
      await one.page.screencast.showActions({
        cursor: "pointer",
        duration: 900,
        position: "top-left",
        // The action's own title ("Click getByTestId(…)") is for testers: DEMO_ACTION_TITLES=1 shows it.
        style: { highlight: `outline: 3px solid ${one.persona.color}; border-radius: 8px`, title: process.env.DEMO_ACTION_TITLES === "1" ? "font-size: 13px" : "display: none" },
      });
    }
    // A chapter card on every phone: the scenario's title and story (Playwright 1.59+).
    await Promise.all(cast.map((one) => one.page.screencast.showChapter(titleOf(this.scenario).title, { description: titleOf(this.scenario).story, duration: 4_000 / this.options.speed })));
    await this.beat(4_000);
  }

  private command(cmd: string): void {
    const o = this.options;
    if (cmd === "pause") o.paused = true;
    else if (cmd === "play") o.paused = false;
    else if (cmd === "toggle") o.paused = !o.paused;
    else if (cmd === "step") {
      o.paused = true;
      this.stepRequested = true;
    } else if (cmd === "faster") o.speed = Math.min(8, +(o.speed * 1.5).toFixed(2));
    else if (cmd === "slower") o.speed = Math.max(0.25, +(o.speed / 1.5).toFixed(2));
    void this.render();
  }

  private async render(): Promise<void> {
    if (!this.panel) return;
    const s = this.scenario;
    const personas = Object.values(s.personas).map((p, i) => ({ name: nameIn(p.name), role: roleIn(p.role), color: this.colorOf(i, p) }));
    const state = { ...titleOf(s), words: DIRECTOR_WORDS, speed: this.options.speed, paused: this.options.paused, finished: this.finished, personas, steps: this.captions, at: this.at };
    await this.panel.evaluate((st) => (window as unknown as { render(x: unknown): void }).render(st), state).catch(() => undefined);
  }

  /** Waits before step `index`: while paused, until Step or Play is pressed. */
  async gate(index: number): Promise<void> {
    this.at = index;
    await this.render();
    if (!this.options.on) return;
    while (this.options.paused && !this.stepRequested) await new Promise((r) => setTimeout(r, 100));
    this.stepRequested = false;
  }

  /** Marks every step done; with `shot`, saves the director window as a picture there. */
  async finish(shot?: string): Promise<void> {
    this.at = this.captions.length;
    this.finished = true;
    await this.render();
    if (shot && this.panel) await this.panel.screenshot({ path: shot, fullPage: true });
  }

  /** A pause scaled by the speed; zero when the director is off. */
  async beat(ms = 700): Promise<void> {
    if (!this.options.on) return;
    await new Promise((r) => setTimeout(r, ms / this.options.speed));
  }

  private readonly shown = new Map<Page, string>();

  /** Shows a caption on these pages and keeps it there across their navigations until replaced. */
  async caption(pages: Page[], text: string): Promise<void> {
    if (!this.options.on) return;
    const show = (p: Page, t: string) => p.evaluate((x) => (window as unknown as { __ahandDemo?: { caption(t: string): void } }).__ahandDemo?.caption(x), t).catch(() => undefined);
    await Promise.all(
      pages.map((p) => {
        if (!this.shown.has(p)) p.on("domcontentloaded", () => void show(p, this.shown.get(p) ?? ""));
        this.shown.set(p, text);
        return show(p, text);
      }),
    );
  }

  /** Rings the element, waits a beat, then lets the verb press it. */
  async point(locator: Locator): Promise<void> {
    if (!this.options.on) return;
    // Only what is on screen now: an element that went away (a sheet closing after a pick) must
    // not hold the show while Playwright waits for it (it waited 2 × 20 s here before).
    if (!(await locator.isVisible().catch(() => false))) return;
    await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
    const box = await locator.boundingBox({ timeout: 2_000 }).catch(() => null);
    await locator.page().evaluate((b) => (window as unknown as { __ahandDemo?: { ring(b: unknown): void } }).__ahandDemo?.ring(b), box).catch(() => undefined);
    await this.beat(600);
    await locator.page().evaluate(() => (window as unknown as { __ahandDemo?: { ring(b: unknown): void } }).__ahandDemo?.ring(null)).catch(() => undefined);
  }
}

/** Moves and sizes a page's window (Chromium, headed). Fails quietly elsewhere. */
async function tile(page: Page, left: number, width: number, height: number): Promise<void> {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = (await cdp.send("Browser.getWindowForTarget")) as { windowId: number };
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left, top: 0, width, height } });
    await cdp.detach();
  } catch {
    /* headless, or not Chromium: nothing to tile */
  }
}
