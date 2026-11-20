/**
 * The guards' own child-process tool (PLAN rule 9): SDK work the shared craft tool does not do,
 * printing one JSON object on stdout. Spec files run it; they never import a workspace package.
 *
 *   bun tests/e2e/guards/lib/forge.ts <command> [arguments] (--slot N | --stand FILE)
 *
 *   below-min                a dark Hand whose helper's minimum is 90%, and a live link to it
 *                            whose one pass keeps 20%: a route Core would let through checkRoute
 *                            but that leaves the helper less than promised. No encoder of the SDK
 *                            writes such a link (they all refuse it), so the bytes are packed by
 *                            hand with the SDK's own `pack`, which checks only the form.
 *   sigs <address>           every signature a link carries, as lowercase hex without 0x
 *   catalogue                the app's English and Russian catalogues (common and every screen)
 */
import { join, resolve } from "node:path";

import { parseUnits, zeroHash, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { innerGiverSig, keyOfSeed, newSeed, signShake, toText, type Shake } from "@ahand/sdk";

import { pack } from "../../../../packages/sdk/src/link.ts";
import { ROLE, World, standFrom, toJson, withChainLock } from "../../../../infra/stand/seed.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");

async function belowMin(world: World) {
  const raised = await withChainLock(world.stand.rpc, () =>
    world.raise({
      mode: "dark",
      title: "Who can lend me a ladder for an afternoon?",
      content: "Three metres is enough; I live near the station.",
      reward: parseUnits("20", world.token("usd").decimals),
      minClaimBps: 9_000,
    }),
  );
  const opened = await world.open(raised.address);
  if (!opened.linkKey) throw new Error("the first link holds no key");
  const seed = newSeed();
  const shake: Shake = {
    nextKey: privateKeyToAddress(keyOfSeed(seed)),
    payee: world.address(ROLE.holderA),
    claimBps: 10_000,
    nextClaimBps: 8_000,
    dataHash: zeroHash,
  };
  const keySig = await signShake(opened.linkKey, opened.domain, opened.hand, shake);
  const bytes = pack({
    chainId: BigInt(opened.head.chainId),
    handId: opened.hand.handId,
    shakes: [{ payee: shake.payee, nextClaimBps: shake.nextClaimBps, dataHash: shake.dataHash, keySig }],
    seed,
    attachments: opened.inside as never,
  });
  return { ok: true, handId: raised.handId, minClaimBps: 9_000, keptBps: 2_000, address: `${world.site}/#${toText(bytes)}`, firstAddress: raised.address };
}

async function sigs(world: World, argv: string[]) {
  const address = argv[1];
  if (!address || address.startsWith("--")) throw new Error("sigs takes an address");
  const opened = await world.open(address);
  const out: Hex[] = opened.signedShakes.map(({ keySig }) => keySig);
  if (opened.signedGive) out.push(opened.signedGive.keySig, opened.signedGive.giverSig, innerGiverSig(opened.signedGive.giverSig));
  return { ok: true, sigs: [...new Set(out.map((sig) => sig.slice(2).toLowerCase()))] };
}

/** Loads a catalogue file's default export (a plain object of strings). */
async function load(path: string): Promise<Record<string, string>> {
  return ((await import(path)) as { default: Record<string, string> }).default;
}

async function catalogue() {
  const out: Record<"en" | "ru", Record<string, string>> = { en: {}, ru: {} };
  for (const lang of ["en", "ru"] as const) {
    Object.assign(out[lang], await load(join(ROOT, "apps/hand/src/i18n/common", `${lang}.ts`)));
    for (const file of new Bun.Glob(`apps/hand/src/screens/*/${lang}.ts`).scanSync({ cwd: ROOT })) {
      Object.assign(out[lang], await load(join(ROOT, file)));
    }
  }
  return { ok: true, ...out };
}

async function main(argv: string[]): Promise<number> {
  const name = argv[0];
  try {
    let result: unknown;
    if (name === "catalogue") result = await catalogue();
    else {
      const world = new World(standFrom(argv));
      if (name === "below-min") result = await belowMin(world);
      else if (name === "sigs") result = await sigs(world, argv);
      else {
        console.error("usage: forge.ts <below-min|sigs|catalogue> (--slot N | --stand FILE)");
        return 2;
      }
    }
    console.log(toJson(result));
    return 0;
  } catch (error) {
    console.log(toJson({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}

if (import.meta.main) main(process.argv.slice(2)).then((code) => process.exit(code));
