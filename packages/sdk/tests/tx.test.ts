import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isErc6492Signature,
  keccak256,
  parseAbi,
  parseEventLogs,
  serializeErc6492Signature,
  stringToBytes,
  toFunctionSignature,
  zeroAddress,
  zeroHash,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import { AHandCoreAbi, ForwarderAbi, KeyAccountFactoryAbi } from "./helpers/built.js";
import {
  CORE_ABI,
  CURVE_ORDER,
  CoreRefused,
  FORWARDER_ABI,
  Refusal,
  approveCall,
  castLine,
  chainNow,
  checkGive,
  checkGiveOnChain,
  checkRoute,
  expiryAfter,
  extendCall,
  findBlockAt,
  forCore,
  fundCall,
  domain,
  handLogs,
  keyOfSeed,
  keySigForCore,
  newSeed,
  raiseCall,
  readHand,
  readLimits,
  readPending,
  readThank,
  receiptOf,
  refundCall,
  routeHash,
  setupCall,
  signGiveWithKey,
  signShake,
  simulate,
  thankCall,
  thankCalldata,
  withdrawCall,
  type Call,
  type CoreErrorName,
  type Eip712Domain,
  type Give,
  type Hand,
  type Shake,
  type SignedGive,
  type SignedShake,
} from "../src/index.js";
import { ANVIL_KEYS, REPO_ROOT, startChain, type Chain } from "./helpers/anvil.js";

/**
 * The transaction builders, sent on a chain of this file's own, and every revert of Core met
 * through `simulate` before anything is sent.
 */

const DAY = 86_400;
const USD = 1_000_000n;

let chain: Chain;
let client: PublicClient;
let usd: Address;
let dom: Eip712Domain;

const raiserKey = ANVIL_KEYS[1]!;
const giverKey = ANVIL_KEYS[3]!;
const raiser = privateKeyToAccount(raiserKey).address;
const giver = privateKeyToAccount(giverKey).address;
const broke = generatePrivateKey(); // an account with no tokens and no allowance
const fresh = () => privateKeyToAddress(generatePrivateKey());

const rpc = (method: string, params: unknown[] = []) =>
  (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });

function walletOf(key: Hex) {
  return createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(chain.rpc) });
}

async function send(key: Hex, call: Call) {
  const hash = await walletOf(key).sendTransaction({ to: call.to, data: call.data, value: call.value ?? 0n });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

const balanceOf = (token: Address, who: Address) =>
  client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

/** Deploys an argument-free test contract from the contracts' build. */
async function deployTest(file: string, name: string): Promise<{ address: Address; abi: Abi }> {
  const json = JSON.parse(readFileSync(join(REPO_ROOT, "contracts/out", file, `${name}.json`), "utf8"));
  const hash = await walletOf(raiserKey).deployContract({ abi: json.abi, bytecode: json.bytecode.object });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  return { address: receipt.contractAddress!, abi: json.abi };
}

interface Raised {
  handId: bigint;
  hand: Hand;
  rootKey: Hex;
}

async function raise(
  key: Hex,
  opts: { reward?: bigint; seconds?: number; minClaimBps?: number; token?: Address } = {},
): Promise<Raised> {
  const reward = opts.reward ?? 100n * USD;
  const token = opts.token ?? usd;
  const rootKey = keyOfSeed(newSeed());
  if (reward > 0n) await send(key, approveCall(token, chain.core, reward));
  const { timestamp } = await chainNow(client);
  const { maxExpiryPeriod } = await readLimits(client, chain.core);
  const call = raiseCall(chain.core, {
    token,
    reward,
    expiry: expiryAfter(timestamp, opts.seconds ?? 30 * DAY, maxExpiryPeriod),
    rootKey: privateKeyToAddress(rootKey),
    payoutGasK: 250,
    minClaimBps: opts.minClaimBps ?? 5_000,
    dataHash: keccak256(stringToBytes("a ride to the airport on Sunday")),
  });
  const receipt = await send(key, call);
  const [raised] = parseEventLogs({ abi: CORE_ABI, logs: receipt.logs, eventName: "Raised" });
  const { hand } = await readHand(client, chain.core, raised!.args.handId);
  return { handId: raised!.args.handId, hand, rootKey };
}

async function route(hand: Hand, rootKey: Hex, hops: { payee: Address; keep: number }[]) {
  const signedShakes: SignedShake[] = [];
  let key = rootKey;
  let claim = 10_000;
  for (const hop of hops) {
    const next = generatePrivateKey();
    const shake: Shake = { nextKey: privateKeyToAddress(next), payee: hop.payee, claimBps: claim, nextClaimBps: claim - hop.keep, dataHash: zeroHash };
    signedShakes.push({ shake, keySig: await signShake(key, dom, hand, shake) });
    key = next;
    claim -= hop.keep;
  }
  return { signedShakes, lastKey: key, claim };
}

async function giveOf(hand: Hand, path: Awaited<ReturnType<typeof route>>, payee: Address, signerKey: Hex = giverKey, signer?: Address) {
  const { routeHash: hash } = await checkRoute(dom, hand, path.signedShakes);
  const give: Give = { signer: signer ?? privateKeyToAddress(signerKey), payee, claimBps: path.claim, routeHash: hash, dataHash: zeroHash };
  const signedGive: SignedGive = {
    give,
    keySig: await signGiveWithKey(path.lastKey, dom, hand, give),
    giverSig: await signGiveWithKey(signerKey, dom, hand, give),
  };
  return signedGive;
}

beforeAll(async () => {
  chain = await startChain();
  client = chain.client;
  usd = chain.tokens.find((token) => token.kind === "usd")!.address;
  dom = domain(chain.chainId, chain.core);
  // The account without tokens still pays for its gas.
  await rpc("anvil_setBalance", [privateKeyToAddress(broke), "0xde0b6b3a7640000"]);
}, 60_000);

afterAll(async () => {
  await chain?.stop();
});

describe("the calls as bytes", () => {
  it("uses Core's and the forwarder's ABI as the contracts' build writes it", () => {
    const signatures = (abi: Abi, type: "function" | "event" | "error") =>
      new Set(abi.filter((item) => item.type === type).map((item) => toFunctionSignature(item as AbiFunction)));
    for (const type of ["function", "event"] as const) {
      const ours = signatures(CORE_ABI, type);
      const built = signatures(AHandCoreAbi as Abi, type);
      for (const signature of ours) expect(built, signature).toContain(signature);
    }
    // Every function of Core that changes something or answers a check is here.
    for (const name of ["raise", "extend", "fund", "thank", "refund", "withdraw", "checkRoute", "checkGive", "hands", "thanks", "pending", "MAX_EXPIRY_PERIOD", "eip712Domain"]) {
      expect(CORE_ABI.some((item) => item.type === "function" && item.name === name), name).toBe(true);
    }
    expect([...signatures(FORWARDER_ABI, "function")]).toEqual([...signatures(ForwarderAbi as Abi, "function")]);
  });

  it("writes each call so that Core's own ABI reads it back", () => {
    const core = chain.core;
    const terms = { token: usd, reward: 0n, expiry: 1_800_000_000, rootKey: fresh(), payoutGasK: 250, minClaimBps: 7_000, dataHash: zeroHash };
    const read = (call: Call) => decodeFunctionData({ abi: AHandCoreAbi, data: call.data });
    expect(read(raiseCall(core, terms))).toEqual({
      functionName: "raise",
      args: [terms.token, 0n, terms.expiry, terms.rootKey, 250, 7_000, zeroHash],
    });
    expect(read(fundCall(core, 7n, 5n))).toEqual({ functionName: "fund", args: [7n, 5n] });
    expect(read(extendCall(core, 7n, 1_900_000_000))).toEqual({ functionName: "extend", args: [7n, 1_900_000_000] });
    expect(read(refundCall(core, 7n))).toEqual({ functionName: "refund", args: [7n] });
    const payee = fresh();
    expect(read(withdrawCall(core, usd, payee, payee))).toEqual({ functionName: "withdraw", args: [usd, payee, payee] });
    for (const call of [raiseCall(core, terms), fundCall(core, 1n, 1n), extendCall(core, 1n, 1), refundCall(core, 1n)]) {
      expect(call.to).toBe(core);
      expect(call.value).toBeUndefined();
    }
    const approve = approveCall(usd, core, 3n);
    expect(approve.to).toBe(usd);
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data })).toEqual({ functionName: "approve", args: [core, 3n] });
  });

  it("prints the same call as a cast send line", () => {
    const call = refundCall(chain.core, 12n);
    expect(castLine(call)).toBe(`cast send ${chain.core} ${call.data} --rpc-url $RPC`);
    expect(castLine({ ...call, value: 5n }, { rpc: "http://127.0.0.1:8545", from: raiser })).toBe(
      `cast send ${chain.core} ${call.data} --value 5 --from ${raiser} --rpc-url http://127.0.0.1:8545`,
    );
    expect(castLine(call, { rpc: "https://rpc.example/key?a=1&b=2" })).toBe(
      `cast send ${chain.core} ${call.data} --rpc-url 'https://rpc.example/key?a=1&b=2'`,
    );
  });

  it("wraps the setup call in the forwarder's aggregate3, never in the sender's own name", () => {
    const setup = { forwarder: fresh(), factory: fresh(), factoryData: "0xdeadbeef" as Hex };
    const call = setupCall(setup);
    expect(call.to).toBe(setup.forwarder);
    expect(decodeFunctionData({ abi: ForwarderAbi, data: call.data })).toEqual({
      functionName: "aggregate3",
      args: [[{ target: setup.factory, allowFailure: false, callData: "0xdeadbeef" }]],
    });
  });
});

describe("a giver whose account is not deployed yet (ERC-6492)", () => {
  it("is refused bare, accepted with the setup, and closes the Hand as thanked by [setupCall, thankCall]", async () => {
    const factory = chain.accountFactory!;
    const forwarder = chain.forwarder!;
    expect(factory).toBeTruthy();
    expect(forwarder).toBeTruthy();
    const ownerKey = generatePrivateKey();
    const owner = privateKeyToAddress(ownerKey);
    const account = await client.readContract({ address: factory, abi: KeyAccountFactoryAbi, functionName: "getAddress", args: [owner, 7n] });
    expect(await client.getCode({ address: account })).toBeUndefined();
    const factoryData = encodeFunctionData({ abi: KeyAccountFactoryAbi, functionName: "createAccount", args: [owner, 7n] });

    const reward = 20n * USD;
    const { handId, hand, rootKey } = await raise(raiserKey, { reward });
    const shaker = fresh();
    const path = await route(hand, rootKey, [{ payee: shaker, keep: 1_000 }]);
    // The account signs: its owner's key signs the Give whose signer is the account's address.
    const plain = await giveOf(hand, path, account, ownerKey, account);
    const wrapped: SignedGive = {
      ...plain,
      giverSig: serializeErc6492Signature({ address: factory, data: factoryData, signature: plain.giverSig }),
    };
    expect(isErc6492Signature(wrapped.giverSig)).toBe(true);

    // Bare: Core has no ERC-6492, and an address without code is not the owner's key.
    for (const bare of [wrapped, plain]) {
      const refused = await checkGiveOnChain(client, chain.core, handId, path.signedShakes, bare).catch((e) => e);
      expect(refused).toBeInstanceOf(CoreRefused);
      expect(refused.name).toBe("InvalidGiverSig");
    }
    const setup = { forwarder, factory, factoryData };
    await expect(checkGiveOnChain(client, chain.core, handId, path.signedShakes, wrapped, setup)).resolves.toBeUndefined();
    // The same setup does not make another key's signature good.
    const forged = { ...wrapped, giverSig: serializeErc6492Signature({ address: factory, data: factoryData, signature: (await giveOf(hand, path, account, generatePrivateKey(), account)).giverSig }) };
    const forgedRefusal = await checkGiveOnChain(client, chain.core, handId, path.signedShakes, forged, setup).catch((e) => e);
    expect(forgedRefusal).toMatchObject({ name: "InvalidGiverSig" });
    // The eth_call deployed nothing.
    expect(await client.getCode({ address: account })).toBeUndefined();

    // thankCall writes the inner signature, never the wrapper.
    const thank = thankCall(chain.core, handId, path.signedShakes, wrapped);
    expect(thank.data).toBe(thankCalldata(handId, path.signedShakes, plain));
    // Before the setup the thank would fail; the setup goes first, through the forwarder.
    expect(await simulate(client, thank, raiser)).toEqual({ ok: false, refusal: { name: "InvalidGiverSig", args: [] } });
    await send(raiserKey, setupCall(setup));
    expect(await client.getCode({ address: account })).not.toBeUndefined();
    await checkGiveOnChain(client, chain.core, handId, path.signedShakes, plain);
    await send(raiserKey, thank);

    const { coreHand, stateAt } = await readHand(client, chain.core, handId);
    expect(stateAt((await chainNow(client)).timestamp)).toBe("thanked");
    expect((await readThank(client, chain.core, handId)).giveHash).toBe(await checkGive(dom, hand, path.signedShakes, plain, async () => true));
    const rows = receiptOf(await handLogs(client, chain.core, handId, { fromBlock: await findBlockAt(client, coreHand.openedAt) })).rows;
    expect(rows.map((row) => row.eventName)).toEqual(["Thanked", "Shaken", "Paid", "Given", "Paid"]);
    expect(await balanceOf(usd, account)).toBe(18n * USD);
    expect(await balanceOf(usd, shaker)).toBe(2n * USD);
  });
});

describe("a wrapper whose \"factory\" is the token", () => {
  it("moves nothing of the sender's through the forwarder, though the same call in the sender's own name would", async () => {
    const forwarder = chain.forwarder!;
    const thief = fresh();
    // The raiser holds tokens and, as after an approve for a raise, leaves an allowance to Core.
    await send(raiserKey, approveCall(usd, chain.core, 50n * USD));
    const before = await balanceOf(usd, raiser);
    expect(before).toBeGreaterThan(5n * USD);
    const hostile = [
      encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [thief, 5n * USD] }),
      encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [raiser, thief, 5n * USD] }),
    ];

    // The threat is real: in the raiser's own name the first call would pay the thief.
    await expect(client.call({ account: raiser, to: usd, data: hostile[0]! })).resolves.toBeDefined();

    for (const factoryData of hostile) {
      const call = setupCall({ forwarder, factory: usd, factoryData });
      expect(call.to).toBe(forwarder);
      // Asked first, the chain refuses it: the forwarder holds nothing and has no allowance.
      await expect(client.call({ account: raiser, to: call.to, data: call.data })).rejects.toThrow();
      // Sent anyway, with a gas limit so nothing simulates it away: mined, reverted, nothing moved.
      const hash = await walletOf(raiserKey).sendTransaction({ to: call.to, data: call.data, gas: 300_000n });
      const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
      expect(receipt.status).toBe("reverted");
      expect(await balanceOf(usd, raiser)).toBe(before);
      expect(await balanceOf(usd, thief)).toBe(0n);
      expect(await balanceOf(usd, forwarder)).toBe(0n);
    }

    // Through checkGiveOnChain the same setup is only an eth_call: it changes nothing either.
    const { handId, hand, rootKey } = await raise(raiserKey, { reward: 3n * USD });
    const path = await route(hand, rootKey, [{ payee: fresh(), keep: 1_000 }]);
    const account = fresh();
    const plain = await giveOf(hand, path, account, generatePrivateKey(), account);
    const wrapped: SignedGive = { ...plain, giverSig: serializeErc6492Signature({ address: usd, data: hostile[1]!, signature: plain.giverSig }) };
    const refused = await checkGiveOnChain(client, chain.core, handId, path.signedShakes, wrapped, { forwarder, factory: usd, factoryData: hostile[1]! }).catch((e) => e);
    expect(refused).toMatchObject({ name: "InvalidGiverSig" });
    expect(await balanceOf(usd, thief)).toBe(0n);
  });
});

/** The same key's signature written as ERC-2098's 64 bytes. */
function compactOf(signature: Hex): Hex {
  const r = signature.slice(2, 66);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  const vs = s | (BigInt(v - 27) << 255n);
  return `0x${r}${vs.toString(16).padStart(64, "0")}`;
}

/** The same key's signature with the higher s (and the other v). */
function highSOf(signature: Hex): Hex {
  const r = signature.slice(2, 66);
  const s = BigInt(`0x${signature.slice(66, 130)}`);
  const v = Number.parseInt(signature.slice(130, 132), 16);
  return `0x${r}${(CURVE_ORDER - s).toString(16).padStart(64, "0")}${(v === 27 ? 28 : 27).toString(16)}`;
}

describe("link keys' signatures in another form", () => {
  it("are brought to Core's 65-byte form before thankCall writes them, and Core then takes the thank", async () => {
    const { handId, hand, rootKey } = await raise(raiserKey, { reward: 10n * USD });
    const path = await route(hand, rootKey, [
      { payee: fresh(), keep: 1_000 },
      { payee: fresh(), keep: 1_000 },
    ]);
    const good = await giveOf(hand, path, fresh());
    const vZeroOne = (signature: Hex): Hex => `${signature.slice(0, 130)}${signature.endsWith("1b") ? "00" : "01"}` as Hex;
    const shakes: SignedShake[] = [
      { ...path.signedShakes[0]!, keySig: compactOf(path.signedShakes[0]!.keySig) },
      { ...path.signedShakes[1]!, keySig: vZeroOne(path.signedShakes[1]!.keySig) },
    ];
    const signedGive: SignedGive = { ...good, keySig: highSOf(good.keySig) };
    expect(shakes[0]!.keySig).toHaveLength(2 + 128);

    // Written as they came, Core refuses the first of them.
    const raw: Call = { to: chain.core, data: thankCalldata(handId, shakes, signedGive) };
    expect(await simulate(client, raw, raiser)).toMatchObject({ ok: false, refusal: { name: "InvalidKeySig", position: 0 } });

    // forCore gives each in the one form, and thankCall writes exactly what the good route writes.
    const written = forCore(shakes, signedGive);
    expect(written.signedShakes.map((s) => s.keySig)).toEqual(path.signedShakes.map((s) => s.keySig));
    expect(written.signedGive.keySig).toBe(good.keySig);
    for (const sig of [...written.signedShakes.map((s) => s.keySig), written.signedGive.keySig]) {
      expect(sig).toHaveLength(2 + 130);
      expect(["1b", "1c"]).toContain(sig.slice(-2));
    }
    const call = thankCall(chain.core, handId, shakes, signedGive);
    expect(call.data).toBe(thankCall(chain.core, handId, path.signedShakes, good).data);
    await checkGiveOnChain(client, chain.core, handId, shakes, signedGive);
    expect((await simulate(client, call, raiser)).ok).toBe(true);
    await send(raiserKey, call);
    expect((await readHand(client, chain.core, handId)).stateAt((await chainNow(client)).timestamp)).toBe("thanked");
  });

  it("leaves bytes that are no key's signature as they came, for Core to refuse with its own error", () => {
    const junk = `0x${"ab".repeat(65)}` as Hex; // v = 0xab
    expect(keySigForCore(junk)).toBe(junk);
    const short = `0x${"01".repeat(30)}` as Hex;
    expect(keySigForCore(short)).toBe(short);
  });
});

describe("a reward of zero", () => {
  it("raises without an approve, passes, gives and thanks: Thanked and Given, no Paid or Pending", async () => {
    // The raiser holds no tokens and approved nothing: Core never touches the token at zero.
    const { handId, hand, rootKey } = await raise(broke, { reward: 0n });
    expect((await readHand(client, chain.core, handId)).coreHand.reward).toBe(0n);
    const path = await route(hand, rootKey, [{ payee: fresh(), keep: 2_000 }]);
    const signedGive = await giveOf(hand, path, fresh());
    const call = thankCall(chain.core, handId, path.signedShakes, signedGive);
    expect((await simulate(client, call, privateKeyToAddress(broke))).ok).toBe(true);
    await send(broke, call);
    const { coreHand, stateAt } = await readHand(client, chain.core, handId);
    expect(stateAt((await chainNow(client)).timestamp)).toBe("thanked");
    const receipt = receiptOf(await handLogs(client, chain.core, handId, { fromBlock: await findBlockAt(client, coreHand.openedAt) }));
    const names = receipt.rows.map((row) => row.eventName);
    expect(names).toEqual(["Thanked", "Shaken", "Given"]);
    expect(names).not.toContain("Paid");
    expect(names).not.toContain("Pending");
    expect(receipt.rows.every((row) => row.amount === 0n)).toBe(true);

    // At zero Core never touches the token, so it takes any address as one, even an account without code.
    const { timestamp } = await chainNow(client);
    const anyToken = raiseCall(chain.core, { token: fresh(), reward: 0n, expiry: timestamp + DAY, rootKey: fresh(), payoutGasK: 250, minClaimBps: 0, dataHash: zeroHash });
    expect((await simulate(client, anyToken, privateKeyToAddress(broke))).ok).toBe(true);
  });
});

/**
 * thank's check order: NotOpen, NotRaiser, Expired, GiverIsRaiser, ZeroPayee, then
 * for each Shake InvalidClaim, AnonymousMargin, InvalidKeySig, then the Give's InvalidClaim,
 * InvalidRouteHash, BelowMinClaim, InvalidKeySig, InvalidGiverSig. Each case below carries its
 * own fault and every later one, so the refusal also proves that the earlier check comes first.
 */
const ORDER = [
  "NotOpen",
  "NotRaiser",
  "Expired",
  "GiverIsRaiser",
  "ZeroPayee",
  "InvalidClaim(0)",
  "AnonymousMargin(0)",
  "InvalidKeySig(0)",
  "InvalidClaim(1)",
  "AnonymousMargin(1)",
  "InvalidKeySig(1)",
  "InvalidClaim(2)",
  "InvalidRouteHash",
  "BelowMinClaim",
  "InvalidKeySig(2)",
  "InvalidGiverSig",
] as const;
type Fault = (typeof ORDER)[number];

/** A two-Shake route and its Give for `raised`, carrying the faults asked for. */
async function faulty(raised: Raised, faults: Set<Fault>) {
  const { hand, rootKey } = raised;
  const has = (fault: Fault) => faults.has(fault);
  const wrongKey = generatePrivateKey();
  // Shake 0 keeps 10% for a payee (60% when the route must leave the giver below the minimum);
  // Shake 1 names no payee and keeps nothing.
  const keep0 = has("BelowMinClaim") ? 6_000 : 1_000;
  const claim0 = has("InvalidClaim(0)") ? 9_999 : 10_000;
  const next0 = claim0 - keep0;
  const shake0: Shake = { nextKey: privateKeyToAddress(generatePrivateKey()), payee: has("AnonymousMargin(0)") ? zeroAddress : fresh(), claimBps: claim0, nextClaimBps: next0, dataHash: zeroHash };
  const key1 = generatePrivateKey();
  shake0.nextKey = privateKeyToAddress(key1);
  const claim1 = has("InvalidClaim(1)") ? next0 + 1 : next0;
  const keep1 = has("AnonymousMargin(1)") ? 100 : 0;
  const lastKey = generatePrivateKey();
  const shake1: Shake = { nextKey: privateKeyToAddress(lastKey), payee: zeroAddress, claimBps: claim1, nextClaimBps: claim1 - keep1, dataHash: zeroHash };
  const signedShakes: SignedShake[] = [
    { shake: shake0, keySig: await signShake(has("InvalidKeySig(0)") ? wrongKey : rootKey, dom, hand, shake0) },
    { shake: shake1, keySig: await signShake(has("InvalidKeySig(1)") ? wrongKey : key1, dom, hand, shake1) },
  ];
  const left = shake1.nextClaimBps;
  const signerKey = has("GiverIsRaiser") ? raiserKey : giverKey;
  const give: Give = {
    signer: privateKeyToAddress(signerKey),
    payee: has("ZeroPayee") ? zeroAddress : fresh(),
    claimBps: has("InvalidClaim(2)") ? left - 1 : left,
    routeHash: has("InvalidRouteHash") ? keccak256(stringToBytes("another route")) : routeHash(hand, [shake0, shake1]),
    dataHash: zeroHash,
  };
  const signedGive: SignedGive = {
    give,
    keySig: await signGiveWithKey(has("InvalidKeySig(2)") ? wrongKey : lastKey, dom, hand, give),
    giverSig: await signGiveWithKey(has("InvalidGiverSig") ? wrongKey : signerKey, dom, hand, give),
  };
  return { signedShakes, signedGive };
}

describe("thank's check order, met through simulate", () => {
  let open: Raised;
  let expired: Raised;

  beforeAll(async () => {
    open = await raise(raiserKey, { reward: 10n * USD, minClaimBps: 5_000 });
    expired = await raise(raiserKey, { reward: 10n * USD, minClaimBps: 5_000, seconds: 120 });
    const { coreHand } = await readHand(client, chain.core, expired.handId);
    await rpc("evm_setNextBlockTimestamp", [coreHand.expiry]);
    await rpc("evm_mine");
  }, 60_000);

  for (const [at, expected] of ORDER.entries()) {
    it(`refuses with ${expected} when it and every later fault are present`, async () => {
      const faults = new Set<Fault>(ORDER.slice(at));
      const target = expected === "Expired" ? expired : open;
      const { signedShakes, signedGive } = await faulty(target, faults);
      const handId = expected === "NotOpen" ? 999_999n : target.handId;
      const from = expected === "NotRaiser" ? giver : raiser;
      const result = await simulate(client, thankCall(chain.core, handId, signedShakes, signedGive), from);
      const [, name, position] = /^(\w+)(?:\((\d+)\))?$/.exec(expected)!;
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.refusal.name).toBe(name as CoreErrorName);
      expect(result.refusal.position).toBe(position === undefined ? undefined : Number(position));

      // From GiverIsRaiser on, the SDK's offline check predicts the same refusal.
      if (at >= ORDER.indexOf("GiverIsRaiser")) {
        const offline = await checkGive(dom, target.hand, signedShakes, signedGive).catch((e) => e);
        expect(offline).toBeInstanceOf(Refusal);
        expect([offline.error, offline.position]).toEqual([name, position === undefined ? undefined : Number(position)]);
      }
    });
  }

  it("passes with no fault, and a thanked Hand is then NotOpen", async () => {
    const { signedShakes, signedGive } = await faulty(open, new Set());
    const call = thankCall(chain.core, open.handId, signedShakes, signedGive);
    const result = await simulate(client, call, raiser);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.gas).toBeGreaterThan(21_000n);
    await send(raiserKey, call);
    expect(await simulate(client, call, raiser)).toEqual({ ok: false, refusal: { name: "NotOpen", args: [] } });
  });
});

describe("Core's other refusals, met through simulate", () => {
  const refusalOf = async (call: Call, from: Address) => {
    const result = await simulate(client, call, from);
    if (result.ok) throw new Error("expected a refusal");
    return result.refusal;
  };

  it("raise: ZeroRootKey, MinClaimTooHigh, InexactTransfer, Reentered", async () => {
    const { timestamp } = await chainNow(client);
    const terms = { token: usd, reward: 0n, expiry: timestamp + DAY, rootKey: fresh(), payoutGasK: 250, minClaimBps: 5_000, dataHash: zeroHash };
    expect((await refusalOf(raiseCall(chain.core, { ...terms, rootKey: zeroAddress }), raiser)).name).toBe("ZeroRootKey");
    expect((await refusalOf(raiseCall(chain.core, { ...terms, minClaimBps: 10_001 }), raiser)).name).toBe("MinClaimTooHigh");

    // A token that takes a fee on the way in moves less than asked.
    const fee = await deployTest("FeeTokens.sol", "SenderFeeToken");
    await send(raiserKey, { to: fee.address, data: encodeFunctionData({ abi: fee.abi, functionName: "mint", args: [raiser, 10n * USD] }) });
    await send(raiserKey, approveCall(fee.address, chain.core, 10n * USD));
    expect(await refusalOf(raiseCall(chain.core, { ...terms, token: fee.address, reward: USD }), raiser)).toEqual({ name: "InexactTransfer", args: [] });

    // A token that calls back into Core mid-transfer.
    const hook = await deployTest("HookToken.sol", "HookToken");
    await send(raiserKey, { to: hook.address, data: encodeFunctionData({ abi: hook.abi, functionName: "mint", args: [raiser, 10n * USD] }) });
    await send(raiserKey, approveCall(hook.address, chain.core, 10n * USD));
    const reenter = fundCall(chain.core, 1n, 0n).data;
    await send(raiserKey, { to: hook.address, data: encodeFunctionData({ abi: hook.abi, functionName: "setReentry", args: [chain.core, reenter, true, false, true] }) });
    expect((await refusalOf(raiseCall(chain.core, { ...terms, token: hook.address, reward: USD }), raiser)).name).toBe("Reentered");
  });

  it("extend, fund and refund: NotRaiser, ExpiryTooEarly, ExpiryTooLate, NotExpired, NotOpen", async () => {
    const { handId } = await raise(raiserKey, { reward: USD, seconds: DAY });
    const { coreHand } = await readHand(client, chain.core, handId);
    const { maxExpiryPeriod } = await readLimits(client, chain.core);
    const now = (await chainNow(client)).timestamp;
    expect((await refusalOf(extendCall(chain.core, handId, coreHand.expiry + 1), giver)).name).toBe("NotRaiser");
    expect((await refusalOf(extendCall(chain.core, handId, coreHand.expiry), raiser)).name).toBe("ExpiryTooEarly");
    expect((await refusalOf(extendCall(chain.core, handId, now + maxExpiryPeriod + 1), raiser)).name).toBe("ExpiryTooLate");
    expect((await simulate(client, extendCall(chain.core, handId, expiryAfter(now, 90 * DAY, maxExpiryPeriod)), raiser)).ok).toBe(true);
    expect((await refusalOf(fundCall(chain.core, handId, 1n), giver)).name).toBe("NotRaiser");
    expect((await refusalOf(refundCall(chain.core, handId), giver)).name).toBe("NotExpired");
    expect((await refusalOf(refundCall(chain.core, 999_999n), giver)).name).toBe("NotOpen");
  });

  it("withdraw and transferOut: NotPayee, ZeroDestination, NothingPending, NotCore, SafeERC20FailedOperation", async () => {
    const payee = fresh();
    expect((await refusalOf(withdrawCall(chain.core, usd, payee, fresh()), giver)).name).toBe("NotPayee");
    expect((await refusalOf(withdrawCall(chain.core, usd, zeroAddress, zeroAddress), giver)).name).toBe("ZeroDestination");
    expect((await refusalOf(withdrawCall(chain.core, usd, payee, payee), giver)).name).toBe("NothingPending");
    const transferOut = encodeFunctionData({ abi: parseAbi(["function transferOut(address token, address to, uint256 amount)"]), functionName: "transferOut", args: [usd, giver, 1n] });
    expect((await refusalOf({ to: chain.core, data: transferOut }, giver)).name).toBe("NotCore");

    // A token that answers `false`: the payout waits, and pushing it out while it still refuses is SafeERC20's refusal.
    const quiet = await deployTest("ReturnsFalseToken.sol", "ReturnsFalseToken");
    await send(raiserKey, { to: quiet.address, data: encodeFunctionData({ abi: quiet.abi, functionName: "mint", args: [raiser, 10n * USD] }) });
    const refusing = fresh();
    await send(raiserKey, { to: quiet.address, data: encodeFunctionData({ abi: quiet.abi, functionName: "setRefuses", args: [refusing, true] }) });
    const raised = await raise(raiserKey, { reward: 4n * USD, token: quiet.address });
    const path = await route(raised.hand, raised.rootKey, []);
    await send(raiserKey, thankCall(chain.core, raised.handId, [], await giveOf(raised.hand, path, refusing)));
    expect(await readPending(client, chain.core, quiet.address, refusing)).toBe(4n * USD);
    expect(await refusalOf(withdrawCall(chain.core, quiet.address, refusing, refusing), giver)).toEqual({
      name: "SafeERC20FailedOperation",
      args: [getAddress(quiet.address)],
    });
  });

  it("throws what is not Core's refusal as viem threw it", async () => {
    // Raising without an allowance: the token's own error, not one of Core's.
    const { timestamp } = await chainNow(client);
    const call = raiseCall(chain.core, { token: usd, reward: USD, expiry: timestamp + DAY, rootKey: fresh(), payoutGasK: 250, minClaimBps: 0, dataHash: zeroHash });
    const thrown = await simulate(client, call, privateKeyToAddress(broke)).catch((e) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(CoreRefused);
    expect(() => new CoreRefused({ name: "NotOpen" })).not.toThrow();
  });
});
