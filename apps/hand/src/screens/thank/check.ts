import {
  CORE_ABI,
  FORWARDER_ABI,
  LinkError,
  UntrustedCore,
  checkGiveOnChain,
  decodeCoreError,
  getHandFor,
  giveHash,
  innerGiverSig,
  judgeGive,
  messageIdOf,
  openAddress,
  peekLink,
  fromText,
  routeKeys,
  seenGiveOf,
  unwrap6492,
  worstThankGas,
  type AccountSetup,
  type GiveVerdict,
  type Hand,
  type LinkHead,
  type LinkOptions,
  type OpenedAddress,
  type SeenGive,
  type SignedGive,
  type SignedShake,
  type ThankGas,
} from "@ahand/sdk";
import { encodeFunctionData, type Address, type PublicClient } from "viem";

import { config } from "../../config";
import { CLIENTS } from "../../chain";
import { deviceClock, forHand, handKey, put, type InboxRecord } from "../../store/db";
import type { Intent } from "../../wallet";
import { droppedShares, type DroppedShare } from "./model";

/**
 * Steps 1 to 3 and 5 of the thank (UX-SPEC §7.5, ARCHITECTURE §6 step 9), in this order and
 * nothing called an answer before step 2 passes:
 *
 *   1. the address is opened against the Hand Core keeps (`openAddress` with `getHandFor`, which
 *      fails closed for any chain or Core this build does not read);
 *   2. Core's own `checkGive` by `eth_call`. A giver signature wrapped per ERC-6492 is unwrapped:
 *      an account that has code by now is asked with its inner signature; one that has none is
 *      asked through the forwarder with its setup counted in, and the thank then needs the setup
 *      step. With no forwarder configured, the screen says so and stops (D-62);
 *   3. the Give is recorded in this device's inbox with its first-seen time, then judged against
 *      the Gives already seen for this Hand (R-29, D-24, D-25);
 *   5. the worst gas of the thank must fit one transaction (brief 02 §1 item 16).
 *
 * Payees (step 4) and the prediction (step 6) depend on the reward, which is read on every block,
 * so the screen works them out from `model.ts` as it renders.
 */

export const LINK_OPTIONS: LinkOptions = config.cores.canonical ? { canonicalCore: config.cores.canonical } : {};

/** A thank intent kept beside the Give in the device's inbox: the hash is stored before anything is waited for. */
export interface ThankRecord extends InboxRecord {
  thank?: Intent;
}

export type CheckFailure =
  /** The sentence's message id (`link.*`, `core.*`, or this screen's own), and Core's or the link's name for it. */
  { messageId: string; code?: string; kind: "link" | "core" | "offline" | "not-give" | "no-forwarder" };

export interface Checked {
  /** The give address, exactly as it is kept in the inbox: it holds no secret by its format. */
  address: string;
  opened: OpenedAddress;
  hand: Hand;
  signedShakes: SignedShake[];
  /** The Give as the link carries it (an ERC-6492 wrapper stays wrapped here). */
  signedGive: SignedGive;
  /** The Give as Core takes it: the inner signature of a wrapper. */
  coreGive: SignedGive;
  giveHash: `0x${string}`;
  /** Set when the giver's account has no code yet: the thank sends its setup first. */
  setup?: AccountSetup;
  /** The wrapper's factory, when the signature came wrapped (set up by now or not). */
  wrapped?: { factory: Address; factoryData: `0x${string}`; deployed: boolean };
  /** The block Core's answer was read at. */
  checkedAt: bigint;
  verdict: GiveVerdict;
  dropped: DroppedShare[];
  /** When this device first saw this Give (the device's clock, labelled so). */
  firstSeen: number;
  /** When this device first saw the earlier Give(s) the verdict compares with. */
  earlierSeen?: number;
  gas: ThankGas;
  record: ThankRecord;
}

export type CheckResult = { ok: true; checked: Checked } | { ok: false; failure: CheckFailure };

/** The whole address to open: what was pasted, or a bare link written after this site's own address. */
export function addressOfText(text: string, origin: string): string {
  const trimmed = text.trim();
  return trimmed.includes("#") ? trimmed : `${origin.replace(/\/+$/, "")}/#${trimmed}`;
}

/** Whether a fragment reads as a give link, without the network. */
export function isGiveFragment(fragment: string): boolean {
  try {
    return peekLink(fromText(fragment), LINK_OPTIONS).kind === "give";
  } catch {
    return false;
  }
}

/** Whether an error is the network failing (no answer), not anyone refusing. */
function isNetwork(error: unknown): boolean {
  const seen = new Set<unknown>();
  let node: unknown = error;
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const name = (node as { name?: unknown }).name;
    if (name === "HttpRequestError" || name === "TimeoutError" || name === "WebSocketRequestError" || name === "TypeError") return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

function failureOf(error: unknown): CheckFailure {
  if (error instanceof LinkError || error instanceof UntrustedCore) {
    return { kind: "link", messageId: messageIdOf(error), code: error instanceof LinkError ? error.code : "untrusted" };
  }
  const refusal = decodeCoreError(error);
  if (refusal) return { kind: "core", messageId: `core.${refusal.name}`, code: refusal.name };
  if (isNetwork(error)) return { kind: "offline", messageId: "common.time.offline" };
  return { kind: "core", messageId: "thank.error.checkFailed" };
}

function cachedGetHand(): (head: LinkHead) => Promise<Hand> {
  const get = getHandFor(CLIENTS, config.cores.trusted);
  const cache = new Map<string, Promise<Hand>>();
  return (head) => {
    const key = `${head.chainId}:${head.core.toLowerCase()}:${head.handId}`;
    let hand = cache.get(key);
    if (!hand) {
      hand = get(head);
      cache.set(key, hand);
      hand.catch(() => cache.delete(key));
    }
    return hand;
  };
}

async function hasCode(client: PublicClient, address: Address): Promise<boolean> {
  const code = await client.getCode({ address });
  return code !== undefined && code !== "0x";
}

/** What checking the giver's signature costs beyond a key's, from the chain: an estimate of Core's own check. */
async function giverCodeGasOf(client: PublicClient, core: Address, handId: bigint, signedShakes: SignedShake[], coreGive: SignedGive, setup?: AccountSetup): Promise<number | undefined> {
  const check = encodeFunctionData({ abi: CORE_ABI, functionName: "checkGive", args: [handId, signedShakes, coreGive] });
  try {
    const gas = setup
      ? await client.estimateGas({
          to: setup.forwarder,
          data: encodeFunctionData({
            abi: FORWARDER_ABI,
            functionName: "aggregate3",
            args: [
              [
                { target: setup.factory, allowFailure: false, callData: setup.factoryData },
                { target: core, allowFailure: false, callData: check },
              ],
            ],
          }),
        })
      : await client.estimateGas({ to: core, data: check });
    return Number(gas);
  } catch {
    return undefined; // the fit is then counted as for a key; Core's own answer already passed
  }
}

/** The earlier Gives this device holds for the Hand, opened again from their give links. */
async function earlierGives(records: ThankRecord[], except: string, getHand: (head: LinkHead) => Promise<Hand>) {
  const out: { seen: SeenGive; keys: Address[]; signedShakes: SignedShake[]; firstSeen: number }[] = [];
  for (const record of records) {
    if (record.id === except) continue;
    try {
      const opened = await openAddress(record.giveLink, getHand, LINK_OPTIONS);
      if (!opened.signedGive) continue;
      out.push({
        seen: seenGiveOf(opened.hand, opened.signedShakes, opened.signedGive),
        keys: routeKeys(opened.hand, opened.signedShakes),
        signedShakes: opened.signedShakes,
        firstSeen: record.firstSeen,
      });
    } catch {
      // A kept link that no longer opens (the build's Core changed) says nothing about this Give.
    }
  }
  return out;
}

/** Steps 1, 2, 3 and 5. `client` is the build chain's public client. */
export async function checkThank(text: string, origin: string, client: PublicClient): Promise<CheckResult> {
  const address = addressOfText(text, origin);
  const getHand = cachedGetHand();

  // 1. Open.
  let opened: OpenedAddress;
  try {
    opened = await openAddress(address, getHand, LINK_OPTIONS);
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }
  if (!opened.signedGive) return { ok: false, failure: { kind: "not-give", messageId: "thank.error.notGive" } };
  const { hand, signedShakes, signedGive } = opened;
  const core = opened.head.core;

  // 2. Core's checkGive.
  let setup: AccountSetup | undefined;
  let wrapped: Checked["wrapped"];
  let checkedAt: bigint;
  const coreGive: SignedGive = { ...signedGive, giverSig: innerGiverSig(signedGive.giverSig) };
  try {
    checkedAt = await client.getBlockNumber();
    const unwrapped = unwrap6492(signedGive.giverSig);
    if (unwrapped) {
      const deployed = await hasCode(client, signedGive.give.signer);
      wrapped = { factory: unwrapped.factory, factoryData: unwrapped.factoryData, deployed };
      if (deployed) {
        await checkGiveOnChain(client, core, hand.handId, signedShakes, coreGive);
      } else {
        if (!config.forwarder) return { ok: false, failure: { kind: "no-forwarder", messageId: "thank.error.noForwarder" } };
        setup = { forwarder: config.forwarder, factory: unwrapped.factory, factoryData: unwrapped.factoryData };
        await checkGiveOnChain(client, core, hand.handId, signedShakes, signedGive, setup);
      }
    } else {
      await checkGiveOnChain(client, core, hand.handId, signedShakes, signedGive);
    }
  } catch (error) {
    return { ok: false, failure: failureOf(error) };
  }

  // 3. The inbox, then the verdict.
  const id = giveHash(hand, signedGive.give);
  const key = handKey(opened.head.chainId, core, hand.handId);
  let records: ThankRecord[] = [];
  try {
    records = (await forHand("inbox", key)) as ThankRecord[];
  } catch {
    records = []; // storage closed (a private window): every Gives is judged as the first one
  }
  let record = records.find((r) => r.id === id);
  if (!record) {
    record = { id, hand: key, giveLink: address, firstSeen: deviceClock(), routeKeys: routeKeys(hand, signedShakes) };
    try {
      await put("inbox", record);
    } catch {
      // the list lives on this device only; without storage the thank still works
    }
  }
  const earlier = await earlierGives(records, id, getHand);
  const incoming = seenGiveOf(hand, signedShakes, signedGive);
  const judged = judgeGive(
    earlier.map((e) => e.seen),
    incoming,
  );
  const dropped = droppedShares(judged.dropped, earlier);
  const earlierSeen = earlier.length ? Math.min(...earlier.map((e) => e.firstSeen)) : undefined;

  // 5. The worst gas must fit one transaction.
  const deployedCode = wrapped?.deployed ?? (await hasCode(client, signedGive.give.signer).catch(() => false));
  const giverCodeGas = setup || deployedCode ? await giverCodeGasOf(client, core, hand.handId, signedShakes, coreGive, setup) : undefined;
  const gas = worstThankGas(hand, signedShakes, coreGive, giverCodeGas ? { giverCodeGas } : {});

  return {
    ok: true,
    checked: {
      address,
      opened,
      hand,
      signedShakes,
      signedGive,
      coreGive,
      giveHash: id,
      ...(setup ? { setup } : {}),
      ...(wrapped ? { wrapped } : {}),
      checkedAt,
      verdict: judged.verdict,
      dropped,
      firstSeen: record.firstSeen,
      ...(earlierSeen !== undefined ? { earlierSeen } : {}),
      gas,
      record,
    },
  };
}

/** Keeps the thank's intent beside the Give before anything is waited for (and clears it). */
export async function keepIntent(record: ThankRecord, intent: Intent | undefined): Promise<void> {
  const next: ThankRecord = { ...record };
  if (intent) next.thank = intent;
  else delete next.thank;
  await put("inbox", next);
  Object.assign(record, next);
}

/** Between the two steps: Core is asked again, now that the account exists, with the inner signature. */
export async function recheck(client: PublicClient, checked: Checked): Promise<boolean> {
  try {
    await checkGiveOnChain(client, checked.opened.head.core, checked.hand.handId, checked.signedShakes, checked.coreGive);
    return true;
  } catch {
    return false;
  }
}
