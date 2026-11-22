/**
 * Runs a step's expectations (scenario.ts `Expectation`) and the named checks. Screen checks wait
 * as Playwright's expect does; chain checks read Core and the tokens with eth_call, and Core's own
 * checkRoute and checkGive through the craft tool. Values the scenario wrote may name addresses
 * (`@name`) and Hands (`#name`); world.resolve turns them into what the page and the chain hold.
 */
import { expect } from "@playwright/test";
import { decodeEventLog, getAddress, isAddressEqual, type Address, type Hex } from "viem";

import { TID } from "../../../apps/web/src/testids";
import { coreAbi, hands, thanks } from "../../e2e/lib/rpc";
import type { Expectation, NamedCheck, Payout, TidPath, Token } from "./scenario";
import type { Actor, Ctx } from "./verbs";
import { WALLET_METHODS, methodsSent } from "./watch";
import { phrase, sentence } from "./words";
import { dollars, type World } from "./world";

const DAY = 86_400;

export function tid(path: TidPath): string {
  const [group, element] = path.split(".") as [keyof typeof TID, string];
  return (TID[group] as Record<string, string>)[element]!;
}

/** Core's events in a transaction's receipt, decoded, in log order (other contracts' logs left out). */
export async function coreEventsOf(world: World, hash: Hex) {
  const receipt = await world.chain.client.getTransactionReceipt({ hash });
  const abi = coreAbi();
  const events: { eventName: string; args: Record<string, unknown> }[] = [];
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, world.core)) continue;
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    events.push({ eventName: String(decoded.eventName), args: (decoded.args ?? {}) as Record<string, unknown> });
  }
  return { status: receipt.status, block: receipt.blockNumber, events };
}

function payoutsOf(events: { eventName: string; args: Record<string, unknown> }[]): { kind: string; payee: Address; amount: bigint }[] {
  return events
    .filter((e) => e.eventName === "Paid" || e.eventName === "Pending")
    .map((e) => ({ kind: e.eventName === "Paid" ? "paid" : "waiting", payee: getAddress((e.args.payee ?? e.args.to) as Address), amount: e.args.amount as bigint }));
}

/** Balances the step's `change` checks compare against, noted before the step runs. */
export async function baselineOf(world: World, list: Expectation[] | undefined): Promise<Map<string, bigint>> {
  const base = new Map<string, bigint>();
  for (const e of list ?? []) {
    if ("balance" in e && e.change !== undefined) {
      const token = e.token ?? "usd";
      base.set(`${token}:${e.balance}`, await world.balance(token, world.addr(e.balance)));
    }
  }
  return base;
}

export async function checkAll(ctx: Ctx, actor: Actor | undefined, list: Expectation[] | undefined, base: Map<string, bigint>): Promise<void> {
  for (const e of list ?? []) await check(ctx, actor, e, base);
}

function actorOf(ctx: Ctx, actor: Actor | undefined, on: string | undefined): Actor {
  const found = on ? ctx.actors.get(on) : actor;
  if (!found) throw new Error(`a screen check needs a persona: the step has none, and no "on" was given`);
  return found;
}

async function check(ctx: Ctx, actor: Actor | undefined, e: Expectation, base: Map<string, bigint>): Promise<void> {
  const { world } = ctx;
  if ("see" in e) {
    const { page } = actorOf(ctx, actor, e.on);
    let locator = page.getByTestId(tid(e.see));
    const words = e.says === undefined ? undefined : typeof e.says === "string" ? phrase(e.says) : sentence(e.says[0], e.says[1]);
    if (words) locator = locator.filter({ hasText: words });
    if (e.text) locator = locator.filter({ hasText: world.resolve(e.text) });
    if (e.count !== undefined) {
      await expect(locator, `${e.see} count`).toHaveCount(e.count, { timeout: 20_000 });
      return;
    }
    const one = locator.first();
    await expect(one, e.see).toBeVisible({ timeout: 30_000 });
    if (words) await expect(one, `${e.see} says`).toContainText(words, { timeout: 20_000 });
    if (e.notSays) await expect(one, `${e.see} does not say`).not.toContainText(phrase(e.notSays));
    for (const [name, value] of Object.entries(e.attr ?? {})) await expect(one, `${e.see} ${name}`).toHaveAttribute(name, world.resolve(value), { timeout: 30_000 });
    if (e.enabled === true) await expect(one, `${e.see} enabled`).toBeEnabled({ timeout: 20_000 });
    if (e.enabled === false) await expect(one, `${e.see} disabled`).toBeDisabled({ timeout: 20_000 });
    return;
  }
  if ("open" in e) {
    const { page } = actorOf(ctx, actor, e.on);
    await page.getByRole("button", { name: phrase(e.open) }).click();
    return;
  }
  if ("hand" in e) {
    const id = world.handId(e.hand);
    const row = await hands(world.chain, world.core, id);
    if (e.state) expect(await world.stateOf(e.hand), `Hand "${e.hand}" state`).toBe(e.state);
    if (e.reward !== undefined) expect(row.reward, `Hand "${e.hand}" reward`).toBe(dollars(e.reward));
    if (e.minClaimBps !== undefined) expect(row.minClaimBps, `Hand "${e.hand}" minClaimBps`).toBe(e.minClaimBps);
    if (e.token) expect(getAddress(row.token), `Hand "${e.hand}" token`).toBe(getAddress(world.token(e.token)));
    if (e.raiser) expect(getAddress(row.raiser), `Hand "${e.hand}" raiser`).toBe(world.addr(e.raiser));
    if (e.givenBy) expect((await thanks(world.chain, world.core, id)).giveHash, `Hand "${e.hand}" thanked give`).toBe(world.opened(e.givenBy).give!.giveHash);
    return;
  }
  if ("route" in e) {
    const opened = world.opened(e.route);
    expect(opened.ok, `Core opens ${e.route}`).toBe(true);
    const want = e.is.map((r) => ({ payee: r.payee === null ? null : world.addr(r.payee), keptBps: r.keptBps }));
    expect(opened.route.map((r) => ({ payee: r.payee === null ? null : getAddress(r.payee), keptBps: r.keptBps })), `route of ${e.route}`).toEqual(want);
    return;
  }
  if ("give" in e) {
    const give = world.opened(e.give).give;
    expect(give?.core, `Core's checkGive on ${e.give}`).toBe(e.core);
    if (e.payee) expect(getAddress(give!.payee)).toBe(world.addr(e.payee));
    if (e.claimBps !== undefined) expect(give!.claimBps).toBe(e.claimBps);
    return;
  }
  if ("balance" in e) {
    const token: Token = e.token ?? "usd";
    const now = await world.balance(token, world.addr(e.balance));
    if (e.is !== undefined) expect(now, `${e.balance} holds`).toBe(dollars(e.is));
    if (e.change !== undefined) expect(now - base.get(`${token}:${e.balance}`)!, `${e.balance} changed by`).toBe(dollars(e.change));
    return;
  }
  if ("pending" in e) {
    expect(await world.pending(e.token ?? "usd", world.addr(e.pending)), `waiting for ${e.pending}`).toBe(dollars(e.is));
    return;
  }
  if ("tx" in e) {
    if (!world.lastTx) throw new Error("no step sent a transaction yet");
    const tx = await coreEventsOf(world, world.lastTx.hash);
    expect(tx.status).toBe("success");
    if (e.tx.events) expect(tx.events.map((x) => x.eventName), "Core's events in the transaction").toEqual(e.tx.events);
    if (e.tx.payouts) {
      const want = e.tx.payouts.map((p: Payout) => ({ kind: p.kind, payee: world.addr(p.payee), amount: dollars(p.amount) }));
      expect(payoutsOf(tx.events), "the transaction's payouts").toEqual(want);
    }
    return;
  }
  if ("origins" in e) {
    const who = actorOf(ctx, actor, e.on);
    const map = { rpc: new URL(world.rpcUrl).origin, site: new URL(world.stand.site!).origin, relay: new URL(world.stand.relay!.replace(/^ws/, "http")).origin };
    expect([...new Set(who.watched.sent.map((s) => s.origin))].sort(), `${who.persona.name}'s origins`).toEqual(e.origins.map((o) => map[o]).sort());
    return;
  }
  if ("withdrawn" in e) {
    const logs = await world.chain.client.getContractEvents({
      address: world.core,
      abi: coreAbi(),
      eventName: "Withdrawn",
      args: { token: world.token(e.token ?? "usd"), payee: world.addr(e.withdrawn) },
      fromBlock: world.startBlock,
    });
    expect(logs, `Withdrawn for ${e.withdrawn}`).toHaveLength(e.count);
    return;
  }
  if ("link" in e) {
    const site = new URL(world.stand.site!).origin;
    const id = world.handId(e.link);
    expect(world.link(e.link)).toMatch(new RegExp(`^${site}/${world.chainId}/${id}\\?d=[A-Za-z0-9_-]+#[A-Za-z0-9_-]+$`));
    return;
  }
  return named(ctx, actorOf(ctx, actor, e.on), e.assert, e.arg);
}

async function named(ctx: Ctx, actor: Actor, name: NamedCheck, arg: string | undefined): Promise<void> {
  const { world, notes } = ctx;
  const { page } = actor;
  switch (name) {
    case "raise-rail-four-states": {
      await expect(page.getByTestId(TID.raise.txRail)).toHaveAttribute("data-value", "final", { timeout: 30_000 });
      const rail = await page.evaluate(() => (window as unknown as { __demoRail?: string[] }).__demoRail ?? []);
      expect(rail, "the raise's rail, in order").toEqual(["sent", "in-block", "safe", "final"]);
      const steps = page.getByTestId(TID.raise.txRail).locator("li.ah-tx__step");
      await expect(steps).toHaveCount(4);
      for (let i = 0; i < 4; i++) await expect(steps.nth(i)).toHaveAttribute("data-state", "done");
      return;
    }
    case "raise-terms-on-chain": {
      const at = notes.raiseAt!;
      const row = await hands(world.chain, world.core, world.handId(at.hand));
      expect(getAddress(row.raiser)).toBe(world.addr(actor.key));
      expect(row.closedAt).toBe(0);
      expect(row.expiry).toBeGreaterThanOrEqual(at.timestamp + at.days * DAY);
      expect(row.expiry).toBeLessThanOrEqual(row.openedAt + at.days * DAY);
      expect(await page.getByTestId(TID.raise.up).getAttribute("data-data-hash")).toBe(row.dataHash);
      const finalized = await world.chain.client.getBlock({ blockTag: "finalized" });
      expect(Number(finalized.timestamp), "final means the finalized block reached the raise").toBeGreaterThanOrEqual(row.openedAt);
      return;
    }
    case "raise-sent-one-transaction": {
      const at = notes.raiseAt!;
      expect(await world.chain.client.getTransactionCount({ address: world.addr(actor.key) }), "one transaction: no approve").toBe(at.nonce + 1);
      return;
    }
    case "no-wallet-asked":
      expect(actor.watched.prompt, `${actor.persona.name} saw a wallet prompt`).toBe(false);
      expect(methodsSent(actor.watched).filter((m) => WALLET_METHODS.includes(m)), `${actor.persona.name}'s wallet calls`).toEqual([]);
      expect(methodsSent(actor.watched), "the page read the chain").toContain("eth_call");
      return;
    case "receipt-is-prediction": {
      await expect(page.getByTestId(TID.thank.receipt)).not.toHaveAttribute("data-landed", /false|^$/, { timeout: 15_000 });
      const shown = await page.getByTestId(TID.thank.payout).evaluateAll((items) =>
        items.map((item) => ({ kind: item.getAttribute("data-kind")!, payee: item.getAttribute("data-payee")!, amount: item.getAttribute("data-amount")!, landed: item.getAttribute("data-landed")! })),
      );
      const nonzero = notes.predicted.filter((r) => BigInt(r.amount) > 0n).map((r) => ({ payee: getAddress(r.payee), amount: r.amount }));
      expect(shown.map((r) => ({ payee: getAddress(r.payee), amount: r.amount })), "the receipt is the prediction's rows with money").toEqual(nonzero);
      expect(shown.every((r) => r.kind === "paid" && r.landed === "true"), "every row paid and landed").toBe(true);
      const tx = await coreEventsOf(world, world.lastTx!.hash);
      expect(payoutsOf(tx.events).map((p) => ({ payee: p.payee, amount: p.amount.toString() })), "the transaction's payouts are the receipt's").toEqual(nonzero);
      return;
    }
    case "receipt-events-are-chain": {
      await page.getByRole("button", { name: new RegExp(phrase("thank.lens.events")) }).click();
      const shown = await page.getByTestId(TID.thank.receiptEvent).evaluateAll((items) => items.map((item) => item.getAttribute("data-value")));
      const tx = await coreEventsOf(world, world.lastTx!.hash);
      expect(shown, "the receipt lists the transaction's events in order").toEqual(tx.events.map((x) => x.eventName));
      return;
    }
    case "answer-is-the-give": {
      const answer = notes.answer ?? page.getByTestId(TID.my.answer);
      await expect(answer).toHaveAttribute("data-value", world.opened(arg!).give!.giveHash);
      return;
    }
    case "passport-all-ok": {
      await expect(page.getByTestId(TID.proof.tally)).toHaveAttribute("data-done", "true", { timeout: 30_000 });
      const verdicts = await page.getByTestId(TID.proof.check).evaluateAll((items) => items.map((item) => item.getAttribute("data-verdict")));
      expect(verdicts.length, "the passport's lines").toBeGreaterThan(5);
      expect(verdicts.filter((v) => v === "fail" || v === "pending"), "no line failed or still pending").toEqual([]);
      return;
    }
    case "expiry-moved": {
      const before = notes.expiryBefore!;
      const row = await hands(world.chain, world.core, world.handId(before.hand));
      expect(row.expiry - before.expiry, "the end moved by").toBe(Number(arg) * DAY);
      return;
    }
    case "has-code":
    case "no-code": {
      const code = await world.chain.client.getCode({ address: world.addr(arg!) });
      expect(code !== undefined && code !== "0x", `${arg} has code`).toBe(name === "has-code");
      return;
    }
    case "reply-reached-helper": {
      const thread = page.getByTestId(TID.give.thread);
      await expect(thread.locator('[data-from="asker"]'), "the asker's reply in the helper's tab").toContainText(arg!, { timeout: 30_000 });
      await expect(thread.locator('[data-from="you"]').first()).toBeVisible();
      return;
    }
  }
}
