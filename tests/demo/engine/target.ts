/**
 * Where a run plays (DEMO_TARGET), as a stand file: the shape infra/stand writes, so the craft
 * tool, the seed and the chain helpers read every target the same way.
 *
 *   stand  infra/stand/.run/<STAND_SLOT>/stand.json (the e2e suite's), or STAND_FILE
 *   fork   tests/demo/.run/fork/stand.json, written by `bun tests/demo/fork.ts up`
 *   site   a branch site on Base Sepolia: DEMO_SITE (https://<branch>.ahand.in) with the public
 *          configuration of this checkout (apps/web/src/config/base-sepolia.json); written to
 *          tests/demo/.run/site/stand.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { StandInfo } from "../../e2e/lib/stand";

export type Target = "stand" | "fork" | "site";

const REPO = resolve(import.meta.dirname, "../../..");

export function targetOf(env = process.env): Target {
  const t = env.DEMO_TARGET ?? "stand";
  if (t !== "stand" && t !== "fork" && t !== "site") throw new Error(`DEMO_TARGET is stand, fork or site, not "${t}"`);
  return t;
}

export function standFileOf(target: Target, env = process.env): string {
  if (target === "stand") return env.STAND_FILE ? resolve(env.STAND_FILE) : join(REPO, "infra/stand/.run", env.STAND_SLOT || "0", "stand.json");
  if (target === "fork") return join(REPO, "tests/demo/.run/fork/stand.json");
  return join(REPO, "tests/demo/.run/site/stand.json");
}

/** A target's stand record; `privy`: its build logs in through Privy (a branch site, a fork with --privy-port). */
export type TargetStand = StandInfo & { privy?: boolean };

export function targetStand(target: Target = targetOf(), env = process.env): TargetStand {
  const file = standFileOf(target, env);
  if (target === "site") {
    const site = env.DEMO_SITE;
    if (!site || !/^https:\/\/[a-z0-9.-]+$/i.test(site)) throw new Error("DEMO_TARGET=site needs DEMO_SITE, the branch site's origin (https://<branch>.ahand.in)");
    const config = JSON.parse(readFileSync(join(REPO, "apps/web/src/config/base-sepolia.json"), "utf8"));
    const stand = {
      slot: null,
      mode: "built",
      site,
      rpc: config.chain.rpcUrls[0],
      relay: null,
      chainId: config.chain.id,
      core: config.cores.canonical,
      tokens: [{ address: config.tokens[0].address, symbol: config.tokens[0].symbol, decimals: config.tokens[0].decimals, kind: "usd" }],
      forwarder: config.forwarder,
      accountFactory: null,
      aheadSeconds: 0,
      privy: config.privy !== undefined,
    };
    mkdirSync(join(REPO, "tests/demo/.run/site"), { recursive: true });
    writeFileSync(file, `${JSON.stringify(stand, null, 2)}\n`);
    return stand as TargetStand;
  }
  if (!existsSync(file)) {
    throw new Error(target === "fork" ? "no fork is up: bun tests/demo/fork.ts up" : `no stand at ${file}: bun infra/stand/stand.ts up --slot ${env.STAND_SLOT || 0}`);
  }
  return JSON.parse(readFileSync(file, "utf8")) as TargetStand;
}
