/**
 * Before a scenario touches a public network (a branch site), or burners on a fork: does every
 * burner persona hold the test money its steps will spend, and does the site run the code these
 * scenarios were written against? Money that is missing fails the run before any browser opens,
 * with each address, what it needs and where the faucets are; a site on another commit is said,
 * not failed (the scenarios may still fit it).
 */
import { spawnSync } from "node:child_process";

import { formatEther, formatUnits, parseEther, type Address } from "viem";

import type { Scenario } from "./scenario";
import { walletOf } from "./wallets";
import { dollars, type World } from "./world";

/** Enough ETH on Base Sepolia for a scenario's transactions (an approve and a raise cost far less). */
const ETH_FLOOR = parseEther("0.0005");

const FAUCETS = "test USDC: https://faucet.circle.com (Base Sepolia); ETH: https://docs.base.org/base-chain/tools/network-faucets";

/** Verbs whose persona sends a transaction and so pays gas; the rest only read or sign. */
const SENDS = new Set(["raise", "thank", "send-back", "deliver", "take-out", "fund", "extend", "exit-thank"]);

/** Per persona: the test dollars its steps put in (rewards raised, amounts added on Care) and whether it pays gas. */
export function spendOf(scenario: Scenario): Map<string, { usd: bigint; gas: boolean }> {
  const spend = new Map<string, { usd: bigint; gas: boolean }>();
  for (const step of scenario.steps) {
    if (!step.who) continue;
    const add = step.do === "raise" ? dollars(typeof step.reward === "string" ? step.reward : step.reward.custom) : step.do === "fund" ? dollars(step.amount) : 0n;
    const now = spend.get(step.who) ?? { usd: 0n, gas: false };
    spend.set(step.who, { usd: now.usd + add, gas: now.gas || SENDS.has(step.do) });
  }
  return spend;
}

export { ETH_FLOOR, FAUCETS };

export async function preflight(world: World, scenario: Scenario): Promise<string[]> {
  const notes: string[] = [];
  const short: string[] = [];
  const spend = spendOf(scenario);
  for (const [key, persona] of Object.entries(scenario.personas)) {
    if (persona.wallet.kind !== "burner") continue;
    const address = walletOf(persona.wallet).address(persona.wallet as never) as Address | null;
    if (!address) {
      short.push(`${persona.name}: burner ${persona.wallet.index} does not exist (bun tests/demo/burners.ts new ${persona.wallet.index})`);
      continue;
    }
    const [eth, usd] = await Promise.all([world.chain.client.getBalance({ address }), world.balance("usd", address)]);
    const need = spend.get(key) ?? { usd: 0n, gas: false };
    const ethNeed = need.gas ? ETH_FLOOR : 0n;
    if (eth < ethNeed || usd < need.usd) {
      short.push(`${persona.name}: burner ${persona.wallet.index} ${address} holds ${formatEther(eth)} ETH and ${formatUnits(usd, 6)} USDC; needs ${formatEther(ethNeed)} ETH and ${formatUnits(need.usd, 6)} USDC`);
    }
  }
  if (short.length) throw new Error(`not enough test money for "${scenario.id}" on ${world.target}:\n  ${short.join("\n  ")}\nFund the burners (${FAUCETS}); see bun tests/demo/burners.ts status.`);

  if (world.target === "site") {
    const built = (await (await fetch(`${world.stand.site}/build.json`, { signal: AbortSignal.timeout(15_000) })).json()) as { commit?: string; dirty?: boolean };
    const here = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
    if (built.commit && built.commit !== here) notes.push(`the site runs commit ${built.commit.slice(0, 10)}${built.dirty ? " (dirty)" : ""}; these scenarios are this checkout's, ${here.slice(0, 10)}: a failure may be the difference`);
  }
  for (const note of notes) console.warn(`demo: ${scenario.id}: ${note}`);
  return notes;
}
