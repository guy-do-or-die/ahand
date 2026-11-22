import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  concatHex,
  createWalletClient,
  decodeFunctionData,
  encodeFunctionData,
  getContractAddress,
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
  BUNDLE_MAX_PENDING,
  CANONICAL_CORE,
  CANONICAL_CORE_BUILD,
  CORE_ABI,
  THANK_TRIES,
  TX_BYTES_LIMIT,
  approveCall,
  chainNow,
  collectRecord,
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
  verifyBundleOnChain,
  type Call,
  type Check,
  type Eip712Domain,
  type Give,
  type Hand,
  type HandRecord,
  type OpenedLink,
  type SignedGive,
} from "../src/index.js";
import { ANVIL_KEYS, CREATE2_FACTORY, REPO_ROOT, startChain, type Chain } from "./helpers/anvil.js";

/**
 * The passport on a running Core: Hands are raised, passed, given and thanked (or refunded) on the
 * helper chain through the SDK, then `collectRecord` reads them and `passportOf` proves every fact. The
 * contract's own probe, FactsReader, is deployed from contracts/out and must agree.
 */

// SDK_TEST_PORT_BASE=B moves the fixed ports of money, wallet, proof and steps to B … B+3.
const PORT = process.env.SDK_TEST_PORT_BASE ? Number(process.env.SDK_TEST_PORT_BASE) + 2 : 16201;
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

const build = () => ({ commit: chain.commit, dirty: chain.dirty });

interface Raised {
  hand: Hand;
  seed: Hex;
  linkPart?: ReturnType<typeof describeHand>["linkPart"];
  publicPart?: Uint8Array;
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
  return { hand, seed, linkPart: described?.linkPart, publicPart: described?.publicPart ? packAttachments(described.publicPart) : undefined };
}

/** Passes the link on once per entry, each holder keeping `keep` basis points for `payee`. */
async function route(raised: Raised, passes: { payee: Address; keep: number }[]): Promise<OpenedLink> {
  const options = raised.publicPart ? { publicPart: raised.publicPart } : {};
  const getHand = async () => raised.hand;
  let link = await encodeLive({ domain: dom, hand: raised.hand, signedShakes: [], seed: raised.seed, attachments: raised.linkPart }, options);
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
    { domain: dom, hand: raised.hand, signedShakes: opened.signedShakes, signedGive, attachments: opened.linkPart },
    raised.publicPart ? { publicPart: raised.publicPart } : {},
  );
  return { signedGive, giveLink };
}

const byKey = (key: Hex) => (give: Give, hand: Hand) => signGiveWithKey(key, dom, hand, give);

const failed = (checks: Check[]) => checks.filter((check) => check.verdict === false);
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
  let live: Uint8Array;
  const first = fresh();
  const second = fresh();

  beforeAll(async () => {
    const raised = await raise({ reward: 1_000_000n, describe: true });
    live = await encodeLive(
      { domain: dom, hand: raised.hand, signedShakes: [], seed: raised.seed, attachments: raised.linkPart },
      raised.publicPart ? { publicPart: raised.publicPart } : {},
    );
    const opened = await route(raised, [
      { payee: first, keep: 500 },
      { payee: second, keep: 0 },
    ]);
    const { signedGive, giveLink } = await giveAt(raised, opened, giverAddress, byKey(giverKey));
    await send(raiserKey, thankCall(chain.core, raised.hand.handId, opened.signedShakes, signedGive));
    record = await collectRecord(client, chain.core, raised.hand.handId, { giveLink, publicPart: raised.publicPart, build: build() });
    checks = await passportOf(record);
  }, 60_000);

  it("every check holds, in the passport's order", () => {
    expect(failed(checks)).toEqual([]);
    expect(checks.every((check) => check.verdict === true)).toBe(true);
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

    expect(raiser).toBe(record.coreHand.raiser);
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

  it("a bundle re-checks with no network: signatures, hashes and sums keep their verdict, events and views read 'recorded'", async () => {
    const json = exportBundle(record);
    expect(json).not.toMatch(/"\d+n"/);
    expect(readBundle(json)).toEqual(record);
    const offline = await verifyBundle(json);
    expect(ids(offline)).toEqual(ids(checks));
    for (const [index, check] of offline.entries()) {
      const read = checks[index]!;
      expect(check.basis).toBe(read.basis);
      expect(check.verdict).toBe(read.basis === "recorded" ? "recorded" : read.verdict);
    }
    // What a file alone proves: the key signatures, the route and the giver's signature.
    expect(offline.filter((check) => check.verdict === true).map((check) => check.id)).toEqual(["description", "keys.0", "keys.1", "give-key", "giver"]);
  });

  it("the same bundle against the chain: every log and view equals the chain, and the passport is the one read from it", async () => {
    const onChain = await verifyBundleOnChain(client, exportBundle(record));
    expect(onChain[0]).toMatchObject({ id: "chain", verdict: true, actual: "equal" });
    expect(onChain.slice(1)).toEqual(checks);
  });

  it("a bundle with every amount multiplied by ten never holds offline in its amounts, and fails against the chain", async () => {
    const bundle = JSON.parse(exportBundle(record));
    const times10 = (value: string) => String(BigInt(value) * 10n);
    bundle.coreHand.reward = times10(bundle.coreHand.reward);
    for (const log of bundle.logs as { eventName: string; args: Record<string, string>; blockHash: string; transactionHash: string }[]) {
      for (const field of ["reward", "margin", "amount"]) if (log.args[field] !== undefined) log.args[field] = times10(log.args[field]!);
    }
    const forged = JSON.stringify(bundle);
    const offline = await verifyBundle(forged);
    expect(failed(offline)).toEqual([]);
    for (const id of ["raised", "reward-time", "share.0", "giver-amount", "payout.shake.0", "payout.giver", "payouts"]) {
      expect(byId(offline, id).verdict, id).toBe("recorded");
    }
    const onChain = await verifyBundleOnChain(client, forged);
    expect(onChain[0]!.id).toBe("chain");
    expect(onChain[0]!.verdict).toBe(false);
    expect(onChain[0]!.actual).toContain(`hands(${record.handId}).reward is ${record.coreHand.reward}`);
    expect(onChain[0]!.actual).toContain("not on chain: Raised(");
    expect(onChain.slice(1).some((check) => check.basis === "recorded" && check.verdict === true)).toBe(false);

    // Every block and transaction hash replaced: the logs are not found where the file says.
    const moved = JSON.parse(exportBundle(record));
    for (const log of moved.logs as { blockHash: string; transactionHash: string }[]) {
      log.blockHash = keccak256(stringToBytes(`block ${log.blockHash}`));
      log.transactionHash = keccak256(stringToBytes(`tx ${log.transactionHash}`));
    }
    const elsewhere = await verifyBundleOnChain(client, JSON.stringify(moved));
    expect(elsewhere[0]!.verdict).toBe(false);
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

  it("writes only today's keys, and reads a bundle of an earlier writer, which named hands(id)'s record `view` and the public part `outside`", async () => {
    const today = JSON.parse(exportBundle(record));
    expect(record.publicPart).toBeDefined();
    expect(Object.keys(today)).toEqual(expect.arrayContaining(["coreHand", "publicPart"]));
    expect(today).not.toHaveProperty("view");
    expect(today).not.toHaveProperty("outside");

    const { coreHand, publicPart, ...rest } = today;
    const earliest = JSON.stringify({ ...rest, view: coreHand, outside: publicPart });
    const earlier = JSON.stringify({ ...rest, coreHand, outside: publicPart });
    for (const file of [earliest, earlier]) {
      expect(readBundle(file)).toEqual(record);
      expect(await verifyBundle(file)).toEqual(await verifyBundle(exportBundle(record)));
      // Read back and written again, a file of an earlier writer carries only today's keys.
      expect(JSON.parse(exportBundle(readBundle(file)))).toEqual(today);
    }
    // The description row reads the public part under either key: without it the link's words are lost.
    const offlineEarlier = await verifyBundle(earlier);
    expect(offlineEarlier.find((check) => check.id === "description")).toMatchObject({ verdict: true });
    const withoutPublicPart = await verifyBundle(JSON.stringify({ ...rest, coreHand }));
    expect(withoutPublicPart.find((check) => check.id === "description")!.verdict).toBe("not-checkable");

    // A file with an earlier key and the key it became is not read: which one it means cannot be told.
    expect(() => readBundle(JSON.stringify({ ...today, outside: publicPart }))).toThrow(/both outside and publicPart/);
    expect(() => readBundle(JSON.stringify({ ...today, view: coreHand }))).toThrow(/both view and coreHand/);
  });

  it("refuses a file larger than any honest one: a log without its arguments, a thank input longer than a transaction, too many payees", () => {
    const bundle = () => JSON.parse(exportBundle(record));
    const withoutAmount = bundle();
    delete withoutAmount.logs.find((log: { eventName: string }) => log.eventName === "Given").args.amount;
    expect(() => readBundle(JSON.stringify(withoutAmount))).toThrow(/Given carries/);
    const extra = bundle();
    extra.logs.find((log: { eventName: string }) => log.eventName === "Given").args.extra = zeroHash;
    expect(() => readBundle(JSON.stringify(extra))).toThrow(/Given carries/);
    const long = bundle();
    long.thankInput = `0x${"00".repeat(TX_BYTES_LIMIT + 1)}`;
    expect(() => readBundle(JSON.stringify(long))).toThrow(/longer than any transaction/);
    const payees = bundle();
    payees.pending = Array.from({ length: BUNDLE_MAX_PENDING + 1 }, () => ({ ...payees.pending[0] }));
    expect(() => readBundle(JSON.stringify(payees))).toThrow(/pending/);
  });

  it("never keeps a live link in a record: its seed is the route's key", async () => {
    await expect(collectRecord(client, chain.core, record.handId, { giveLink: live })).rejects.toThrow(/live link/);
    expect(() => exportBundle({ ...record, giveLink: live })).toThrow(/live link/);
  });

  it("reads signatures only from the transaction that emitted Thanked, and says so against the chain", async () => {
    const raisedTx = record.logs.find((log) => log.eventName === "Raised")!.transactionHash;
    const elsewhere = { ...record, closingTx: raisedTx };
    // The give link still serves; without it, nothing does.
    expect(byId(await passportOf(elsewhere), "keys.0").inputs.from).toBe("give link");
    const offline = await passportOf({ ...elsewhere, giveLink: undefined });
    for (const id of ["keys.0", "give-key", "giver"]) expect(byId(offline, id).verdict).toBe("not-checkable");
    const onChain = await verifyBundleOnChain(client, exportBundle(elsewhere));
    expect(onChain[0]!.verdict).toBe(false);
    expect(onChain[0]!.actual).toContain("the closing transaction is");
  });

  it("takes a Core's build, never its address, as the Core to trust", async () => {
    await expect(passportOf(record, { coreBuild: chain.core as never })).rejects.toThrow(TypeError);
    expect(byId(await passportOf(record, { coreBuild: CANONICAL_CORE_BUILD }), "core")).toEqual(byId(checks, "core"));
  });

  it("finds the thank in an input full of selectors in a bounded time", () => {
    const hand = routeOf(record)!.hand;
    const selector = record.thankInput!.slice(2, 10);
    const handWord = hand.handId.toString(16).padStart(64, "0");
    // 128 KB of the selector followed by zeros: no place names this Hand, nothing is decoded.
    const zeros = `0x${`${selector}${"00".repeat(28)}`.repeat(TX_BYTES_LIMIT / 32 - 1)}` as Hex;
    // The selector and this Hand's number again and again: only THANK_TRIES of them are decoded.
    const named = `0x${`${selector}${handWord}`.repeat(Math.floor((TX_BYTES_LIMIT - 64) / 36))}` as Hex;
    const started = performance.now();
    expect(thankInputOf(zeros, hand, record.thank.giveHash)).toBeUndefined();
    expect(thankInputOf(named, hand, record.thank.giveHash)).toBeUndefined();
    expect(thankInputOf(`${zeros}${"00".repeat(64)}`, hand, record.thank.giveHash)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(THANK_TRIES).toBe(16);
    // The honest input is still found.
    expect(thankInputOf(record.thankInput!, hand, record.thank.giveHash)).toBeDefined();
  });
});

describe("a thanked Hand with no reward", () => {
  it("passes with no payout rows at all", async () => {
    const raised = await raise({ reward: 0n });
    const opened = await route(raised, [{ payee: fresh(), keep: 500 }]);
    const { signedGive } = await giveAt(raised, opened, giverAddress, byKey(giverKey));
    await send(raiserKey, thankCall(chain.core, raised.hand.handId, opened.signedShakes, signedGive));
    const checks = await passportOf(await collectRecord(client, chain.core, raised.hand.handId, { build: build() }));
    expect(failed(checks)).toEqual([]);
    expect(checks.filter((check) => check.id.startsWith("payout."))).toEqual([]);
    expect(byId(checks, "share.0").actual).toBe("0");
    expect(byId(checks, "giver-amount").actual).toBe("0");
    expect(byId(checks, "payouts")).toMatchObject({ expected: "0", actual: "0", verdict: true });
    expect(byId(checks, "description")).toMatchObject({ actual: "none: the Hand has no description", verdict: true });
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

    const record = await collectRecord(client, chain.core, raised.hand.handId, { giveLink, build: build() });
    expect(record.giverHasCode).toBe(true);
    const checks = await passportOf(record);
    expect(failed(checks)).toEqual([]);
    expect(byId(checks, "giver")).toMatchObject({ messageId: "proof.giver.account", actual: "signed by its account", verdict: true });
    // That verdict rests on the giver's code, a fact read from the chain: a saved file only records it.
    expect(byId(checks, "giver").basis).toBe("recorded");
    expect(byId(await verifyBundle(exportBundle(record)), "giver").verdict).toBe("recorded");
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
    record = await collectRecord(client, chain.core, raised.hand.handId, { build: build() });
  }, 60_000);

  it("finds the Give inside execute(address,uint256,bytes) and the whole passport passes", async () => {
    expect(decodeFunctionData({ abi: ACCOUNT_ABI, data: record.thankInput! }).functionName).toBe("execute");
    const found = thankInputOf(record.thankInput!, routeOf(record)!.hand, record.thank.giveHash);
    expect(found?.signedGive.give).toEqual(routeOf(record)!.give);
    const checks = await passportOf(record);
    expect(failed(checks)).toEqual([]);
    expect(checks.every((check) => check.verdict === true)).toBe(true);
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
    for (const id of ["keys.0", "give-key", "giver"]) expect(byId(checks, id).verdict).toBe("not-checkable");
    expect(byId(checks, "give-hash").verdict).toBe(true);
  });
});

describe("a refunded Hand", () => {
  it("gets the shorter list, every check holding", async () => {
    const raised = await raise({ reward: 700_000n, seconds: 60 });
    await later(120);
    await send(giverKey, refundCall(chain.core, raised.hand.handId)); // anyone may refund
    const record = await collectRecord(client, chain.core, raised.hand.handId, { build: build() });
    const checks = await passportOf(record);
    expect(ids(checks)).toEqual(["core", "raised", "reward-time", "description", "refunded", "payout.raiser", `now.${raised.hand.raiser}`]);
    expect(checks.every((check) => check.verdict === true)).toBe(true);
    expect(byId(checks, "payout.raiser").actual).toBe(`Paid · 700000 · ${raised.hand.raiser}`);
  });

  it("with a reward of zero: no payout event is expected, none is there, and every check holds", async () => {
    const raised = await raise({ reward: 0n, seconds: 60 });
    await later(120);
    await send(giverKey, refundCall(chain.core, raised.hand.handId));
    const record = await collectRecord(client, chain.core, raised.hand.handId, { build: build() });
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
    const { coreHand } = await readHand(client, chain.core, raised.hand.handId);
    await send(raiserKey, extendCall(chain.core, raised.hand.handId, coreHand.expiry + 3_600));
    await later(30);
    const opened = await route(raised, []);
    const payee = fresh();
    await send(raiserKey, { to: blacklist, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "setBlocked", args: [payee, true] }) });
    const give: Give = { signer: giverAddress, payee, claimBps: 10_000, routeHash: zeroHash, dataHash: ANSWER };
    const signedGive: SignedGive = { give, keySig: await signGiveWithKey(opened.linkKey!, dom, raised.hand, give), giverSig: await signGiveWithKey(giverKey, dom, raised.hand, give) };
    await send(raiserKey, thankCall(chain.core, raised.hand.handId, [], signedGive));

    const record = await collectRecord(client, chain.core, raised.hand.handId, { build: build() });
    expect(record.between).toMatchObject({ read: false, requests: 1 });
    const asked = await passportOf(record);
    expect(failed(asked)).toEqual([]);
    expect(byId(asked, "reward-time").verdict).toBe("not-checkable");

    const whole = await readBetween(client, record);
    const checks = await passportOf(whole);
    expect(checks.every((check) => check.verdict === true)).toBe(true);
    expect(byId(checks, "reward-time")).toMatchObject({ actual: `reward 1500000 · expiry ${coreHand.expiry + 3_600}`, inputs: { funded: "500000" } });
    expect(byId(checks, "payout.giver").actual).toBe(`Pending · 1500000 · ${payee}`);
    expect(byId(checks, `now.${payee}`).actual).toBe("1500000");
    // The same Hand with the reading done at collectRecord time.
    expect(await passportOf(await collectRecord(client, chain.core, raised.hand.handId, { build: build(), readBetween: true }))).toEqual(checks);
  }, 60_000);
});

describe("an open Hand", () => {
  it("has the first four checks; an unknown number is Core's NotRaised", async () => {
    const raised = await raise({ reward: 0n });
    const checks = await passportOf(await collectRecord(client, chain.core, raised.hand.handId));
    expect(ids(checks)).toEqual(["core", "raised", "reward-time", "description"]);
    // The core row needs no facts from the caller: the canonical Core is a constant of the SDK.
    expect(byId(checks, "core").verdict).toBe(true);
    expect(failed(checks)).toEqual([]);
    await expect(collectRecord(client, chain.core, 999_999n)).rejects.toMatchObject({ name: "NotRaised" });
  });
});

describe("a Hand on a twin of Core: the same code at another address", () => {
  // A twin emits the same events and keeps the same views, so everything but its address agrees
  // with itself. Only the trusted Core, the canonical one unless a caller names another, may pass.
  const twinBuild = { factory: CREATE2_FACTORY, salt: keccak256(stringToBytes("a twin of Core")), initcodeHash: "0x" as Hex };
  let twin: Address;
  let record: HandRecord;

  beforeAll(async () => {
    const json = JSON.parse(readFileSync(join(REPO_ROOT, "contracts/out/AHandCore.sol/AHandCore.json"), "utf8"));
    const initcode = json.bytecode.object as Hex;
    twinBuild.initcodeHash = keccak256(initcode);
    twin = getContractAddress({ opcode: "CREATE2", from: twinBuild.factory, salt: twinBuild.salt, bytecodeHash: twinBuild.initcodeHash });
    const hash = await chain.wallet.sendTransaction({ to: CREATE2_FACTORY, data: concatHex([twinBuild.salt, initcode]), account: chain.deployer, chain: foundry });
    await client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    expect(await client.getCode({ address: twin })).toBeTruthy();
    expect(twin).not.toBe(CANONICAL_CORE);

    const seed = newSeed();
    const now = (await chainNow(client)).timestamp;
    const receipt = await send(
      raiserKey,
      raiseCall(twin, { token: usd, reward: 0n, expiry: now + 86_400, rootKey: privateKeyToAddress(keyOfSeed(seed)), payoutGasK: 250, minClaimBps: 0, dataHash: zeroHash }),
    );
    const [log] = parseEventLogs({ abi: CORE_ABI, eventName: "Raised", logs: receipt.logs });
    const { hand } = await readHand(client, twin, log!.args.handId);
    const twinDomain = domain(chain.chainId, twin);
    const give: Give = { signer: giverAddress, payee: giverAddress, claimBps: 10_000, routeHash: zeroHash, dataHash: ANSWER };
    const signedGive: SignedGive = {
      give,
      keySig: await signGiveWithKey(keyOfSeed(seed), twinDomain, hand, give),
      giverSig: await signGiveWithKey(giverKey, twinDomain, hand, give),
    };
    await send(raiserKey, thankCall(twin, hand.handId, [], signedGive));
    record = await collectRecord(client, twin, hand.handId);
  }, 60_000);

  it("fails the core row against the canonical Core, and passes every row only when the caller trusts the twin", async () => {
    const checks = await passportOf(record);
    expect(failed(checks).map((check) => check.id)).toEqual(["core"]);
    expect(byId(checks, "core")).toMatchObject({ expected: CANONICAL_CORE, actual: twin, verdict: false });

    const trusted = await passportOf(record, { coreBuild: twinBuild });
    expect(trusted.every((check) => check.verdict === true)).toBe(true);
    expect(byId(trusted, "core")).toMatchObject({ expected: twin, actual: twin, verdict: true });
  });

  it("takes no Core facts from a bundle: a file that names the twin's factory, salt and code hash still fails", async () => {
    const forged = JSON.parse(exportBundle(record));
    forged.build = { factory: twinBuild.factory, salt: twinBuild.salt, initcodeHash: twinBuild.initcodeHash };
    const json = JSON.stringify(forged);

    expect(byId(await verifyBundle(json), "core").verdict).toBe(false);
    const onChain = await verifyBundleOnChain(client, json);
    // The file equals the chain: it is the twin's chain. It is still not the trusted Core.
    expect(onChain[0]).toMatchObject({ id: "chain", verdict: true });
    expect(byId(onChain, "core").verdict).toBe(false);

    const trusted = await verifyBundleOnChain(client, json, { coreBuild: twinBuild });
    expect(trusted.every((check) => check.verdict === true)).toBe(true);
    expect(byId(await verifyBundle(json, { coreBuild: twinBuild }), "core").verdict).toBe("recorded");
  });
});
