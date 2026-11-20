import "fake-indexeddb/auto";

import { plugin } from "bun";
import { nostrTransport, newChatKey, type ChatKey, type Envelope, type Hex } from "@ahand/deliver";
import {
  domain,
  encodeGive,
  encodeLive,
  giveHash,
  giveTypedData,
  keyOfSeed,
  newSeed,
  openAddress,
  openLink,
  passOn,
  signGiveWithKey,
  toAddress,
  toCoreSignature,
  type Hand,
} from "@ahand/sdk";
import { keccak256, stringToBytes, zeroHash, type Address, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

/**
 * The raiser's inbox filled the way the relay fills it (FINDINGS E-3, E-4): the stand's own relay
 * (infra/relay/relay.ts) run in this process on a free port, gift wraps published to it by
 * packages/deliver's transport, and the app's modules given a build configuration that names it.
 * The relay answers every new subscription with every wrap it keeps, as a real one does.
 *
 * Two Gives for one Hand, both signed correctly: A on the honest route root → P0 → P1 → P2 →
 * helper (paid at H), and B, the SDK's tail cut paying the same H from a one-time key (sdk
 * resign.test). Only the route comparison is under test, so the chain is a stand-in that answers
 * as Core would for an open Hand whose checks pass.
 */

const RELAY = `${import.meta.dir}/../../../../infra/relay/relay.ts`;
const relayModule = (await import(RELAY)) as { startRelay(options: { port: number; log?: (line: string) => void }): { url: string; stop(): Promise<void> } };
export const relay = relayModule.startRelay({ port: 0, log: () => undefined });

const raw = (await Bun.file(`${import.meta.dir}/../../src/config/config.example.json`).json()) as { relays: string[]; chain: { rpcUrls: string[] } };
raw.relays = [relay.url];
raw.chain.rpcUrls = ["http://127.0.0.1:9"]; // no chain: every read goes through the stand-ins below
plugin({
  name: "ahand-config (relay fixture)",
  setup(build) {
    build.module("virtual:ahand-config", () => ({ contents: `export default ${JSON.stringify(raw)};`, loader: "js" }));
  },
});
// In one `bun test` process another file may have read the configuration first (the shell's
// landmarks test registers the example one), and a module is read once: the relay is named in
// that configuration too, so every new copy of inbox.ts listens on this relay.
const loaded = (await import("../../src/config/index.ts")).config as unknown as { relays: string[] };
loaded.relays = [relay.url];

export const CHAIN = 31337;
export const CORE = "0x65ac707E2AE7392583de5d6192C619F1D8862309" as Address;
export const SITE = "http://127.0.0.1:18300";
const options = { canonicalCore: CORE };
const dom = domain(CHAIN, CORE);
const seed = newSeed();
export const hand: Hand = {
  handId: 7n,
  raiser: "0x1111111111111111111111111111111111111111",
  token: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  rootKey: privateKeyToAddress(keyOfSeed(seed)),
  payoutGasK: 250,
  minClaimBps: 7000,
  dataHash: zeroHash,
};
const at = (label: string) => privateKeyToAddress(keccak256(stringToBytes(label)));

/** Reads the Hand's terms as `getHandFor` would from Core. */
export const getHand = async () => hand;
/** A Hand whose terms cannot be read now: the network is away. */
export const offlineGetHand = async (): Promise<Hand> => {
  throw Object.assign(new Error("fetch failed"), { name: "HttpRequestError" });
};

/** The chain stand-in: hands(7) is open; checkGive passes; nobody has code. */
export const client = {
  async readContract({ functionName }: { functionName: string }) {
    if (functionName === "hands") return [hand.raiser, 1_900_000_000, 1_800_000_000, 0, hand.token, hand.payoutGasK, hand.minClaimBps, 100_000_000n, hand.rootKey, hand.dataHash];
    if (functionName === "thanks") return [zeroHash, zeroHash];
    if (functionName === "checkGive") return undefined;
    throw new Error(`unexpected read ${functionName}`);
  },
  async getBlockNumber() {
    return 100n;
  },
  async getCode() {
    return "0x";
  },
  async estimateGas() {
    return 30_000n;
  },
} as unknown as PublicClient;

async function pass(link: Uint8Array, payee: Address): Promise<Uint8Array> {
  const opened = await openLink(link, getHand, options);
  return (await passOn(opened, { payee, nextClaimBps: opened.end.claimBps - 500 }, options)).link as Uint8Array;
}

/** A give address on `link`, confirmed by `signerKey`; `confirmKey`, when given, signs in its place (a broken confirmation). */
async function give(link: Uint8Array, signerKey: Hex, payee: Address, confirmKey: Hex = signerKey): Promise<string> {
  const opened = await openLink(link, getHand, options);
  const signer = privateKeyToAccount(signerKey).address;
  const g = { signer, payee, claimBps: opened.end.claimBps, routeHash: opened.end.routeHash, dataHash: zeroHash };
  const keySig = await signGiveWithKey(opened.linkKey!, opened.domain, opened.hand, g);
  const giverSig = toCoreSignature(await privateKeyToAccount(confirmKey).signTypedData(giveTypedData(opened.domain, opened.hand, g)));
  const bytes = await encodeGive({ domain: opened.domain, hand: opened.hand, signedShakes: opened.signedShakes, signedGive: { give: g, keySig, giverSig }, attachments: opened.inside }, options);
  return toAddress({ site: SITE, link: bytes, shape: "bare" }, options);
}

const L0 = await encodeLive({ domain: dom, hand, signedShakes: [], seed }, options);
const L1 = await pass(L0, at("P0"));
const L2 = await pass(L1, at("P1"));
const L3 = await pass(L2, at("P2"));
const helperKey = generatePrivateKey();
/** The honest answer. */
export const A = await give(L3, helperKey, at("H"));
/** A's Give, same terms and so the same giveHash, with a giver confirmation from another key: Core refuses it. */
export const Abroken = await give(L3, helperKey, at("H"), generatePrivateKey());
/** The tail cut: P1 passes again to a fresh key, and a one-time key answers paying the same H. */
export const B = await give(await pass(L1, at("P1")), generatePrivateKey(), at("H"));

/** A Give's hash, as /thank and the inbox key it. */
export async function hashOf(address: string): Promise<Hex> {
  const opened = await openAddress(address, getHand, options);
  return giveHash(opened.hand, opened.signedGive!.give);
}

/** A fresh inbox key for one test, so tests sharing the relay never read each other's wraps. */
export function newInbox(): ChatKey {
  return newChatKey();
}

/**
 * What /give does: a "give" envelope from the helper's chat key to the Hand's inbox, published to
 * the relay. `at` is the message's time (seconds). Resolves once the relay acknowledged it.
 */
export async function deliver(inbox: ChatKey, giveLink: string, at: number, text?: string): Promise<{ id: string; replyTo: Hex }> {
  const helper = newChatKey();
  const envelope: Omit<Envelope, "replyTo"> = { v: 1, kind: "give", hand: { chainId: CHAIN, core: CORE, handId: "7" }, giveLink, ...(text ? { text } : {}) };
  const sent = await nostrTransport([relay.url]).send(inbox.pub, envelope, helper.secret, at);
  if (sent.acks !== 1) throw new Error("the relay did not take the wrap");
  return { id: sent.id, replyTo: helper.pub };
}

/** Waits until `pred` holds, polling (on the monotonic clock: tests move Date.now). */
export async function until(pred: () => boolean | Promise<boolean>, ms = 5_000, what = "the condition"): Promise<void> {
  const deadline = performance.now() + ms;
  while (!(await pred())) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
}
