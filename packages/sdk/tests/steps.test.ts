import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWalletClient,
  http,
  keccak256,
  parseEventLogs,
  stringToBytes,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  CORE_ABI,
  CoreRefused,
  Refusal,
  approveCall,
  chainNow,
  checkGive,
  checkGiveOnChain,
  checkOrder,
  checkRoute,
  checkRouteOnChain,
  domain,
  firstFailure,
  giveHash,
  raiseCall,
  readHand,
  routeHash,
  runSteps,
  signGiveWithKey,
  signShake,
  type Call,
  type Eip712Domain,
  type Give,
  type Hand,
  type Shake,
  type SignedGive,
  type SignedShake,
} from "../src/index.js";
import { ANVIL_KEYS, startChain, type Chain } from "./helpers/anvil.js";

/**
 * Core's check order as data: `runSteps` must name the same first wrong thing, at the same
 * position, as Core's own `checkGive` / `checkRoute` revert on a running Core, for every case of
 * the order (the cases of the `firstWrongThing` tests in contracts/test/Core.t.sol and one per step).
 */

const PORT = 16202;
const raiserKey = ANVIL_KEYS[1]!;
const carolKey = ANVIL_KEYS[3]!;
const bobKey = ANVIL_KEYS[4]!;
const raiser = privateKeyToAccount(raiserKey).address;
const carol = privateKeyToAccount(carolKey).address;
const ROOT = generatePrivateKey();
const NEXT = generatePrivateKey();
const THIRD = generatePrivateKey();
const shaker = privateKeyToAddress(generatePrivateKey());
const ANSWER = keccak256(stringToBytes("the answer"));
const JUNK: Hex = "0x00";

let chain: Chain;
let client: PublicClient;
let dom: Eip712Domain;
let hand: Hand; // minClaimBps 0
let strict: Hand; // minClaimBps 9 500

async function send(key: Hex, call: Call) {
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(chain.rpc) });
  const hash = await wallet.sendTransaction({ to: call.to, data: call.data });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

async function raise(minClaimBps: number): Promise<Hand> {
  const now = (await chainNow(client)).timestamp;
  const usd = chain.tokens.find((token) => token.kind === "usd")!.address;
  await send(raiserKey, approveCall(usd, chain.core, 1_000_000n));
  const receipt = await send(
    raiserKey,
    raiseCall(chain.core, {
      token: usd,
      reward: 1_000_000n,
      expiry: now + 86_400,
      rootKey: privateKeyToAddress(ROOT),
      payoutGasK: 250,
      minClaimBps,
      dataHash: zeroHash,
    }),
  );
  const [raised] = parseEventLogs({ abi: CORE_ABI, eventName: "Raised", logs: receipt.logs });
  return (await readHand(client, chain.core, raised!.args.handId)).hand;
}

const signed = async (on: Hand, key: Hex, shake: Shake): Promise<SignedShake> => ({ shake, keySig: await signShake(key, dom, on, shake) });

/** Two Shakes, each keeping a margin, signed by the right keys unless told otherwise. */
async function twoShakes(on: Hand, secondBy: Hex = NEXT): Promise<SignedShake[]> {
  return [
    await signed(on, ROOT, { nextKey: privateKeyToAddress(NEXT), payee: shaker, claimBps: 10_000, nextClaimBps: 9_000, dataHash: zeroHash }),
    await signed(on, secondBy, { nextKey: privateKeyToAddress(THIRD), payee: shaker, claimBps: 9_000, nextClaimBps: 8_500, dataHash: zeroHash }),
  ];
}

/** A Give at the end of `shakes`, signed by `lastKey` and by `giver`, with fields overridden by `change`. */
async function giveAt(on: Hand, shakes: SignedShake[], lastKey: Hex, giver: Hex, change: Partial<Give> = {}): Promise<SignedGive> {
  const claimBps = shakes.length ? shakes[shakes.length - 1]!.shake.nextClaimBps : 10_000;
  const give: Give = { signer: carol, payee: carol, claimBps, routeHash: routeHash(on, shakes.map((s) => s.shake)), dataHash: ANSWER, ...change };
  return { give, keySig: await signGiveWithKey(lastKey, dom, on, give), giverSig: await signGiveWithKey(giver, dom, on, give) };
}

/** Core's answer by eth_call, as a step: undefined when Core accepts. */
type Named = { name: string; position?: number } | undefined;

async function coreSays(on: Hand, shakes: SignedShake[], signedGive?: SignedGive): Promise<Named> {
  try {
    if (signedGive) await checkGiveOnChain(client, chain.core, on.handId, shakes, signedGive);
    else await checkRouteOnChain(client, chain.core, on.handId, shakes);
    return undefined;
  } catch (error) {
    if (!(error instanceof CoreRefused)) throw error;
    return { name: error.name, position: error.position };
  }
}

/** The SDK's own offline checker, for a third opinion. */
async function verifySays(on: Hand, shakes: SignedShake[], signedGive?: SignedGive): Promise<Named> {
  try {
    if (signedGive) await checkGive(dom, on, shakes, signedGive);
    else await checkRoute(dom, on, shakes);
    return undefined;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return { name: error.error, position: error.position };
  }
}

async function expectSame(on: Hand, shakes: SignedShake[], signedGive: SignedGive | undefined, expected: Named) {
  const results = await runSteps(dom, on, shakes, signedGive);
  const first = firstFailure(results);
  const ours: Named = first ? { name: first.check, position: first.position } : undefined;
  const norm = (x: Named) => (x ? { name: x.name, position: x.position } : undefined);
  expect(norm(await coreSays(on, shakes, signedGive))).toEqual(norm(expected));
  expect(norm(ours)).toEqual(norm(expected));
  expect(norm(await verifySays(on, shakes, signedGive))).toEqual(norm(expected));
  // Every step after the first failure is not reached, every step before it passed.
  const at = results.findIndex((r) => r.status === "fail");
  if (at >= 0) {
    expect(results.slice(0, at).every((r) => r.status === "pass")).toBe(true);
    expect(results.slice(at + 1).every((r) => r.status === "not-reached")).toBe(true);
  } else {
    expect(results.every((r) => r.status === "pass")).toBe(true);
  }
  return results;
}

describe("checkOrder", () => {
  it("is Core's order: the Give's fields, each Shake's three checks, then the Give's five", () => {
    expect(checkOrder(2, true).map((s) => `${s.of}:${s.check}${s.position === undefined ? "" : `(${s.position})`}`)).toEqual([
      "give:GiverIsRaiser",
      "give:ZeroPayee",
      "shake:InvalidClaim(0)",
      "shake:AnonymousMargin(0)",
      "shake:InvalidKeySig(0)",
      "shake:InvalidClaim(1)",
      "shake:AnonymousMargin(1)",
      "shake:InvalidKeySig(1)",
      "give:InvalidClaim(2)",
      "give:InvalidRouteHash",
      "give:BelowMinClaim",
      "give:InvalidKeySig(2)",
      "give:InvalidGiverSig",
    ]);
  });

  it("a route without a Give is checkRoute's order; no Shakes and no Give is no step", () => {
    expect(checkOrder(1, false).map((s) => s.check)).toEqual(["InvalidClaim", "AnonymousMargin", "InvalidKeySig"]);
    expect(checkOrder(0, false)).toEqual([]);
    expect(() => checkOrder(-1, true)).toThrow(RangeError);
  });
});

describe("runSteps against Core's own revert, on the helper chain", () => {
  beforeAll(async () => {
    chain = await startChain({ port: PORT });
    client = chain.client;
    dom = domain(chain.chainId, chain.core);
    hand = await raise(0);
    strict = await raise(9_500);
  }, 60_000);
  afterAll(async () => {
    await chain?.stop();
  });

  // test_checkGive_firstWrongThingIsNamed: the Give's signer, its payee, and only then the route.
  it("a Give by the raiser with no payee: GiverIsRaiser", async () => {
    const g: SignedGive = { give: { signer: raiser, payee: zeroAddress, claimBps: 1, routeHash: `0x${"00".repeat(31)}01`, dataHash: ANSWER }, keySig: JUNK, giverSig: JUNK };
    await expectSame(hand, [], g, { name: "GiverIsRaiser" });
  });

  it("a stranger's Give with no payee: ZeroPayee", async () => {
    const g: SignedGive = { give: { signer: carol, payee: zeroAddress, claimBps: 1, routeHash: `0x${"00".repeat(31)}01`, dataHash: ANSWER }, keySig: JUNK, giverSig: JUNK };
    await expectSame(hand, [], g, { name: "ZeroPayee" });
  });

  it("a Give with a payee, a wrong claim and junk signatures: InvalidClaim(0) of the Give", async () => {
    const g: SignedGive = { give: { signer: carol, payee: carol, claimBps: 1, routeHash: `0x${"00".repeat(31)}01`, dataHash: ANSWER }, keySig: JUNK, giverSig: JUNK };
    const results = await expectSame(hand, [], g, { name: "InvalidClaim", position: 0 });
    expect(firstFailure(results)?.of).toBe("give");
  });

  // test_route_firstWrongThingInTheGiveIsNamed: claim, route, then the minimum, then signatures.
  it("one Shake at 90 %, the Give claims 100 %: InvalidClaim(1); then InvalidRouteHash; then BelowMinClaim", async () => {
    const shakes = [await signed(strict, ROOT, { nextKey: privateKeyToAddress(NEXT), payee: shaker, claimBps: 10_000, nextClaimBps: 9_000, dataHash: zeroHash })];
    const unsigned = (give: Give): SignedGive => ({ give, keySig: "0x", giverSig: "0x" });
    await expectSame(strict, shakes, unsigned({ signer: carol, payee: carol, claimBps: 10_000, routeHash: zeroHash, dataHash: ANSWER }), { name: "InvalidClaim", position: 1 });
    await expectSame(strict, shakes, unsigned({ signer: carol, payee: carol, claimBps: 9_000, routeHash: zeroHash, dataHash: ANSWER }), { name: "InvalidRouteHash" });
    const right = routeHash(strict, shakes.map((s) => s.shake));
    await expectSame(strict, shakes, unsigned({ signer: carol, payee: carol, claimBps: 9_000, routeHash: right, dataHash: ANSWER }), { name: "BelowMinClaim" });
  });

  it("a Shake that does not start from what reached it: InvalidClaim(0) of the Shake", async () => {
    const shakes = [await signed(hand, ROOT, { nextKey: privateKeyToAddress(NEXT), payee: shaker, claimBps: 9_999, nextClaimBps: 9_000, dataHash: zeroHash })];
    const results = await expectSame(hand, shakes, await giveAt(hand, shakes, NEXT, carolKey), { name: "InvalidClaim", position: 0 });
    expect(firstFailure(results)?.of).toBe("shake");
    await expectSame(hand, shakes, undefined, { name: "InvalidClaim", position: 0 });
  });

  it("a Shake that passes on more than reached it: InvalidClaim(1) of the Shake", async () => {
    const [first] = await twoShakes(hand);
    const shakes = [first!, await signed(hand, NEXT, { nextKey: privateKeyToAddress(THIRD), payee: shaker, claimBps: 9_000, nextClaimBps: 9_001, dataHash: zeroHash })];
    await expectSame(hand, shakes, await giveAt(hand, shakes, THIRD, carolKey), { name: "InvalidClaim", position: 1 });
  });

  it("a margin kept for no one: AnonymousMargin(0)", async () => {
    const shakes = [await signed(hand, ROOT, { nextKey: privateKeyToAddress(NEXT), payee: zeroAddress, claimBps: 10_000, nextClaimBps: 9_000, dataHash: zeroHash })];
    await expectSame(hand, shakes, await giveAt(hand, shakes, NEXT, carolKey), { name: "AnonymousMargin", position: 0 });
    await expectSame(hand, shakes, undefined, { name: "AnonymousMargin", position: 0 });
  });

  it("the second Shake signed by a key that does not hold the link: InvalidKeySig(1), with and without a Give", async () => {
    const shakes = await twoShakes(hand, THIRD);
    await expectSame(hand, shakes, await giveAt(hand, shakes, THIRD, carolKey), { name: "InvalidKeySig", position: 1 });
    await expectSame(hand, shakes, undefined, { name: "InvalidKeySig", position: 1 });
  });

  it("the first Shake with junk for a signature: InvalidKeySig(0)", async () => {
    const shakes = [{ ...(await twoShakes(hand))[0]!, keySig: JUNK }];
    await expectSame(hand, shakes, undefined, { name: "InvalidKeySig", position: 0 });
  });

  it("a Give not signed by the route's last key: InvalidKeySig(2) of the Give", async () => {
    const shakes = await twoShakes(hand);
    const results = await expectSame(hand, shakes, await giveAt(hand, shakes, NEXT, carolKey), { name: "InvalidKeySig", position: 2 });
    expect(firstFailure(results)?.of).toBe("give");
  });

  it("a Give with no Shakes needs the link itself, the root key: InvalidKeySig(0)", async () => {
    await expectSame(hand, [], await giveAt(hand, [], NEXT, carolKey), { name: "InvalidKeySig", position: 0 });
  });

  it("a Give signed by someone else than its signer: InvalidGiverSig", async () => {
    const shakes = await twoShakes(hand);
    await expectSame(hand, shakes, await giveAt(hand, shakes, THIRD, bobKey), { name: "InvalidGiverSig" });
  });

  it("a whole good route and Give: every step passes, and Core returns the same giveHash", async () => {
    const shakes = await twoShakes(hand);
    const g = await giveAt(hand, shakes, THIRD, carolKey);
    const results = await expectSame(hand, shakes, g, undefined);
    expect(results).toHaveLength(13);
    const fromCore = await client.readContract({ address: chain.core, abi: CORE_ABI, functionName: "checkGive", args: [hand.handId, shakes, g] });
    expect(fromCore).toBe(giveHash(hand, g.give));
    // The same route without the Give: checkRoute's six steps pass.
    expect((await expectSame(hand, shakes, undefined, undefined)).map((r) => r.status)).toEqual(Array(6).fill("pass"));
  });

  it("a giver's signature its key did not make is put to askSignerCode, and only then refused", async () => {
    const shakes = await twoShakes(hand);
    const g = await giveAt(hand, shakes, THIRD, bobKey);
    const asked: Address[] = [];
    const yes = await runSteps(dom, hand, shakes, g, async (signer) => {
      asked.push(signer);
      return true;
    });
    expect(firstFailure(yes)).toBeUndefined();
    expect(asked).toEqual([carol]);
    expect(firstFailure(await runSteps(dom, hand, shakes, g, async () => false))?.check).toBe("InvalidGiverSig");
  });
});
