/**
 * The verbs: one function per Action of scenario.ts, written once with the app's own test ids
 * (apps/web/src/testids.ts) and, where a control has no id, the app's own words (words.ts). A
 * renamed id or a removed sentence breaks the typecheck; a reworded one is followed.
 *
 * A verb checks what is part of doing it at all (the pass made a new address, the give was
 * delivered, the thank's receipt came); everything a scenario wants to prove beyond that goes in
 * the step's `expect`, and checks on a form before its last press go in the step's `form`, which
 * the verb runs through `ctx.form()` right before that press.
 *
 * Every press goes through `press`, which lets the director ring the element first.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import type { Address, Hex } from "viem";

import { TID } from "../../../apps/web/src/testids";
import { pathToFileURL } from "node:url";

import { chainNow, coreAbi, hands } from "../../e2e/lib/rpc";
import type { Director } from "./director";
import type { Action, Payee, Persona } from "./scenario";
import { walletOf } from "./wallets";
import type { Watched } from "./watch";
import { LANG } from "./lang";
import { phrase } from "./words";
import type { World } from "./world";

export interface Actor {
  key: string;
  persona: Persona;
  page: Page;
  watched: Watched;
}

/** What a verb saw that a later check needs (the rail's states, the predicted rows, the chain time before a raise). */
export interface Notes {
  rail: string[];
  raiseAt?: { timestamp: number; nonce: number; days: number; hand: string };
  predicted: { kind: string; payee: string; amount: string }[];
  /** The answer card open on /my, by the asker's key. */
  answer?: Locator;
  /** A Hand's end before Care moved it. */
  expiryBefore?: { hand: string; expiry: number };
}

export interface Ctx {
  world: World;
  director: Director;
  actors: Map<string, Actor>;
  notes: Notes;
  /** Runs the step's `form` checks; a verb calls it right before its last press. */
  form: () => Promise<void>;
}

async function press(ctx: Ctx, locator: Locator): Promise<void> {
  await ctx.director.point(locator);
  await locator.click();
}

async function type(ctx: Ctx, locator: Locator, text: string): Promise<void> {
  await ctx.director.point(locator);
  if (ctx.director.options.on) await locator.pressSequentially(text, { delay: 18 / ctx.director.options.speed });
  else await locator.fill(text);
}

async function choose(actor: Actor): Promise<void> {
  await walletOf(actor.persona.wallet).choose(actor.page, actor.persona.wallet as never);
}

/** Connects the persona's wallet unless the page already shows one connected. */
async function connected(actor: Actor): Promise<void> {
  if ((await actor.page.getByTestId(TID.wallet.connected).count()) === 0) await choose(actor);
  const address = walletOf(actor.persona.wallet).address(actor.persona.wallet as never);
  if (address) await expect(actor.page.getByTestId(TID.wallet.connected).first()).toHaveAttribute("data-value", address);
}

/**
 * Answers the connect sheet and the raise's keys card as often as they come. It waits for this
 * persona's own entry in the sheet, not for the sheet: a sheet that flashes while closing after a
 * pick would otherwise be answered again while the keys card is already up.
 */
async function answerPrompts(ctx: Ctx, actor: Actor): Promise<void> {
  const { page, persona } = actor;
  const entry = walletOf(persona.wallet).entry(page, persona.wallet as never);
  const keys = page.getByTestId(TID.raise.keysConfirm);
  for (let round = 0; round < 3; round++) {
    const which = await Promise.race([
      entry.waitFor({ timeout: 15_000 }).then(() => "connect" as const),
      keys.waitFor({ timeout: 15_000 }).then(() => "keys" as const),
    ]).catch(() => undefined);
    // The keys card wins when both show: the sheet may still be closing after the pick.
    if (which === "keys" || (await keys.isVisible())) {
      await ctx.director.beat(500);
      return press(ctx, keys);
    }
    if (which !== "connect") return;
    await ctx.director.beat(500);
    const kind = walletOf(persona.wallet);
    if (kind.answer) {
      await kind.answer(page, persona.wallet as never);
      continue;
    }
    // The pick can race the sheet closing; a missed press is retried by the next round.
    await ctx.director.point(entry);
    await entry.click({ timeout: 5_000 }).catch(() => undefined);
  }
}

/** The address a payee choice lands at; a fresh one is made (and named) here. */
function payeeAddress(ctx: Ctx, actor: Actor, payee: Payee): Address | null {
  if (payee === "wallet") return walletOf(actor.persona.wallet).address(actor.persona.wallet as never);
  return ctx.world.freshAddress(payee === "fresh-address" ? actor.key : payee.fresh);
}

/** The payee sheet ("Where should … land?"): an address pasted into "An address I have". */
async function landAt(ctx: Ctx, actor: Actor, address: Address, opener: "radio" | "sheet"): Promise<void> {
  const { page } = actor;
  if (opener === "sheet") {
    await press(ctx, page.getByRole("button", { name: phrase("pass.land.choose") }));
    await press(ctx, page.getByText(phrase("kit.land.address")));
  } else {
    await press(ctx, page.getByRole("radio", { name: phrase("kit.land.address") }));
  }
  await type(ctx, page.getByRole("textbox", { name: phrase("kit.land.addressLabel") }), address);
  if (opener === "sheet") {
    await expect(page.locator('[data-reading="ok"]')).toBeVisible();
    await press(ctx, page.getByRole("button", { name: phrase("kit.land.done") }));
  }
}

/** Records every value the raise's tx rail takes, in order (window.__demoRail). */
async function recordRail(page: Page): Promise<void> {
  await page.evaluate((testId) => {
    const w = window as unknown as { __demoRail: string[] };
    w.__demoRail = [];
    const note = () => {
      for (const rail of Array.from(document.querySelectorAll(`[data-testid="${testId}"]`))) {
        const value = rail.getAttribute("data-value") ?? "";
        if (w.__demoRail.at(-1) !== value) w.__demoRail.push(value);
      }
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-value"] });
  }, TID.raise.txRail);
}

async function rows(page: Page, testId: string) {
  return page.getByTestId(testId).evaluateAll((items) =>
    items.map((item) => ({ kind: item.getAttribute("data-kind")!, payee: item.getAttribute("data-payee")!, amount: item.getAttribute("data-amount")!, landed: item.getAttribute("data-landed") ?? "" })),
  );
}

export async function run(ctx: Ctx, who: Actor | undefined, action: Action): Promise<void> {
  const { world } = ctx;
  switch (action.do) {
    case "say":
      return ctx.director.beat(2_500);

    case "look":
      return ctx.director.beat(1_500);

    case "clock":
      await world.moveClock(action.days);
      return ctx.director.beat(1_500);

    case "block":
      await world.block(world.addr(action.address), action.blocked);
      return ctx.director.beat(800);

    case "service":
      world.service(action.service, action.on);
      return ctx.director.beat(800);

    case "raise": {
      const actor = who!;
      const { page } = actor;
      await page.goto("/raise");
      await expect(page.getByTestId(TID.raise.what)).toBeVisible({ timeout: 30_000 });
      await type(ctx, page.getByTestId(TID.raise.what), LANG === "ru" ? (action.titleRu ?? action.title) : action.title);
      if (action.details) {
        await press(ctx, page.getByTestId(TID.raise.detailsToggle));
        await type(ctx, page.getByTestId(TID.raise.details), LANG === "ru" ? (action.detailsRu ?? action.details) : action.details);
      }
      if (typeof action.reward === "string") {
        await press(ctx, page.locator(`[data-testid="${TID.raise.rewardChip}"][data-value="${action.reward}"]`));
      } else {
        await press(ctx, page.locator(`[data-testid="${TID.raise.rewardChip}"][data-value="custom"]`));
        await type(ctx, page.getByTestId(TID.raise.rewardCustom).locator("input"), action.reward.custom);
      }
      const days = action.days ?? 30;
      await press(ctx, page.locator(`[data-testid="${TID.raise.expiryChip}"][data-value="${days}"]`));
      await press(ctx, page.locator(`[data-testid="${TID.raise.visibility}"][data-value="${action.visibility ?? "unlisted"}"]`));
      if (action.fineTune) await press(ctx, page.getByTestId(TID.raise.fineTune));
      const raiser = walletOf(actor.persona.wallet).address(actor.persona.wallet as never);
      if (raiser) await world.remember("usd", raiser);
      await recordRail(page);
      await ctx.form();
      const now = await chainNow(world.chain);
      const nonce = raiser ? await world.chain.client.getTransactionCount({ address: raiser }) : 0;
      ctx.notes.raiseAt = { timestamp: now.timestamp, nonce, days, hand: action.as };
      await expect(page.getByTestId(TID.raise.swipe)).toBeEnabled({ timeout: 15_000 });
      await press(ctx, page.getByTestId(TID.raise.swipe));
      await answerPrompts(ctx, actor);
      const up = page.getByTestId(TID.raise.up);
      await expect(up).toBeVisible({ timeout: 45_000 });
      world.handIds.set(action.as, BigInt((await up.getAttribute("data-hand-id"))!));
      world.raisers.set(action.as, actor.key);
      await ctx.director.beat(800);
      await press(ctx, page.getByTestId(TID.raise.copy).getByRole("button"));
      world.links.set(action.as, await page.evaluate(() => navigator.clipboard.readText()));
      ctx.notes.rail = await page.evaluate(() => (window as unknown as { __demoRail?: string[] }).__demoRail ?? []);
      // A signer that answers differently each time cannot rebuild the link: the page keeps a
      // locked copy until the person says the link is saved. They saved it: they copied it.
      if (await page.getByTestId(TID.raise.lockedCopy).isVisible()) {
        await ctx.director.beat(1_000);
        await ctx.director.point(page.getByTestId(TID.raise.savedTick));
        await page.getByTestId(TID.raise.savedTick).check();
        await expect(page.getByTestId(TID.raise.copyGone)).toBeVisible({ timeout: 15_000 });
      }
      return;
    }

    case "raise-sdk": {
      const flags = ["--token", action.token ?? "usd", "--reward", action.reward, "--title", action.title, "--mode", action.mode ?? "unlisted"];
      if (action.gasK !== undefined) flags.push("--gas-k", String(action.gasK));
      const made = world.craft<{ handId: string; address: string }>("make", ...flags);
      world.handIds.set(action.as, BigInt(made.handId));
      world.links.set(action.as, made.address);
      world.raisers.set(action.as, who!.key);
      return ctx.director.beat(800);
    }

    case "open": {
      const { page } = who!;
      await page.goto(world.link(action.link));
      await expect(page.getByTestId(TID.hand.dealCard)).toBeVisible({ timeout: 30_000 });
      // The fragment is taken into the tab and leaves the address bar.
      await expect.poll(() => page.evaluate(() => location.href)).not.toContain("#");
      return ctx.director.beat(1_200);
    }

    case "pass": {
      const actor = who!;
      const { page } = actor;
      await press(ctx, page.getByTestId(TID.hand.pass));
      await expect(page).toHaveURL(/\/pass$/);
      const bps = action.keepBps ?? 0;
      let payee: Address | null = null;
      if (bps > 0) {
        await ctx.director.point(page.getByTestId(TID.pass.slider));
        await page.getByTestId(TID.pass.slider).fill(String(bps));
        await expect(page.getByTestId(TID.pass.shareMoney)).toHaveAttribute("data-value", String(bps));
        const choice: Payee = action.payee ?? "fresh-address";
        // "wallet": the holder pastes their own wallet's address (no connection is needed to pass).
        payee = payeeAddress(ctx, actor, choice);
        if (!payee) throw new Error(`pass: ${actor.persona.name} has no wallet address to paste`);
        await landAt(ctx, actor, payee!, "sheet");
      }
      await ctx.form();
      await press(ctx, page.getByTestId(TID.pass.swipe));
      const readBack = page.getByTestId(TID.pass.readBack);
      await expect(readBack).toHaveAttribute("data-bps", String(bps));
      if (payee) await expect(readBack).toHaveAttribute("data-payee", payee);
      const text = ((await page.getByTestId(TID.pass.copy).locator(".ah-linkrow__value").textContent()) ?? "").trim();
      expect(text, "a pass makes an address").toContain("#");
      expect([...world.links.values()], "a pass makes a new address").not.toContain(text);
      world.links.set(action.as, text);
      return ctx.director.beat(800);
    }

    case "give": {
      const actor = who!;
      const { page } = actor;
      await press(ctx, page.getByTestId(TID.hand.help));
      await expect(page).toHaveURL(/\/give$/);
      await type(ctx, page.getByTestId(TID.give.words), action.words);
      const choice = action.payee ?? "wallet";
      const payee = payeeAddress(ctx, actor, choice);
      if (choice === "wallet") {
        // "Connect a wallet", or "Log in to get paid" in a build with Privy (whose window opens at once).
        const opener = page.getByRole("button", { name: phrase("kit.land.connect") }).or(page.getByRole("button", { name: phrase("kit.land.logIn") }));
        await press(ctx, opener.first());
        await choose(actor);
      } else {
        await landAt(ctx, actor, payee!, "radio");
      }
      if (payee) {
        await world.remember("usd", payee);
        await expect(page.getByTestId(TID.give.agree).locator("[data-payee]")).toHaveAttribute("data-payee", payee);
      }
      await ctx.form();
      await press(ctx, page.getByTestId(TID.give.swipe));
      await walletOf(actor.persona.wallet).approve?.(page, actor.persona.wallet as never);
      if ((action.delivery ?? "relay") === "relay") await expect(page.getByTestId(TID.give.delivered)).toContainText(phrase("give.delivered.one"), { timeout: 30_000 });
      else await expect(page.getByTestId(TID.give.fallback)).toContainText(phrase("give.fallback"), { timeout: 60_000 });
      if (action.as) {
        const copy = page.getByTestId(TID.give.copy);
        await expect(copy).toBeVisible();
        world.links.set(action.as, (await copy.getAttribute("data-value"))!);
      }
      return ctx.director.beat(1_000);
    }

    case "read-answers": {
      const actor = who!;
      const { page } = actor;
      await page.goto(`/my/${world.chainId}/${world.handId(action.hand)}`);
      const unlock = page.getByTestId(TID.my.unlock);
      // The page asks for the wallet first, unless this tab is still connected.
      await expect(unlock.or(page.getByTestId(TID.wallet.connect).first())).toBeVisible({ timeout: 30_000 });
      if (!(await unlock.isVisible())) await choose(actor);
      await expect(unlock).toBeVisible({ timeout: 30_000 });
      if ((await unlock.getAttribute("data-value")) !== "unlocked") await press(ctx, unlock);
      await expect(unlock).toHaveAttribute("data-value", "unlocked", { timeout: 30_000 });
      const answer = action.words ? page.getByTestId(TID.my.answer).filter({ hasText: action.words }) : page.getByTestId(TID.my.answer);
      await expect(answer).toHaveCount(1, { timeout: 30_000 });
      await ctx.director.point(answer);
      ctx.notes.answer = answer;
      return ctx.director.beat(1_000);
    }

    case "reply": {
      const answer = ctx.notes.answer;
      if (!answer) throw new Error("reply: read the answers first (read-answers)");
      await type(ctx, answer.getByTestId(TID.my.replyInput), action.words);
      await press(ctx, answer.getByTestId(TID.my.replySend));
      // "Delivered to 1 of 1 relay." / "Доставлено на 1 из 1 реле.": the count, in the show's language.
      await expect(answer.getByRole("status")).toContainText(LANG === "ru" ? /1 из 1/ : /1 of 1/, { timeout: 20_000 });
      return ctx.director.beat(1_000);
    }

    case "thank": {
      const actor = who!;
      const { page } = actor;
      if (action.link) {
        await page.goto("/thank");
        await type(ctx, page.getByTestId(TID.thank.input), world.link(action.link));
        await press(ctx, page.getByTestId(TID.thank.open));
      } else {
        if (!ctx.notes.answer) {
          if (!action.hand) throw new Error("thank: name the hand or the give link");
          await run(ctx, actor, { do: "read-answers", hand: action.hand });
        }
        await press(ctx, ctx.notes.answer!.getByTestId(TID.my.answerThank));
        ctx.notes.answer = undefined;
      }
      await expect(page).toHaveURL(/\/thank$/);
      await expect(page.getByTestId(TID.thank.predicted)).toBeVisible({ timeout: 30_000 });
      await connected(actor);
      ctx.notes.predicted = (await rows(page, TID.thank.predictedRow)).map(({ kind, payee, amount }) => ({ kind, payee, amount }));
      if (action.anyway) {
        // A route re-signed shorter: nothing is sent until every holder it drops is ticked and "anyway" pressed.
        await expect(page.getByTestId(TID.thank.resigned)).toBeVisible();
        await expect(page.getByTestId(TID.thank.swipe), "no thank before the dropped are ticked").toBeDisabled();
        for (const tick of await page.getByTestId(TID.thank.droppedTick).all()) {
          await ctx.director.point(tick);
          await tick.check();
        }
        await press(ctx, page.getByTestId(TID.thank.anyway));
      }
      await expect(page.getByTestId(TID.thank.cost)).toContainText(phrase("kit.cost.line"), { timeout: 30_000 });
      await ctx.director.point(page.getByTestId(TID.thank.predicted));
      await ctx.form();
      await expect(page.getByTestId(TID.thank.swipe)).toBeEnabled();
      await press(ctx, page.getByTestId(TID.thank.swipe));
      const done = page.getByTestId(TID.thank.done);
      await expect(done).toBeVisible({ timeout: 60_000 });
      world.lastTx = { hash: (await done.getAttribute("data-hash")) as Hex, what: "thank" };
      await done.scrollIntoViewIfNeeded();
      return ctx.director.beat(1_500);
    }

    case "send-back": {
      const actor = who!;
      const { page } = actor;
      const card = page.getByTestId(TID.hand.dealCard);
      // The view follows the chain's next block, no reload.
      await expect(card).toHaveAttribute("data-state", "expired", { timeout: 20_000 });
      await ctx.director.point(page.getByTestId(TID.hand.timesUp));
      if ((await page.getByTestId(TID.wallet.connected).count()) === 0) await choose(actor);
      await ctx.form();
      await press(ctx, page.getByTestId(TID.hand.sendBack));
      await expect(page.getByTestId(TID.hand.closed)).toHaveAttribute("data-value", "refunded", { timeout: 30_000 });
      return ctx.director.beat(1_200);
    }

    case "review-thank": {
      const { page } = who!;
      await page.goto("/thank");
      await type(ctx, page.getByTestId(TID.thank.input), world.link(action.link));
      await press(ctx, page.getByTestId(TID.thank.open));
      await expect(page.getByTestId(TID.thank.predicted)).toBeVisible({ timeout: 30_000 });
      return ctx.director.beat(1_500);
    }

    case "pass-sdk": {
      let link = world.link(action.link);
      const times = action.times ?? (action.until === "full" ? 100 : 1);
      for (let i = 0; i < times; i++) {
        if (action.until === "full" && world.craft<{ passesLeft: number }>("open", link).passesLeft <= 0) break;
        const keep = action.keepBps ? ["--keep", String(action.keepBps), "--payee-account", "2"] : [];
        link = world.craft<{ address: string }>("pass", link, ...keep).address;
      }
      world.links.set(action.as, link);
      return ctx.director.beat(800);
    }

    case "give-sdk": {
      const given = world.craft<{ address: string; account: Address }>("wrap-6492", world.link(action.link));
      world.links.set(action.as, given.address);
      await world.name(action.as, given.account, true);
      return ctx.director.beat(800);
    }

    case "seed": {
      const made = world.seed<{ handId: string; address: string; firstGiveAddress: string; secondGiveAddress: string; dropped: { payee: Address | null }[] }>(action.fixture);
      world.handIds.set(action.as, BigInt(made.handId));
      world.links.set(action.as, made.address);
      world.links.set(`${action.as}-first`, made.firstGiveAddress);
      world.links.set(`${action.as}-second`, made.secondGiveAddress);
      const first = world.opened(`${action.as}-first`);
      await world.name(`${action.as}-a`, first.route[0]!.payee!);
      await world.name(`${action.as}-b`, first.route[1]!.payee!);
      await world.name(`${action.as}-giver`, world.opened(`${action.as}-second`).give!.payee);
      return ctx.director.beat(800);
    }

    case "fund":
    case "extend": {
      const actor = who!;
      const { page } = actor;
      const id = world.handId(action.hand);
      ctx.notes.expiryBefore = { hand: action.hand, expiry: (await hands(world.chain, world.core, id)).expiry };
      await page.goto(`/care/${world.chainId}/${id}`);
      await expect(page.getByTestId(TID.care.fundInput)).toBeVisible({ timeout: 20_000 });
      await connected(actor);
      if (action.do === "fund") {
        await type(ctx, page.getByTestId(TID.care.fundInput).locator("input"), action.amount);
        await expect(page.getByTestId(TID.kit.costLine).first()).toBeVisible({ timeout: 15_000 });
        await ctx.form();
        await press(ctx, page.getByTestId(TID.care.fundSwipe));
        await expect(page.getByTestId(TID.care.fundDone)).toBeVisible({ timeout: 30_000 });
      } else {
        await press(ctx, page.locator(`[data-testid="${TID.care.extendChip}"][data-value="${action.by}"]`));
        await expect(page.getByTestId(TID.kit.costLine).first()).toBeVisible({ timeout: 15_000 });
        await ctx.form();
        await press(ctx, page.getByTestId(TID.care.extendSwipe));
        await expect(page.getByTestId(TID.care.extendDone)).toBeVisible({ timeout: 30_000 });
        // The new end shows with the next block.
        await expect.poll(async () => (await hands(world.chain, world.core, id)).expiry, { timeout: 15_000 }).toBeGreaterThan(ctx.notes.expiryBefore.expiry);
      }
      return ctx.director.beat(1_200);
    }

    case "take-out": {
      const actor = who!;
      const { page } = actor;
      await page.goto("/waiting");
      await connected(actor);
      const row = page.getByTestId(TID.waiting.row).and(page.locator(`[data-value="${world.token(action.token)}"]`));
      await expect(row).toBeVisible({ timeout: 20_000 });
      await ctx.director.point(row);
      await press(ctx, page.getByRole("radio", { name: phrase("waiting.takeOut.elsewhere") }));
      const to = world.fresh.has(action.to.replace(/^@/, "")) || action.to.replace(/^@/, "") in world.scenario.personas ? world.addr(action.to) : world.freshAddress(action.to.replace(/^@/, ""));
      await type(ctx, page.getByTestId(TID.waiting.takeOutTo).locator("textarea"), to);
      await expect(page.getByTestId(TID.waiting.takeOut)).toBeEnabled({ timeout: 20_000 });
      await ctx.form();
      await press(ctx, page.getByTestId(TID.waiting.takeOut));
      await expect(page.getByTestId(TID.waiting.withdrawn)).toHaveAttribute("data-to", to, { timeout: 30_000 });
      return ctx.director.beat(1_200);
    }

    case "goto": {
      const { page } = who!;
      const path = action.path.replace("{chain}", String(world.chainId)).replace(/#([\w-]+)/g, (_, name: string) => String(world.handId(name)));
      await page.goto(path);
      return ctx.director.beat(1_200);
    }

    case "connect": {
      await connected(who!);
      return ctx.director.beat(800);
    }

    case "reload": {
      await who!.page.reload();
      return ctx.director.beat(1_200);
    }

    case "network": {
      const { page } = who!;
      const rpcUrl = world.rpcUrl;
      if (action.on) await page.unroute(`${rpcUrl}**`);
      else await page.route(`${rpcUrl}**`, (route) => route.abort("connectionrefused"));
      return ctx.director.beat(1_000);
    }

    case "device-code": {
      const actor = who!;
      const { page } = actor;
      await page.goto("/my");
      await expect(page.getByTestId(TID.my.list).or(page.getByTestId(TID.wallet.connect)).first()).toBeVisible({ timeout: 20_000 });
      await connected(actor);
      // The code stands under the lens: turn it on if this persona keeps the calm view.
      if ((await page.locator("html").getAttribute("data-lens")) !== "on") await press(ctx, page.getByTestId(TID.shell.lens));
      const code = page.getByTestId(TID.my.deviceCode);
      await expect(code).toBeVisible({ timeout: 20_000 });
      world.links.set(action.as, (await code.getAttribute("data-value"))!);
      return ctx.director.beat(1_200);
    }

    case "rebuild": {
      const actor = who!;
      const { page } = actor;
      await page.goto("/my");
      await expect(page.getByTestId(TID.my.list).or(page.getByTestId(TID.my.empty)).or(page.getByTestId(TID.wallet.connect)).first()).toBeVisible({ timeout: 20_000 });
      await connected(actor);
      if ((await page.locator("html").getAttribute("data-lens")) !== "on") await press(ctx, page.getByTestId(TID.shell.lens));
      await type(ctx, page.getByTestId(TID.my.rebuildInput), world.link(action.code));
      await type(ctx, page.getByTestId(TID.my.rebuildHand), String(world.handId(action.hand)));
      await press(ctx, page.getByTestId(TID.my.rebuildSubmit));
      const result = page.getByTestId(TID.my.rebuildResult);
      await expect(result).toBeVisible({ timeout: 30_000 });
      world.links.set(action.as, (await result.getAttribute("data-value"))!);
      return ctx.director.beat(1_200);
    }

    case "check-link": {
      const { page } = who!;
      await page.goto("/check");
      await type(ctx, page.getByTestId(TID.check.input), world.link(action.link));
      await press(ctx, page.getByTestId(TID.check.run));
      await expect(page.getByTestId(TID.check.coreAnswer)).toHaveAttribute("data-state", "done", { timeout: 30_000 });
      return ctx.director.beat(1_200);
    }

    case "print": {
      const { page } = who!;
      await page.goto("/print");
      await type(ctx, page.getByTestId(TID.print.paste), world.link(action.link));
      await press(ctx, page.getByTestId(TID.print.open));
      await expect(page.getByTestId(TID.print.tag).or(page.getByTestId(TID.print.tooDense)).or(page.getByTestId(TID.print.card))).toBeVisible({ timeout: 20_000 });
      return ctx.director.beat(1_500);
    }

    case "exit-thank": {
      // exit.html is its own plain page (apps/web/exit/main.ts) with literal ids, not TID.
      const actor = who!;
      const page = await actor.page.context().newPage();
      page.on("dialog", (dialog) => void dialog.accept());
      await page.goto(pathToFileURL(world.exitFile()).href);
      await expect(page.getByTestId("exit-rpc")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("exit-rpc").fill(world.rpcUrl);
      await press(ctx, page.getByTestId("exit-wallet-connect").first());
      await expect(page.getByTestId("exit-wallet-account")).toBeVisible({ timeout: 15_000 });
      await type(ctx, page.getByTestId("exit-thank-input"), world.link(action.link));
      await press(ctx, page.getByTestId("exit-thank-open"));
      // exit.html follows the browser's language too (apps/web/exit/words.ts "thank.core").
      await expect(page.getByTestId("exit-thank-core")).toContainText(LANG === "ru" ? "принят" : "accepted", { timeout: 30_000 });
      await ctx.form();
      await press(ctx, page.getByTestId("exit-thank-send"));
      await expect(page.getByTestId("exit-thank-done")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId("exit-thank-tx")).toHaveAttribute("data-value", "mined");
      // The page names its transaction in text only: take it from Core's Thanked event for this Hand.
      const handId = BigInt(world.opened(action.link).handId);
      const logs = await world.chain.client.getContractEvents({ address: world.core, abi: coreAbi(), eventName: "Thanked", fromBlock: world.startBlock });
      const thanked = logs.find((log) => (log as unknown as { args: { handId?: bigint } }).args.handId === handId);
      if (!thanked) throw new Error(`no Thanked event for Hand ${handId}`);
      world.lastTx = { hash: thanked.transactionHash as Hex, what: "thank" };
      actor.page = page;
      return ctx.director.beat(1_500);
    }

    case "deliver": {
      const actor = who!;
      const { page } = actor;
      const forAddress = world.addr(action.for);
      await page.goto(`/waiting?for=${forAddress}`);
      await connected(actor);
      const row = page.getByTestId(TID.waiting.row).and(page.locator(`[data-value="${world.token(action.token)}"]`));
      await expect(row).toBeVisible({ timeout: 20_000 });
      await ctx.director.point(row);
      const deliver = page.getByTestId(TID.waiting.deliver);
      await expect(deliver).toBeEnabled({ timeout: 20_000 });
      await ctx.form();
      await press(ctx, deliver);
      const withdrawn = page.getByTestId(TID.waiting.withdrawn);
      await expect(withdrawn).toBeVisible({ timeout: 30_000 });
      await expect(withdrawn).toHaveAttribute("data-to", forAddress);
      return ctx.director.beat(1_200);
    }
  }
}

/** The caption a step shows when the scenario gives none. */
export function captionOf(action: Action, name: string | undefined): string {
  switch (action.do) {
    case "raise":
      return `${name} raises a hand: “${action.title}”, ${typeof action.reward === "string" ? action.reward : action.reward.custom} test dollars, ${action.visibility ?? "unlisted"}`;
    case "raise-sdk":
      return `${name} raises a hand in the ${action.token === "blacklist" ? "token that can block" : "dollar token"} through the SDK: “${action.title}”, ${action.reward} test dollars`;
    case "open":
      return `${name} opens the link`;
    case "pass":
      return action.keepBps ? `${name} passes it on, keeping ${action.keepBps / 100}%` : `${name} passes it on and keeps nothing`;
    case "give":
      return `${name} can help and answers`;
    case "read-answers":
      return `${name} opens My hands on the device that raised it and reads the answer`;
    case "reply":
      return `${name} replies: “${action.words}”`;
    case "thank":
      return `${name} thanks the answer: one transaction pays everyone`;
    case "send-back":
      return `${name} sends the reward back to the asker`;
    case "deliver":
      return `${name}, a stranger, delivers the money waiting for ${action.for.replace(/^@/, "")}`;
    case "look":
      return `${name} looks`;
    case "review-thank":
      return `${name} pastes an answer on Thank and reads what it would pay`;
    case "pass-sdk":
      return action.until === "full" ? "The link is passed on until the route is full" : `The link is passed on ${action.times ?? 1} more time(s)`;
    case "give-sdk":
      return "A helper whose smart account is not set up yet answers";
    case "seed":
      return "The stand prepares a Hand answered twice: once by a route, once by a shorter route re-signed to leave a holder out";
    case "fund":
      return `${name} adds ${action.amount} test dollars to the reward`;
    case "extend":
      return action.by === "max" ? `${name} keeps it open as long as allowed` : `${name} keeps it open ${action.by} days longer`;
    case "take-out":
      return `${name} takes what waits out to another address`;
    case "goto":
      return `${name} opens ${action.path}`;
    case "reload":
      return `${name} reloads the page`;
    case "connect":
      return `${name} connects a wallet`;
    case "network":
      return action.on ? `${name}'s network is back` : `${name} loses the network`;
    case "device-code":
      return `${name} reads this device's code on My hands`;
    case "rebuild":
      return `${name}, on another device, rebuilds the link from the code`;
    case "check-link":
      return `${name} checks the link on Check`;
    case "print":
      return `${name} prints the link`;
    case "exit-thank":
      return `${name} thanks from the exit page, opened as a file: no site needed`;
    case "clock":
      return `The network's clock moves ${action.days} days ahead`;
    case "block":
      return action.blocked ? `The token blocks ${action.address.replace(/^@/, "")}` : `The token unblocks ${action.address.replace(/^@/, "")}`;
    case "service":
      return action.on ? `The ${action.service} is back` : `The ${action.service} goes down`;
    case "say":
      return "";
  }
}
