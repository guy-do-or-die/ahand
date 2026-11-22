/**
 * Plays one scenario: a browser context per persona (phone size, its own wallet, watched), every
 * step through the director's gate and a Playwright `test.step` (so the trace, the UI mode and the
 * HTML report show the story in the scenario's own words) with its `form` and `expect` checks,
 * then the end checks and the `watch` invariants. Whatever happens, the stand gets back what a
 * fault step took (a stopped relay, a blocked address) and every context is closed.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { expect, test, type Browser, type TestInfo } from "@playwright/test";

import { lensOn } from "../../e2e/lib/lens";
import { chainNow } from "../../e2e/lib/rpc";
import { Director, directorOptionsFromEnv, type Cast } from "./director";
import { baselineOf, checkAll } from "./expect";
import type { Check, Scenario } from "./scenario";
import { captionOf, run, type Actor, type Ctx } from "./verbs";
import { domOn, recordDom, saveDom, type StepMark } from "./dom";
import { captionIn, DIRECTOR_WORDS, LOCALE, nameIn, roleIn } from "./lang";
import { preflight } from "./preflight";
import { targetOf } from "./target";
import { walletOf, walletOnTarget } from "./wallets";
import { watch } from "./watch";
import { dollars, World } from "./world";

const PHONE = { width: 390, height: 844 };

export async function play(written: Scenario, browser: Browser, info: TestInfo): Promise<void> {
  const target = targetOf();
  // Each persona's "test account n" becomes this target's: the dev wallet, anvil's key, or a burner.
  const scenario: Scenario = { ...written, personas: Object.fromEntries(Object.entries(written.personas).map(([key, p]) => [key, { ...p, wallet: walletOnTarget(p.wallet, target) }])) };
  const world = new World(scenario, target);
  for (const note of await preflight(world, scenario)) info.annotations.push({ type: "note", description: note });
  world.startBlock = (await chainNow(world.chain)).number;
  await world.rememberPersonas();
  const director = new Director(scenario, directorOptionsFromEnv());
  // DEMO_VIDEO=1 keeps every persona's video; =on-failure records them and keeps them only when the scenario fails (CI).
  const video = process.env.DEMO_VIDEO === "1" || process.env.DEMO_VIDEO === "on-failure";
  const keepVideo = process.env.DEMO_VIDEO === "1";
  // The gallery (gallery.ts) finds a recorded scenario's folder by this file.
  if (keepVideo) {
    mkdirSync(dirname(info.outputPath("scenario.id")), { recursive: true });
    writeFileSync(info.outputPath("scenario.id"), `${written.id}\n`);
  }
  let failed = true;
  const actors = new Map<string, Actor>();
  // DEMO_DOM=1: every persona's page as rrweb events, and when each step began (dom.ts).
  const dom: Record<string, { name: string; role: string; color: string; events: unknown[] }> = {};
  const marks: StepMark[] = [];
  const cast: Cast[] = [];

  try {
    await warmDevServer(browser, world);
    let index = 0;
    for (const [key, base] of Object.entries(scenario.personas)) {
      const persona = { ...base, color: director.colorOf(index++, base) };
      const context = await browser.newContext({
        viewport: PHONE,
        // The app opens in the device's language (DEMO_LANG=ru: Russian).
        locale: LOCALE,
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
        ...(video ? { recordVideo: { dir: info.outputPath(`video-${key}`), size: PHONE } } : {}),
      });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const watched = await watch(context, { localOnly: scenario.watch?.includes("local-only") ?? false });
      if (domOn()) {
        dom[key] = { name: persona.name, role: persona.role, color: persona.color, events: [] };
        await recordDom(context, dom[key]!.events);
      }
      await walletOf(persona.wallet).prepare(context, persona.wallet as never, world);
      await director.dress(context, persona);
      const page = await context.newPage();
      // Leaving /raise before "I saved the link" asks first (beforeunload): the persona agrees.
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto("/");
      // Screens open in the calm view; the checks read the proof, which stands under the lens.
      // A persona with `lens: false` keeps the calm view, as an ordinary person sees it.
      if (persona.lens !== false) await lensOn(page);
      actors.set(key, { key, persona, page, watched });
      cast.push({ persona, context, page });
    }

    const ctx: Ctx = { world, director, actors, notes: { rail: [], predicted: [] }, form: async () => {} };
    const captions = scenario.steps.map((step) => captionIn(step, step.who ? scenario.personas[step.who]!.name : undefined, captionOf));
    await director.stage(browser, cast, [...captions, DIRECTOR_WORDS.checks]);
    const pages = cast.map((c) => c.page);

    for (const [i, step] of scenario.steps.entries()) {
      await director.gate(i);
      const actor = step.who ? actors.get(step.who) : undefined;
      await director.caption(actor ? [actor.page] : pages, captions[i]!);
      marks.push({ t: Date.now(), caption: captions[i]!, ...(step.who ? { who: step.who } : {}) });
      await test.step(`${i + 1}. ${captions[i]}`, async () => {
        const base = await baselineOf(world, step.expect);
        ctx.form = () => checkAll(ctx, actor, step.form, base);
        await run(ctx, actor, step);
        await checkAll(ctx, actor, step.expect, base);
      });
      await director.caption(actor ? [actor.page] : pages, "");
    }
    await director.gate(scenario.steps.length);
    await test.step("checks on the chain", async () => {
      for (const check of scenario.checks) await verify(world, check);
    });
    if (scenario.watch?.length) {
      await test.step(`every persona's browser: ${scenario.watch.join(", ")}`, () => {
        for (const { persona, watched } of actors.values()) {
          if (scenario.watch!.includes("local-only")) {
            expect(watched.offHost, `${persona.name} reached off host`).toEqual([]);
            expect([...new Set(watched.sent.map((s) => s.host))], `${persona.name}'s hosts`).toEqual(["127.0.0.1"]);
          }
          if (scenario.watch!.includes("no-errors")) expect(watched.errors, `${persona.name}'s page and console errors`).toEqual([]);
          if (scenario.watch!.includes("no-fragment-after-load")) {
            expect(watched.loads, `${persona.name}'s watch ran`).toBeGreaterThan(0);
            expect(watched.fragmentsAfterLoad, `${persona.name}'s address bar held a fragment`).toBe(0);
          }
        }
      });
    }
    await director.finish(keepVideo ? info.outputPath("director.png") : undefined);
    await director.caption(pages, DIRECTOR_WORDS.done);
    marks.push({ t: Date.now(), caption: DIRECTOR_WORDS.done });
    await director.beat(3_000);
    failed = false;
    if (domOn()) info.annotations.push({ type: "dom", description: saveDom(written.id, world.stand.site ?? "", Object.fromEntries(Object.entries(dom).map(([k, d]) => [k, { ...d, name: nameIn(d.name), role: roleIn(d.role) }])), marks) });
  } finally {
    await world.restore();
    for (const one of cast) await one.context.close().catch(() => undefined);
    if (video && !keepVideo && !failed) for (const key of Object.keys(scenario.personas)) rmSync(info.outputPath(`video-${key}`), { recursive: true, force: true });
  }
}

/**
 * In dev mode Vite prepares each screen's modules on its first visit and may reload the page once
 * while it does: one throwaway visit per route first, so no persona's page meets that later.
 */
async function warmDevServer(browser: Browser, world: World): Promise<void> {
  if (world.stand.mode !== "dev") return;
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of ["/", "/raise", "/my", "/thank", "/waiting", "/pass", "/give", `/${world.chainId}/1`]) {
    await page.goto(path, { waitUntil: "networkidle" }).catch(() => undefined);
  }
  await context.close();
}

async function verify(world: World, check: Check): Promise<void> {
  if ("state" in check) {
    expect(await world.stateOf(check.hand), `Hand "${check.hand}"`).toBe(check.state);
  } else if ("received" in check) {
    expect(await world.received(check.token ?? "usd", world.addr(check.received)), `${check.received} received`).toBe(dollars(check.amount));
  } else {
    const raiser = world.addr(world.raisers.get(check.askerWhole)!);
    expect(await world.received("usd", raiser), `the asker of "${check.askerWhole}" is whole`).toBe(0n);
  }
}
