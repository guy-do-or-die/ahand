import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  serializeErc6492Signature,
  stringToBytes,
  zeroAddress,
  zeroHash,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  CORE_ABI,
  approveCall,
  chainNow,
  collect,
  describeHand,
  domain,
  encodeGive,
  encodeLive,
  exportBundle,
  extendCall,
  fundCall,
  keyOfSeed,
  newSeed,
  openLink,
  packAttachments,
  passOn,
  passportOf,
  raiseCall,
  readBetween,
  readBundle,
  readHand,
  refundCall,
  routeOf,
  setupCall,
  signGiveWithKey,
  thankCall,
  thankInputOf,
  verifyBundle,
  type Call,
  type Check,
  type Eip712Domain,
  type Give,
  type Hand,
  type HandRecord,
  type OpenedLink,
  type SignedGive,
} from "../src/index.js";
import { ANVIL_KEYS, REPO_ROOT, startChain, type Chain } from "./helpers/anvil.js";

/**
 * The passport on a running Core: Hands are raised, passed, given and thanked (or refunded) on the
 * helper chain through the SDK, then `collect` reads them and `passportOf` proves every fact. The
 * contract's own probe, FactsReader, is deployed from contracts/out and must agree.
 */

const PORT = 16201;
const raiserKey = ANVIL_KEYS[1]!;
const giverKey = ANVIL_KEYS[3]!;
const ownerKey = ANVIL_KEYS[5]!; // owns the smart-account raiser
const accountOwnerKey = ANVIL_KEYS[6]!; // owns the giver's account that is not deployed yet
const giverAddress = privateKeyToAccount(giverKey).address;
const ANSWER = keccak256(stringToBytes("I know a mechanic in Alfama"));
const fresh = () => privateKeyToAddress(generatePrivateKey());

const ACCOUNT_ABI = parseAbi([
  "function createAccount(address owner, uint256 salt) returns (address)",
  "function getAddress(address owner, uint256 salt) view returns (address)",
  "function execute(address target, uint256 value, bytes data) returns (bytes)",
]);
const TOKEN_ABI = parseAbi(["function transfer(address to, uint256 amount) returns (bool)", "function setBlocked(address account, bool isBlocked)"]);

let chain: Chain;
let client: PublicClient;
let dom: Eip712Domain;
let usd: Address;
let blacklist: Address;

const rpc = (method: string, params: unknown[] = []) =>
  (client.request as (args: { method: string; params: unknown[] }) => Promise<unknown>)({ method, params });
const later = async (seconds: number) => {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
};

async function send(key: Hex, call: Call) {
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: foundry, transport: http(chain.rpc) });
  const hash = await wallet.sendTransaction({ to: call.to, data: call.data });
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return receipt;
}

/** The same call made by a smart account: its owner sends `execute(target, 0, data)`. */
const through = (account: Address, call: Call): Call => ({
  to: account,
  data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [call.to, 0n, call.data] }),
});

const build = () => ({ factory: chain.factory, salt: chain.salt, initcodeHash: chain.initcodeHash, commit: chain.commit, dirty: chain.dirty });

interface Raised {
  hand: Hand;
  seed: Hex;
  inside?: ReturnType<typeof describeHand>["inside"];
  outside?: Uint8Array;
}

/** Raises a Hand whose root key comes from a fresh seed, as the app does. */
async function raise(opts: { reward: bigint; token?: Address; by?: Hex; account?: Address; describe?: boolean; seconds?: number } = { reward: 0n }): Promise<Raised> {
  const token = opts.token ?? usd;
  const seed = newSeed();
  const now = (await chainNow(client)).timestamp;
  const described = opts.describe ? describeHand({ mode: "unlisted", title: "Who can fix a 1978 Vespa?", content: "It starts, then dies after a minute." }) : undefined;
  const raiseIt = raiseCall(chain.core, {
    token,
    reward: opts.reward,
    expiry: now + (opts.seconds ?? 86_400),
    rootKey: privateKeyToAddress(keyOfSeed(seed)),
    payoutGasK: 250,
    minClaimBps: 0,
    dataHash: described?.dataHash ?? zeroHash,
  });
  const by = opts.by ?? raiserKey;
  const wrap = (call: Call) => (opts.account ? through(opts.account, call) : call);
  if (opts.reward > 0n) await send(by, wrap(approveCall(token, chain.core, opts.reward)));
  const receipt = await send(by, wrap(raiseIt));
  const [log] = parseEventLogs({ abi: CORE_ABI, eventName: "Raised", logs: receipt.logs });
  const { hand } = await readHand(client, chain.core, log!.args.handId);
  return { hand, seed, inside: described?.inside, outside: described?.outside ? packAttachments(described.outside) : undefined };
}

/** Passes the link on once per entry, each holder keeping `keep` basis points for `payee`. */
async function route(raised: Raised, passes: { payee: Address; keep: number }[]): Promise<OpenedLink> {
  const options = raised.outside ? { outside: raised.outside } : {};
  const getHand = async () => raised.hand;
  let link = await encodeLive({ domain: dom, hand: raised.hand, signedShakes: [], seed: raised.seed, attachments: raised.inside }, options);
  let opened = await openLink(link, getHand, options);
  for (const { payee, keep } of passes) {
    ({ link } = await passOn(opened, { payee, nextClaimBps: opened.end.claimBps - keep }, options));
    opened = await openLink(link, getHand, options);
  }
  return opened;
}

/** The Give at the end of a route, by a key, and its give link. */
async function giveAt(raised: Raised, opened: OpenedLink, signer: Address, sign: (give: Give, hand: Hand) => Promise<Hex>) {
  const give: Give = { signer, payee: signer, claimBps: opened.end.claimBps, routeHash: opened.end.routeHash, dataHash: ANSWER };
  const signedGive: SignedGive = { give, keySig: await signGiveWithKey(opened.linkKey!, dom, raised.hand, give), giverSig: await sign(give, raised.hand) };
  const giveLink = await encodeGive(
    { domain: dom, hand: raised.hand, signedShakes: opened.signedShakes, signedGive, attachments: opened.inside },
    raised.outside ? { outside: raised.outside } : {},
  );
  return { signedGive, giveLink };
}

const byKey = (key: Hex) => (give: Give, hand: Hand) => signGiveWithKey(key, dom, hand, give);

const failed = (checks: Check[]) => checks.filter((check) => check.ok === false);
const ids = (checks: Check[]) => checks.map((check) => check.id);
const byId = (checks: Check[], id: string) => {
  const found = checks.find((check) => check.id === id);
  if (!found) throw new Error(`no check ${id} in ${ids(checks).join(", ")}`);
  return found;
};

beforeAll(async () => {
  chain = await startChain({ port: PORT });
  client = chain.client;
  dom = domain(chain.chainId, chain.core);
  usd = chain.tokens.find((token) => token.kind === "usd")!.address;
  blacklist = chain.tokens.find((token) => token.kind === "blacklist")!.address;
}, 60_000);
afterAll(async () => {
  await chain?.stop();
});

describe("a thanked Hand with two passes, one keeping nothing", () => {
  let record: HandRecord;
  let checks: Check[];
  const first = fresh();
  const second = fresh();

  beforeAll(async () => {
    const raised = await raise({ reward: 1_000_000n, describe: true });
    const opened = await route(raised, [
      { payee: first, keep: 500 },
      { payee: second, keep: 0 },
    ]);
    const { signedGive, giveLink } = await giveAt(raised, opened, giverAddress, byKey(giverKey));
    await send(raiserKey, thankCall(chain.core, raised.hand.handId, opened.signedShakes, signedGive));
    record = await collect(client, chain.core, raised.hand.handId, { giveLink, outside: raised.outside, build: build() });
    checks = await passportOf(record);
  }, 60_000);

  it("every check is ok, in the order of UX-SPEC §10.1", () => {
    expect(failed(checks)).toEqual([]);
    expect(checks.every((check) => check.ok === true)).toBe(true);
    expect(ids(checks)).toEqual([
      "core",
      "raised",
      "reward-time",
      "description",
      "route.0",
      "keys.0",
      "route.1",
      "keys.1",
      "share.0",
      "share.1",
      "route-hash",
      "give-claim",
      "give-hash",
      "give-key",
      "giver",
      "giver-amount",
      "payout.shake.0",
      "payout.giver",
      "payouts",
      ...record.pending.map((p) => `now.${p.payee}`),
    ]);
  });

  it("the zero-share pass has its share at 0 and no payout expected; the others are paid", () => {
    expect(byId(checks, "share.1").actual).toBe("0");
    expect(checks.some((check) => check.id === "payout.shake.1")).toBe(false);
    expect(byId(checks, "share.0").actual).toBe("50000");
    expect(byId(checks, "payout.shake.0").actual).toBe(`Paid · 50000 · ${first}`);
    expect(byId(checks, "giver-amount").actual).toBe("950000");
    expect(byId(checks, "payouts").actual).toBe("1000000");
  });

  it("reads the description from the give link, signatures from the thank's input, and Core from its derivation", () => {
    expect(byId(checks, "description").actual).toBe("attached: Who can fix a 1978 Vespa?");
    expect(byId(checks, "keys.0").inputs.from).toBe("thank input");
    expect(byId(checks, "giver").actual).toBe(giverAddress);
    expect(byId(checks, "core").actual).toBe(chain.core);
    expect(byId(checks, "give-hash").expected).toBe(record.thank.giveHash);
    // Sources: events carry block, transaction and log index; views their block.
    expect(byId(checks, "share.0").source).toMatchObject({ event: "Shaken", tx: record.closingTx });
    expect(byId(checks, "give-hash").source).toEqual({ view: "thanks(id)", block: record.block });
    expect(record.between).toBeUndefined();
  });

  it("FactsReader, the contract's own probe, names the same raiser, giver, payees and amounts", async () => {
    const json = JSON.parse(readFileSync(join(REPO_ROOT, "contracts/out/FactsReader.sol/FactsReader.json"), "utf8"));
    const abi = json.abi as Abi;
    const hash = await chain.wallet.deployContract({ abi, bytecode: json.bytecode.object as Hex, args: [chain.core], account: chain.deployer, chain: foundry });
    const reader = (await client.waitForTransactionReceipt({ hash })).contractAddress!;
    const rebuilt = routeOf(record)!;
    const [raiser, giver, payouts] = (await client.readContract({
      address: reader,
      abi,
      functionName: "proveThank",
      args: [record.handId, rebuilt.shakes, rebuilt.give],
    })) as [Address, Address, { payee: Address; amount: bigint; dataHash: Hex }[]];

    expect(raiser).toBe(record.view.raiser);
    expect(byId(checks, "raised").expected.split(" · ")[0]).toBe(raiser);
    expect(giver).toBe(byId(checks, "giver").expected);
    expect(payouts).toHaveLength(3);
    for (const [position, payout] of payouts.slice(0, 2).entries()) {
      const share = byId(checks, `share.${position}`);
      expect(payout.payee).toBe(share.inputs.payee);
      expect(String(payout.amount)).toBe(share.actual);
    }
    expect(payouts[2]!.payee).toBe(byId(checks, "give-hash").inputs.payee);
    expect(String(payouts[2]!.amount)).toBe(byId(checks, "giver-amount").actual);
  });

  it("a bundle re-checks with no network and gives the same passport", async () => {
    const json = exportBundle(record);
    expect(json).not.toMatch(/"\d+n"/);
    expect(readBundle(json)).toEqual(record);
    expect(await verifyBundle(json)).toEqual(checks);
  });

  it("tampering one field of the bundle fails at that check first", async () => {
    const tampered = async (change: (bundle: { logs: { eventName: string; args: Record<string, string | number> }[]; thank: { giveHash: string } }) => void) => {
      const bundle = JSON.parse(exportBundle(record));
      change(bundle);
      return failed(await verifyBundle(JSON.stringify(bundle)))[0]?.id;
    };
    const shaken = (bundle: { logs: { eventName: string; args: Record<string, string | number> }[] }) => bundle.logs.find((log) => log.eventName === "Shaken")!;
    const given = (bundle: { logs: { eventName: string; args: Record<string, string | number> }[] }) => bundle.logs.find((log) => log.eventName === "Given")!;

    expect(await tampered((b) => (shaken(b).args.margin = String(BigInt(shaken(b).args.margin!) + 1n)))).toBe("share.0");
    expect(await tampered((b) => (given(b).args.amount = String(BigInt(given(b).args.amount!) - 1n)))).toBe("giver-amount");
    expect(await tampered((b) => (b.thank.giveHash = keccak256(stringToBytes("another Give"))))).toBe("give-hash");
    // A Give rebuilt with another payee no longer hashes to what Core kept.
    expect(await tampered((b) => (given(b).args.payee = fresh()))).toBe("give-hash");
    // A Shake moved to another key: the root key never signed that Shake.
    expect(await tampered((b) => (shaken(b).args.nextKey = fresh()))).toBe("keys.0");
    expect(() => readBundle(JSON.stringify({ ...JSON.parse(exportBundle(record)), format: "other" }))).toThrow(/not an aHand proof bundle/);
  });
});

describe("a thanked Hand with no reward", () => {
  it("passes with no payout rows at all", async () => {
    const raised = await raise({ reward: 0n });
    const opened = await route(raised, [{ payee: fresh(), keep: 500 }]);
    const { signedGive } = await giveAt(raised, opened, giverAddress, byKey(giverKey));
    await send(raiserKey, thankCall(chain.core, raised.hand.handId, opened.signedShakes, signedGive));
    const checks = await passportOf(await collect(client, chain.core, raised.hand.handId, { build: build() }));
    expect(failed(checks)).toEqual([]);
    expect(checks.filter((check) => check.id.startsWith("payout."))).toEqual([]);
    expect(byId(checks, "share.0").actual).toBe("0");
    expect(byId(checks, "giver-amount").actual).toBe("0");
    expect(byId(checks, "payouts")).toMatchObject({ expected: "0", actual: "0", ok: true });
    expect(byId(checks, "description")).toMatchObject({ actual: "none: the Hand has no description", ok: true });
  });
});

describe("a Hand thanked after the giver's account was set up (ERC-6492)", () => {
  it("has no failed check, and the giver reads as signed by its account", async () => {
    const factory = chain.accountFactory!;
    const forwarder = chain.forwarder!;
    const owner = privateKeyToAccount(accountOwnerKey).address;
    const account = await client.readContract({ address: factory, abi: ACCOUNT_ABI, functionName: "getAddress", args: [owner, 61n] });
    expect(await client.getCode({ address: account })).toBeUndefined();
    const factoryData = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "createAccount", args: [owner, 61n] });

    const raised = await raise({ reward: 2_000_000n });
    const opened = await route(raised, [{ payee: fresh(), keep: 1_000 }]);
    const { signedGive, giveLink } = await giveAt(raised, opened, account, async (give, hand) =>
      serializeErc6492Signature({ address: factory, data: factoryData, signature: await signGiveWithKey(accountOwnerKey, dom, hand, give) }),
    );
    await send(raiserKey, setupCall({ forwarder, factory, factoryData }));
    await send(raiserKey, thankCall(chain.core, raised.hand.handId, opened.signedShakes, signedGive));

    const record = await collect(client, chain.core, raised.hand.handId, { giveLink, build: build() });
    expect(record.giverHasCode).toBe(true);
    const checks = await passportOf(record);
    expect(failed(checks)).toEqual([]);
    expect(byId(checks, "giver")).toMatchObject({ sentence: "proof.giver.account", actual: "signed by its account", ok: true });
    // Without the thank's input the wrapped signature in the give link serves, unwrapped.
    const fromLink = await passportOf({ ...record, thankInput: undefined });
    expect(failed(fromLink)).toEqual([]);
    expect(byId(fromLink, "giver")).toMatchObject({ actual: "signed by its account", inputs: { from: "give link" } });
  });
});

describe("thankInputOf and a raiser that is a smart account", () => {
  let record: HandRecord;

  beforeAll(async () => {
    const owner = privateKeyToAccount(ownerKey).address;
    const factory = chain.accountFactory!;
    await send(ownerKey, { to: factory, data: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "createAccount", args: [owner, 7n] }) });
    const account = await client.readContract({ address: factory, abi: ACCOUNT_ABI, functionName: "getAddress", args: [owner, 7n] });
    await send(ownerKey, { to: usd, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [account, 5_000_000n] }) });

    const raised = await raise({ reward: 3_000_000n, by: ownerKey, account });
    expect(raised.hand.raiser).toBe(account);
    const opened = await route(raised, [{ payee: fresh(), keep: 250 }]);
    const { signedGive } = await giveAt(raised, opened, giverAddress, byKey(giverKey));
    // The thank goes out as the bytes argument of execute(address,uint256,bytes).
    await send(ownerKey, through(account, thankCall(chain.core, raised.hand.handId, opened.signedShakes, signedGive)));
    record = await collect(client, chain.core, raised.hand.handId, { build: build() });
  }, 60_000);

  it("finds the Give inside execute(address,uint256,bytes) and the whole passport passes", async () => {
    expect(decodeFunctionData({ abi: ACCOUNT_ABI, data: record.thankInput! }).functionName).toBe("execute");
    const found = thankInputOf(record.thankInput!, routeOf(record)!.hand, record.thank.giveHash);
    expect(found?.signedGive.give).toEqual(routeOf(record)!.give);
    const checks = await passportOf(record);
    expect(failed(checks)).toEqual([]);
    expect(checks.every((check) => check.ok === true)).toBe(true);
  });

  it("returns nothing when the embedded Give does not hash to the stored giveHash; the passport reads not-checkable", async () => {
    const outer = decodeFunctionData({ abi: ACCOUNT_ABI, data: record.thankInput! });
    const inner = decodeFunctionData({ abi: CORE_ABI, data: outer.args![2] as Hex });
    const [handId, shakes, signed, dataHash] = inner.args as unknown as [bigint, never, SignedGive, Hex];
    const other: SignedGive = { ...signed, give: { ...signed.give, dataHash: keccak256(stringToBytes("another answer")) } };
    const thank = encodeFunctionData({ abi: CORE_ABI, functionName: "thank", args: [handId, shakes, other, dataHash] });
    const execute = encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: [chain.core, 0n, thank] });
    const hand = routeOf(record)!.hand;
    expect(thankInputOf(execute, hand, record.thank.giveHash)).toBeUndefined();
    // The same input for the right Give but another Hand number, and a selector in junk, are not taken either.
    expect(thankInputOf(record.thankInput!, { ...hand, handId: hand.handId + 1n }, record.thank.giveHash)).toBeUndefined();
    expect(thankInputOf(`0x00${thank.slice(2, 10)}ffff`, hand, record.thank.giveHash)).toBeUndefined();

    const checks = await passportOf({ ...record, thankInput: execute });
    expect(failed(checks)).toEqual([]);
    for (const id of ["keys.0", "give-key", "giver"]) expect(byId(checks, id).ok).toBe("not-checkable");
    expect(byId(checks, "give-hash").ok).toBe(true);
  });
});

describe("a refunded Hand", () => {
  it("gets the shorter list, every check ok", async () => {
    const raised = await raise({ reward: 700_000n, seconds: 60 });
    await later(120);
    await send(giverKey, refundCall(chain.core, raised.hand.handId)); // anyone may refund
    const record = await collect(client, chain.core, raised.hand.handId, { build: build() });
    const checks = await passportOf(record);
    expect(ids(checks)).toEqual(["core", "raised", "reward-time", "description", "refunded", "payout.raiser", `now.${raised.hand.raiser}`]);
    expect(checks.every((check) => check.ok === true)).toBe(true);
    expect(byId(checks, "payout.raiser").actual).toBe(`Paid · 700000 · ${raised.hand.raiser}`);
  });

  it("with a reward of zero: no payout event is expected, none is there, and every check is ok", async () => {
    const raised = await raise({ reward: 0n, seconds: 60 });
    await later(120);
    await send(giverKey, refundCall(chain.core, raised.hand.handId));
    const record = await collect(client, chain.core, raised.hand.handId, { build: build() });
    const refundedAt = record.logs.find((log) => log.eventName === "Refunded")!;
    expect(record.logs.filter((log) => log.transactionHash === refundedAt.transactionHash).map((log) => log.eventName)).toEqual(["Refunded"]);
    const checks = await passportOf(record);
    expect(ids(checks)).toEqual(["core", "raised", "reward-time", "description", "refunded", `now.${raised.hand.raiser}`]);
    expect(failed(checks)).toEqual([]);
  });
});

describe("a funded and extended Hand in a second token, its giver's payout left pending", () => {
  it("asks before reading the stretch between, then proves the reward and the expiry", async () => {
    const raised = await raise({ reward: 1_000_000n, token: blacklist });
    await later(30);
    await send(raiserKey, approveCall(blacklist, chain.core, 500_000n));
    await send(raiserKey, fundCall(chain.core, raised.hand.handId, 500_000n));
    await later(30);
    const { view } = await readHand(client, chain.core, raised.hand.handId);
    await send(raiserKey, extendCall(chain.core, raised.hand.handId, view.expiry + 3_600));
    await later(30);
    const opened = await route(raised, []);
    const payee = fresh();
    await send(raiserKey, { to: blacklist, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "setBlocked", args: [payee, true] }) });
    const give: Give = { signer: giverAddress, payee, claimBps: 10_000, routeHash: zeroHash, dataHash: ANSWER };
    const signedGive: SignedGive = { give, keySig: await signGiveWithKey(opened.linkKey!, dom, raised.hand, give), giverSig: await signGiveWithKey(giverKey, dom, raised.hand, give) };
    await send(raiserKey, thankCall(chain.core, raised.hand.handId, [], signedGive));

    const record = await collect(client, chain.core, raised.hand.handId, { build: build() });
    expect(record.between).toMatchObject({ read: false, requests: 1 });
    const asked = await passportOf(record);
    expect(failed(asked)).toEqual([]);
    expect(byId(asked, "reward-time").ok).toBe("not-checkable");

    const whole = await readBetween(client, record);
    const checks = await passportOf(whole);
    expect(checks.every((check) => check.ok === true)).toBe(true);
    expect(byId(checks, "reward-time")).toMatchObject({ actual: `reward 1500000 · expiry ${view.expiry + 3_600}`, inputs: { funded: "500000" } });
    expect(byId(checks, "payout.giver").actual).toBe(`Pending · 1500000 · ${payee}`);
    expect(byId(checks, `now.${payee}`).actual).toBe("1500000");
    // The same Hand with the reading done at collect time.
    expect(await passportOf(await collect(client, chain.core, raised.hand.handId, { build: build(), readBetween: true }))).toEqual(checks);
  }, 60_000);
});

describe("an open Hand", () => {
  it("has the first four checks; an unknown number is Core's NotRaised", async () => {
    const raised = await raise({ reward: 0n });
    const checks = await passportOf(await collect(client, chain.core, raised.hand.handId));
    expect(ids(checks)).toEqual(["core", "raised", "reward-time", "description"]);
    expect(byId(checks, "core").ok).toBe("not-checkable");
    expect(failed(checks)).toEqual([]);
    await expect(collect(client, chain.core, 999_999n)).rejects.toMatchObject({ name: "NotRaised" });
  });
});
