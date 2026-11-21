/**
 * `verify`: the Hand's passport from a clone, with no site (D-51).
 *
 *   verify --rpc URL [--core 0x…] <handId>   the SDK's collect, then passportOf
 *   verify --bundle FILE                     a saved proof, through verifyBundle, with no network:
 *                                            its signatures, hashes and sums; its events and views
 *                                            read "recorded in the file", never ok
 *   verify --bundle FILE --rpc URL           the same file re-read from the chain (verifyBundleOnChain):
 *                                            every log by block hash, the views at the file's block
 *
 * They print the checks passportOf returns, in its order and with its ids, so they are the same
 * ones the proof page shows (the bundle against the chain adds one first line, `chain`). Exit 0
 * only when no check failed; "not checkable" and "recorded in the file" are not failures.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { getAddress, type Address, type Hex } from "viem";

import { seenIn } from "../../packages/sdk/src/address.ts";
import { chainNow } from "../../packages/sdk/src/chain.ts";
import { decodeCoreError } from "../../packages/sdk/src/errors.ts";
import { fromText, peekLink } from "../../packages/sdk/src/link.ts";
import { collect, exportBundle, passportOf, readBetween, readBundle, verifyBundle, verifyBundleOnChain, type BuildFacts, type Check } from "../../packages/sdk/src/proof.ts";
import { CORE_SALT, CREATE2_FACTORY, readDeployment } from "../manifest.ts";
import { Fail, clean, cloneCore, connect, deploymentFileOf, group, handIdOf, shown, trustedCore, utc, type Args, type Sources } from "./cli.ts";
import { passportLines, summaryOf } from "./passport.ts";

const USAGE = "verify --rpc URL [--core 0x...] <handId>, or verify --bundle FILE [--rpc URL]";

/** The stretch between a raise and its closing is read at once up to this many requests: one day of Base (200 ms blocks) in windows of 2 000. */
const BETWEEN_AT_ONCE = 216;

/**
 * The facts the "This contract" check derives Core's address from, as this clone knows them: the
 * factory, the salt and the initcode hash it builds itself (contracts/out, built from the source as
 * it is now), else the chain's deployment file. Undefined when neither is here: the check then
 * reads "not checkable".
 */
export function cloneBuildFacts(chainId?: number, args?: Args, sources: Sources = {}): { facts: BuildFacts; from: string } | undefined {
  const clone = cloneCore(sources);
  if ("core" in clone) {
    return { facts: { factory: CREATE2_FACTORY, salt: CORE_SALT, initcodeHash: clone.build.initcodeHash }, from: "the initcode this clone builds (contracts/out)" };
  }
  if (chainId === undefined) return undefined;
  const found = deploymentFileOf(args, chainId, sources);
  if (!found) return undefined;
  let deployment;
  try {
    deployment = readDeployment(found.file);
  } catch (error) {
    throw new Fail((error as Error).message);
  }
  return {
    facts: { factory: getAddress(deployment.factory), salt: deployment.salt as Hex, initcodeHash: deployment.initcodeHash as Hex, commit: deployment.commit ?? undefined, dirty: deployment.dirty ?? undefined },
    from: `${shown(found.file)} (${found.why})`,
  };
}

/** A give address (or a give link as text): its bytes and the part that travelled outside it. Never a live link. */
function giveOf(text: string, canonicalCore: Address): { giveLink: Uint8Array; outside?: Uint8Array } {
  const hash = text.indexOf("#");
  let bytes: Uint8Array;
  let outside: Uint8Array | undefined;
  try {
    bytes = fromText((hash < 0 ? text : text.slice(hash + 1)).trim());
    if (hash >= 0) outside = seenIn(text.slice(0, hash), { canonicalCore }).data;
  } catch (error) {
    throw new Fail(`--give is not an aHand address or link (${clean(error instanceof Error ? error.message : String(error))})`, 2);
  }
  let kind: string;
  try {
    kind = peekLink(bytes, { canonicalCore }).kind;
  } catch (error) {
    throw new Fail(`--give does not open as an aHand link (${clean(error instanceof Error ? error.message : String(error))})`, 2);
  }
  if (kind !== "give") {
    throw new Fail(`--give takes a give link (it ends with a Give and holds no secret); this one is ${kind}: it is not used and not saved`, 2);
  }
  return outside ? { giveLink: bytes, outside } : { giveLink: bytes };
}

export async function verifyCommand(args: Args): Promise<number> {
  const bundleFile = args.flags.get("--bundle");
  const details = args.flags.has("--details");
  let checks: Check[];
  const head: string[] = [];

  if (bundleFile !== undefined) {
    if (args.positional.length) throw new Fail(`--bundle checks a saved proof: give no number (${USAGE})`, 2);
    let json: string;
    try {
      json = readFileSync(resolve(bundleFile), "utf8");
    } catch {
      throw new Fail(`cannot read the bundle ${clean(bundleFile)}`);
    }
    let record;
    try {
      record = readBundle(json);
    } catch (error) {
      throw new Fail(clean(error instanceof Error ? error.message : String(error), 600));
    }
    // The contract check uses the code hash this clone builds, not the one the bundle carries:
    // a bundle cannot vouch for itself. Without a build here, the bundle's own facts are used and said so.
    const clone = cloneBuildFacts(record.chainId, args);
    let facts = "the bundle's own build facts (no build in this clone)";
    if (clone) {
      const parsed = JSON.parse(json) as { build?: Record<string, unknown> };
      parsed.build = { ...(parsed.build ?? {}), factory: clone.facts.factory, salt: clone.facts.salt, initcodeHash: clone.facts.initcodeHash };
      json = JSON.stringify(parsed);
      facts = clone.from;
    }
    // Only an explicit --rpc goes to the network: a bundle is checked offline unless asked.
    const chain = args.flags.has("--rpc") ? (await connect(args, true))! : undefined;
    if (chain && chain.chainId !== record.chainId) throw new Fail(`the RPC is chain ${chain.chainId}; the bundle is of chain ${record.chainId}`, 2);
    checks = chain ? await verifyBundleOnChain(chain.client, json) : await verifyBundle(json);
    head.push(`Hand ${record.handId} on chain ${record.chainId}, Core ${record.core}`);
    if (chain) head.push(`from the bundle ${clean(bundleFile)}, recorded at block ${record.block}; every log and view re-read from the chain at ${clean(chain.rpc)}`);
    else {
      head.push(`from the bundle ${clean(bundleFile)}, recorded at block ${record.block}; no network was used`);
      head.push("with no network only signatures, hashes and sums are proven; events, views and amounts are as the file records them (add --rpc URL to re-read them)");
    }
    head.push(`the contract is checked against ${facts}`);
  } else {
    const chain = (await connect(args, true))!;
    const handId = handIdOf(args.positional[0], USAGE);
    if (args.positional.length > 1) throw new Fail(`one Hand at a time: ${USAGE}`, 2);
    const trusted = trustedCore(args, chain.chainId);
    const clone = cloneBuildFacts(chain.chainId, args);
    const give = args.flags.has("--give") ? giveOf(args.flags.get("--give")!, trusted.core) : {};
    let record;
    try {
      record = await collect(chain.client, trusted.core, handId, { ...give, build: clone?.facts });
    } catch (error) {
      const refusal = decodeCoreError(error);
      if (refusal?.name === "NotRaised") throw new Fail(`Hand ${handId} is not raised on Core ${trusted.core} (chain ${chain.chainId})`);
      throw new Fail(`could not read Hand ${handId}: ${clean(error instanceof Error ? error.message.split("\n")[0]! : String(error), 300)}`);
    }
    if (record.between && !record.between.read) {
      const { requests, fromBlock, toBlock } = record.between;
      if (requests <= BETWEEN_AT_ONCE || args.flags.has("--between")) {
        console.error(`reading blocks ${fromBlock}–${toBlock} between the raise and the closing: ${group(requests)} request${requests === 1 ? "" : "s"} for Funded and Extended`);
        record = await readBetween(chain.client, record);
      } else {
        console.error(`not read: blocks ${fromBlock}–${toBlock} between the raise and the closing take ${group(requests)} requests; add --between to read them`);
      }
    }
    checks = await passportOf(record);
    const at = await chain.client.getBlock({ blockNumber: record.block });
    const now = await chainNow(chain.client);
    head.push(`Hand ${handId} on chain ${chain.chainId}, Core ${record.core} (${trusted.source})`);
    head.push(`read at block ${record.block}, ${utc(Number(at.timestamp))} by the chain's clock (latest block ${now.number})`);
    head.push(clone ? `the contract is checked against ${clone.from}` : "no build and no deployment file here: the contract check is not checkable");
    const save = args.flags.get("--save");
    if (save) {
      const file = resolve(save);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${exportBundle(record)}\n`);
      head.push(`saved the proof to ${save}; check it later with: bun tools/ahand.ts verify --bundle ${save}`);
    }
  }

  const summary = summaryOf(checks);
  console.log([...head, "", ...passportLines(checks, { details }), "", summary.line].join("\n"));
  if (summary.failed.length) {
    console.error(`ahand: ${summary.failed.length} check${summary.failed.length === 1 ? "" : "s"} failed: ${summary.failed.map((check) => check.id).join(", ")}`);
    return 1;
  }
  return 0;
}
