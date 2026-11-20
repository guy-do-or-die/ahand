/**
 * Fixture Hands for every screen state, made through the SDK on a running chain (PLAN wave 3).
 *
 *   bun infra/stand/seed.ts --slot N [--json] [--only a,b] [--site URL]
 *   bun infra/stand/seed.ts --stand FILE [--json] [--only a,b] [--site URL]
 *
 * Every run makes a complete new set, so each spec file can seed for itself on one chain. A run
 * mines its own blocks (`evm_mine`) instead of waiting for the chain's interval, and holds a lock
 * per chain so that two runs never race for account 1's nonces. Time is read from the chain only.
 *
 * The raiser is anvil account 1. Its root and inbox keys are derived as the app derives them
 * (ARCHITECTURE §5): `keysTypedData` signed by account 1, one fixed test book (`TEST_BOOK`), and `n`
 * counting up from Core's `handsCount()` at the start of the run, so no two runs on a chain share
 * an `n`. The output names the book and each `n`, so a test can rebuild a link or listen on an inbox.
 *
 * This file is also the library `loop.ts` and `tests/e2e/lib/craft.ts` build on (`World`).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddressEqual,
  parseAbi,
  serializeErc6492Signature,
  zeroAddress,
  zeroHash,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, privateKeyToAddress, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import {
  CORE_ABI,
  CoreRefused,
  approveCall,
  askSigner,
  carryFor,
  castLine,
  chainNow,
  checkGive,
  checkGiveOnChain,
  decodeCoreError,
  describeHand,
  domain as domainOf,
  encodeGive,
  encodeLive,
  expiryAfter,
  getHandFor,
  handLogs,
  inboxSecret,
  innerGiverSig,
  isErc6492,
  judgeGive,
  keyOfSeed,
  keysTypedData,
  masterOf,
  openAddress,
  packAttachments,
  passOn,
  raiseCall,
  readDescription,
  readHand,
  readLimits,
  receiptOf,
  refundCall,
  rootSeed,
  seenGiveOf,
  setupCall,
  signGive,
  signGiveWithKey,
  signShake,
  simulate,
  thankCall,
  toAddress,
  unwrap6492,
  walletKind,
  withdrawCall,
  type AccountSetup,
  type AddressShape,
  type Call,
  type DescribeMode,
  type Eip712Domain,
  type Give,
  type GiveSigner,
  type Hand,
  type HandState,
  type HandView,
  type LinkOptions,
  type OpenedAddress,
  type Receipt,
  type Shake,
  type SignedGive,
  type SignedShake,
  type WalletKind,
} from "@ahand/sdk";
import { ANVIL_KEYS } from "@ahand/sdk/testing";
import { publicKeyOf } from "@ahand/deliver";

import { pathsOf } from "./ports.ts";

/* ------------------------------------------------------------------ roles */

/** Who plays what in every fixture and loop step: anvil's public test accounts by index. */
export const ROLE = {
  /** Sends what anyone may send: refund, withdraw, the token's block switch. */
  anyone: 0,
  raiser: 1,
  /** The first holder: passes the link on, keeping a share. */
  holderA: 2,
  /** The second holder. */
  holderB: 3,
  giver: 4,
  /** Owns the KeyAccount that is not deployed yet (ERC-6492). */
  undeployedOwner: 6,
  /**
   * The holder whose payout waits in the `blocked` fixture: blocked in BlacklistToken by every
   * seed run, and by nothing else, so the loop's cycles in that token never meet a block.
   */
  blockedPayee: 7,
  /** The holder `loop.ts` blocks for its own pending part, and unblocks again. */
  loopBlockedPayee: 8,
} as const;

/** The one fixed test book of the fixtures (8 bytes: the word "fixtures"). */
export const TEST_BOOK: Hex = "0x6669787475726573";

/** The defaults the app offers (D-26): the helper gets at least 70%, 250 thousand gas per payout. */
export const DEFAULT_MIN_CLAIM_BPS = 7_000;
export const DEFAULT_PAYOUT_GAS_K = 250;
export const DAY = 86_400;

const FACTORY_ABI = parseAbi([
  "function createAccount(address owner, uint256 salt) returns (address)",
  "function getAddress(address owner, uint256 salt) view returns (address)",
]);
const BLACKLIST_ABI = parseAbi(["function setBlocked(address account, bool isBlocked)", "function blocked(address) view returns (bool)"]);

/* ------------------------------------------------------------------ stand */

export interface StandToken {
  address: Address;
  symbol: string;
  decimals: number;
  kind: string;
}

/** What a stand file says, whichever wrote it: the stand (`stand.json`) or the helper chain (`--write-stand`). */
export interface StandFacts {
  file: string;
  slot: number | null;
  rpc: string;
  relay: string | null;
  site: string | null;
  chainId: number;
  core: Address;
  tokens: StandToken[];
  forwarder: Address | null;
  accountFactory: Address | null;
}

/** The value after a flag, or undefined; a flag given without a value throws. */
export function flagValue(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

/** The stand named by `--stand FILE` or `--slot N` (or STAND_FILE / STAND_SLOT). */
export function standFrom(argv: string[]): StandFacts {
  const fileFlag = flagValue(argv, "--stand");
  const slotFlag = flagValue(argv, "--slot");
  let file: string;
  if (fileFlag !== undefined) file = resolve(fileFlag);
  else if (slotFlag !== undefined) file = pathsOf(Number(slotFlag)).stand;
  else if (process.env.STAND_FILE) file = resolve(process.env.STAND_FILE);
  else if (process.env.STAND_SLOT) file = pathsOf(Number(process.env.STAND_SLOT)).stand;
  else throw new Error("name the chain: --slot N (infra/stand/.run/N/stand.json) or --stand FILE");
  if (!existsSync(file)) throw new Error(`no stand file at ${file}`);
  const json = JSON.parse(readFileSync(file, "utf8"));
  for (const field of ["rpc", "chainId", "core", "tokens"]) {
    if (json[field] === undefined || json[field] === null) throw new Error(`${file} has no ${field}`);
  }
  if (json.chainId !== 31337) throw new Error(`fixtures are made on the local chain 31337 only, not ${json.chainId}`);
  return {
    file,
    slot: typeof json.slot === "number" ? json.slot : null,
    rpc: json.rpc,
    relay: json.relay ?? null,
    site: json.site ?? null,
    chainId: json.chainId,
    core: getAddress(json.core),
    tokens: json.tokens,
    forwarder: json.forwarder ? getAddress(json.forwarder) : null,
    accountFactory: json.accountFactory ? getAddress(json.accountFactory) : null,
  };
}

/* ------------------------------------------------------------------- lock */

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Runs `work` while holding this chain's lock: a folder in the system's temporary directory,
 * named after the RPC address, holding the owner's process id. A lock whose owner is gone is
 * taken over; no clock is read.
 */
export async function withChainLock<T>(rpc: string, work: () => Promise<T>): Promise<T> {
  const dir = join(tmpdir(), `ahand-chain-${createHash("sha256").update(rpc).digest("hex").slice(0, 16)}.lock`);
  const owner = join(dir, "pid");
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(dir);
      writeFileSync(owner, String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder = 0;
      try {
        holder = Number(readFileSync(owner, "utf8"));
      } catch {
        // the owner has not written its id yet
      }
      if (holder > 0 && !alive(holder)) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (attempt > 6_000) throw new Error(`the chain at ${rpc} stayed locked by process ${holder || "?"} for five minutes (${dir})`);
      await sleep(50);
    }
  }
  const release = () => rmSync(dir, { recursive: true, force: true });
  process.once("exit", release);
  try {
    return await work();
  } finally {
    process.removeListener("exit", release);
    release();
  }
}

/* ------------------------------------------------------------------ world */

export interface RaiseSpec {
  mode: DescribeMode;
  title: string;
  content?: string;
  token?: "usd" | "blacklist";
  /** In the token's smallest units; zero is a valid reward. */
  reward: bigint;
  /** From the chain's latest block; capped by `expiryAfter`. Default 30 days. */
  expirySeconds?: number;
  minClaimBps?: number;
  payoutGasK?: number;
  /** Write the first link without its description: what a root key rebuilt on another device opens. */
  withoutDescription?: boolean;
}

export interface Raised {
  handId: bigint;
  n: number;
  mode: DescribeMode;
  token: StandToken;
  reward: bigint;
  hand: Hand;
  view: HandView;
  title: string;
  content?: string;
  /** The Hand's inbox (`inbox.n1`): a 32-byte x-only public key. */
  inbox: Hex;
  /** The first live link, 0 Shakes, in the Hand's address shape. */
  address: string;
  block: bigint;
}

export interface Passed {
  address: string;
  opened: OpenedAddress;
  /** The new link's seed: the next holder's secret. Never printed outside `craft secrets`. */
  seed: Hex;
}

export interface Given {
  address: string;
  hand: Hand;
  signedShakes: SignedShake[];
  signedGive: SignedGive;
  giveHash: Hex;
}

export interface Thanked {
  receipt: TransactionReceipt;
  rows: Receipt;
  setupSent: boolean;
}

/** A giver that signs as the account a key will own once it is set up: its answer wrapped per ERC-6492. */
export function undeployedSigner(owner: PrivateKeyAccount, factory: Address, factoryData: Hex): GiveSigner {
  return {
    async signTypedData(typedData) {
      const signature = await owner.signTypedData(typedData);
      return serializeErc6492Signature({ address: factory, data: factoryData, signature });
    },
  };
}

/** The chain, the SDK's options for it, the test accounts, and every step a fixture is made of. */
export class World {
  readonly client: PublicClient;
  readonly test: TestClient<"anvil">;
  readonly domain: Eip712Domain;
  readonly options: LinkOptions;
  readonly site: string;
  readonly getHand: ReturnType<typeof getHandFor>;
  private readonly wallets = new Map<number, WalletClient>();
  private master?: Hex;
  private nextN?: number;
  private maxExpiryPeriod?: number;

  constructor(
    readonly stand: StandFacts,
    site?: string,
  ) {
    const transport = http(stand.rpc);
    this.client = createPublicClient({ chain: foundry, transport, pollingInterval: 50 }) as PublicClient;
    this.test = createTestClient({ chain: foundry, mode: "anvil", transport });
    this.domain = domainOf(stand.chainId, stand.core);
    // The stand's Core is the canonical one of its configuration (helper's configOf, stand's config.json).
    this.options = { canonicalCore: stand.core };
    this.site = (site ?? stand.site ?? "http://127.0.0.1").replace(/\/+$/, "");
    this.getHand = getHandFor({ [stand.chainId]: this.client }, [{ chainId: stand.chainId, core: stand.core }]);
  }

  account(index: number): PrivateKeyAccount {
    const key = ANVIL_KEYS[index];
    if (!key) throw new Error(`no anvil test account ${index}`);
    return privateKeyToAccount(key);
  }

  address(index: number): Address {
    return this.account(index).address;
  }

  private wallet(index: number): WalletClient {
    let wallet = this.wallets.get(index);
    if (!wallet) {
      wallet = createWalletClient({ account: this.account(index), chain: foundry, transport: http(this.stand.rpc) });
      this.wallets.set(index, wallet);
    }
    return wallet;
  }

  token(kind: string): StandToken {
    const token = this.stand.tokens.find((t) => t.kind === kind);
    if (!token) throw new Error(`the stand has no ${kind} token`);
    return { ...token, address: getAddress(token.address) };
  }

  get core(): Address {
    return this.stand.core;
  }

  /** The latest block: the one clock. */
  now(): Promise<{ number: bigint; timestamp: number }> {
    return chainNow(this.client);
  }

  /**
   * Simulates the call through the SDK (a refusal by Core throws `CoreRefused`), sends it from
   * test account `from`, mines a block at once and returns the successful receipt.
   */
  async send(from: number, call: Call): Promise<TransactionReceipt> {
    const account = this.account(from);
    const simulated = await simulate(this.client, call, account.address);
    if (!simulated.ok) throw new CoreRefused(simulated.refusal);
    const hash = await this.wallet(from).sendTransaction({
      account,
      chain: foundry,
      to: call.to,
      data: call.data,
      gas: (simulated.gas * 13n) / 10n,
    });
    await this.test.mine({ blocks: 1 });
    const receipt = await this.client.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    if (receipt.status !== "success") throw new Error(`transaction ${hash} was mined and reverted`);
    return receipt;
  }

  /** Moves the chain's clock until its latest block is at or past `timestamp`. */
  async jumpTo(timestamp: number): Promise<{ number: bigint; timestamp: number }> {
    let now = await this.now();
    if (now.timestamp < timestamp) {
      await this.test.increaseTime({ seconds: timestamp - now.timestamp });
      await this.test.mine({ blocks: 1 });
      now = await this.now();
    }
    if (now.timestamp < timestamp) throw new Error(`the chain's clock stands at ${now.timestamp}, short of ${timestamp}`);
    return now;
  }

  /** The keys message signed by the raiser, as the app asks for it, and its HKDF master. */
  async raiserMaster(): Promise<Hex> {
    if (!this.master) {
      const raiser = this.account(ROLE.raiser);
      const signature = await raiser.signTypedData(keysTypedData(this.stand.chainId, this.core, raiser.address));
      this.master = await masterOf(signature);
    }
    return this.master;
  }

  /** The inbox secret of the raiser's Hand number `n` in the test book. */
  async inboxSecretOf(n: number): Promise<Hex> {
    return inboxSecret(await this.raiserMaster(), TEST_BOOK, n);
  }

  /** The next `n` of the test book: Core's `handsCount()` when first asked, then one more each time. */
  private async reserveN(): Promise<number> {
    if (this.nextN === undefined) {
      const count = await this.client.readContract({ address: this.core, abi: CORE_ABI, functionName: "handsCount" });
      this.nextN = Number(count);
    }
    return this.nextN++;
  }

  private async capOfExpiry(): Promise<number> {
    this.maxExpiryPeriod ??= (await readLimits(this.client, this.core)).maxExpiryPeriod;
    return this.maxExpiryPeriod;
  }

  /** Raises a Hand as the app does: keys, description with `inbox.n1`, expiry by the chain's clock, approve and raise. */
  async raise(spec: RaiseSpec): Promise<Raised> {
    const n = await this.reserveN();
    const master = await this.raiserMaster();
    const seed = await rootSeed(master, TEST_BOOK, n);
    const rootKey = privateKeyToAddress(keyOfSeed(seed));
    const inbox = publicKeyOf(await inboxSecret(master, TEST_BOOK, n));
    const described = describeHand({ mode: spec.mode, title: spec.title, content: spec.content, inbox });
    const token = this.token(spec.token ?? "usd");

    const now = await this.now();
    const expiry = expiryAfter(now.timestamp, spec.expirySeconds ?? 30 * DAY, await this.capOfExpiry());
    if (spec.reward > 0n) await this.send(ROLE.raiser, approveCall(token.address, this.core, spec.reward));
    const receipt = await this.send(
      ROLE.raiser,
      raiseCall(this.core, {
        token: token.address,
        reward: spec.reward,
        expiry,
        rootKey,
        payoutGasK: spec.payoutGasK ?? DEFAULT_PAYOUT_GAS_K,
        minClaimBps: spec.minClaimBps ?? DEFAULT_MIN_CLAIM_BPS,
        dataHash: described.dataHash,
      }),
    );
    const handId = raisedIn(receipt, this.core);
    const { view, hand } = await readHand(this.client, this.core, handId);
    check(isAddressEqual(view.rootKey, rootKey), `Hand ${handId}: Core keeps another root key`);
    check(view.reward === spec.reward && view.expiry === expiry && view.dataHash === described.dataHash, `Hand ${handId}: Core keeps other terms`);

    let address: string;
    if (spec.withoutDescription) {
      const link = await encodeLive({ domain: this.domain, hand, signedShakes: [], seed }, this.options);
      address = toAddress({ site: this.site, link, shape: "bare" }, this.options);
    } else {
      const outside = described.outside && packAttachments(described.outside);
      const link = await encodeLive({ domain: this.domain, hand, signedShakes: [], seed, attachments: described.inside }, { ...this.options, outside });
      address = toAddress({ site: this.site, link, shape: described.shape, outside: described.outside }, this.options);
    }
    return {
      handId,
      n,
      mode: spec.mode,
      token,
      reward: spec.reward,
      hand,
      view,
      title: spec.title,
      ...(spec.content === undefined ? {} : { content: spec.content }),
      inbox,
      address,
      block: receipt.blockNumber,
    };
  }

  /** Opens an address as the app does: fail closed on any other chain or Core. */
  open(address: string): Promise<OpenedAddress> {
    return openAddress(address, this.getHand, this.options);
  }

  /**
   * Passes a live link on, keeping `keepBps` for `payee` (nothing and no payee at 0), in the same
   * shape or a darker one; then reads the payee and share back from the written link.
   */
  async pass(address: string, terms: { payee?: Address; keepBps: number; shape?: AddressShape }): Promise<Passed> {
    const opened = await this.open(address);
    const shape = terms.shape ?? opened.seen.shape;
    const carry = carryFor(opened, shape);
    const outside = carry.outside && packAttachments(carry.outside);
    const payee = terms.keepBps > 0 ? terms.payee : zeroAddress;
    if (!payee) throw new Error("a pass that keeps a share names its payee");
    const nextClaimBps = opened.end.claimBps - terms.keepBps;
    const { link, seed } = await passOn(opened, { payee, nextClaimBps }, { ...this.options, outside }, carry.attachments);
    const next = toAddress({ site: this.site, link, shape, outside: carry.outside }, this.options);
    const reread = await this.open(next);
    const last = reread.signedShakes.at(-1)!.shake;
    check(isAddressEqual(last.payee, payee) && last.claimBps - last.nextClaimBps === terms.keepBps, "the written link does not read back as passed");
    return { address: next, opened: reread, seed };
  }

  /**
   * Answers a live link as the giver: the link key and the giver's signer sign the Give, the SDK
   * checks it offline (asking the account's code where there is code, deployed or not), Core
   * checks it by `eth_call` (through the forwarder when `setup` is given), then the give link is
   * written as a bare address carrying the Hand's description.
   */
  async give(address: string, giver: { signer: GiveSigner; address: Address; kind: WalletKind; payee?: Address; setup?: AccountSetup }): Promise<Given> {
    const opened = await this.open(address);
    if (!opened.linkKey) throw new Error("only a live link can be answered");
    const give: Give = {
      signer: giver.address,
      payee: giver.payee ?? giver.address,
      claimBps: opened.end.claimBps,
      routeHash: opened.end.routeHash,
      dataHash: zeroHash,
    };
    const keySig = await signGiveWithKey(opened.linkKey, opened.domain, opened.hand, give);
    const giverSig = await signGive(giver.signer, giver.kind, opened.domain, opened.hand, give);
    const signedGive: SignedGive = { give, keySig, giverSig };
    const giveHash = await checkGive(opened.domain, opened.hand, opened.signedShakes, signedGive, askSigner(this.client));
    await checkGiveOnChain(this.client, this.core, opened.hand.handId, opened.signedShakes, signedGive, giver.setup);
    const carry = carryFor(opened, "bare");
    const link = await encodeGive(
      { domain: opened.domain, hand: opened.hand, signedShakes: opened.signedShakes, signedGive, attachments: carry.attachments },
      this.options,
    );
    return {
      address: toAddress({ site: this.site, link, shape: "bare" }, this.options),
      hand: opened.hand,
      signedShakes: opened.signedShakes,
      signedGive,
      giveHash,
    };
  }

  /** A Give signed by test account `index`'s own key. */
  giveAs(address: string, index: number, payee?: Address): Promise<Given> {
    const account = this.account(index);
    return this.give(address, { signer: account, address: account.address, kind: "key", payee });
  }

  /** The KeyAccount `owner` will have at `salt`: its address, and the setup that deploys it. */
  async undeployedAccount(owner: number, salt: bigint): Promise<{ address: Address; setup: AccountSetup }> {
    const { accountFactory, forwarder } = this.stand;
    if (!accountFactory || !forwarder) throw new Error("this stand has no test account factory or forwarder");
    const ownerAddress = this.address(owner);
    const address = await this.client.readContract({ address: accountFactory, abi: FACTORY_ABI, functionName: "getAddress", args: [ownerAddress, salt] });
    const factoryData = encodeFunctionData({ abi: FACTORY_ABI, functionName: "createAccount", args: [ownerAddress, salt] });
    return { address: getAddress(address), setup: { forwarder, factory: accountFactory, factoryData } };
  }

  /** A Give by an account not deployed yet: the KeyAccount of `owner` at `salt`, its signature wrapped per ERC-6492. */
  async giveUndeployed(address: string, owner: number, salt: bigint): Promise<Given & { account: Address; setup: AccountSetup }> {
    const { address: account, setup } = await this.undeployedAccount(owner, salt);
    const code = await this.client.getCode({ address: account });
    check(code === undefined || code === "0x", `the account ${account} is already deployed: pick another salt`);
    const kind = await walletKind(this.client, account);
    const signer = undeployedSigner(this.account(owner), setup.factory, setup.factoryData);
    const given = await this.give(address, { signer, address: account, kind, setup });
    check(isErc6492(given.signedGive.giverSig), "the undeployed account's signature is not wrapped per ERC-6492");
    return { ...given, account, setup };
  }

  /**
   * The raiser thanks a give link as the thank screen does: Core's `checkGive` first; for a
   * wrapped signature whose account has no code yet, the setup call through the forwarder goes
   * first, then Core is asked again with the inner signature; then `thankCall`.
   */
  async thank(giveAddress: string): Promise<Thanked> {
    const opened = await this.open(giveAddress);
    const signedGive = opened.signedGive;
    if (!signedGive) throw new Error("not a give link");
    const handId = opened.hand.handId;
    let setupSent = false;
    const wrapped = unwrap6492(signedGive.giverSig);
    if (wrapped) {
      const code = await this.client.getCode({ address: signedGive.give.signer });
      if (code === undefined || code === "0x") {
        const { forwarder } = this.stand;
        if (!forwarder) throw new Error("no forwarder on this stand: the account cannot be set up");
        const setup: AccountSetup = { forwarder, factory: wrapped.factory, factoryData: wrapped.factoryData };
        await checkGiveOnChain(this.client, this.core, handId, opened.signedShakes, signedGive, setup);
        await this.send(ROLE.raiser, setupCall(setup));
        setupSent = true;
      }
    }
    await checkGiveOnChain(this.client, this.core, handId, opened.signedShakes, { ...signedGive, giverSig: innerGiverSig(signedGive.giverSig) });
    const receipt = await this.send(ROLE.raiser, thankCall(this.core, handId, opened.signedShakes, signedGive));
    const rows = receiptOf(await handLogs(this.client, this.core, handId, { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber }));
    check(rows.closedBy === "thank", `Hand ${handId}: the receipt is not a thank`);
    return { receipt, rows, setupSent };
  }

  /** Refunds an expired Hand, sent by anyone. */
  async refund(handId: bigint): Promise<{ receipt: TransactionReceipt; rows: Receipt }> {
    const receipt = await this.send(ROLE.anyone, refundCall(this.core, handId));
    const rows = receiptOf(await handLogs(this.client, this.core, handId, { fromBlock: receipt.blockNumber, toBlock: receipt.blockNumber }));
    check(rows.closedBy === "refund", `Hand ${handId}: the receipt is not a refund`);
    return { receipt, rows };
  }

  /** The state of a Hand at the latest block's time. */
  async stateOf(handId: bigint): Promise<HandState> {
    const [{ stateAt }, now] = await Promise.all([readHand(this.client, this.core, handId), this.now()]);
    return stateAt(now.timestamp);
  }

  balance(token: Address, owner: Address): Promise<bigint> {
    return this.client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  }

  /** The BlacklistToken's switch for `account`: anyone may flip it on the stand. */
  blockCall(token: Address, account: Address, blocked: boolean): Call {
    return { to: token, data: encodeFunctionData({ abi: BLACKLIST_ABI, functionName: "setBlocked", args: [account, blocked] }) };
  }

  /** A `cast send` line for a stand call, sent from an account anvil keeps unlocked (no key printed). */
  castFor(call: Call, from: number): string {
    return `${castLine(call, { rpc: this.stand.rpc, from: this.address(from) })} --unlocked`;
  }
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The Hand number in a `raise` receipt's `Raised` log. */
export function raisedIn(receipt: TransactionReceipt, core: Address): bigint {
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, core)) continue;
    try {
      const decoded = decodeEventLog({ abi: CORE_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === "Raised") return decoded.args.handId;
    } catch {
      // another event
    }
  }
  throw new Error(`no Raised log in ${receipt.transactionHash}`);
}

/** Core's refusal name in an error, or undefined. */
export function refusalName(error: unknown): string | undefined {
  return decodeCoreError(error)?.name;
}

/** JSON with bigints as decimal strings. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/** Receipt rows for JSON: event, payee, amount, position. */
export function rowsJson(receipt: Receipt) {
  return receipt.rows.map((row) => ({
    event: row.eventName,
    ...(row.payee ? { payee: row.payee } : {}),
    ...(row.amount === undefined ? {} : { amount: row.amount }),
    ...(row.position === undefined ? {} : { position: row.position }),
  }));
}

/* --------------------------------------------------------------- fixtures */

/** Every fixture's name, in the order a full run makes them. */
export const FIXTURE_NAMES = [
  "refunded",
  "thanked",
  "unlisted",
  "dark",
  "public",
  "twoPasses",
  "lost",
  "give",
  "resigned",
  "undeployed",
  "noReward",
  "expired",
  "blocked",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** Rewards in the test dollars' units (6 decimals). */
const USD = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;

const TEXTS: Record<FixtureName, { title: string; content: string }> = {
  refunded: { title: "Who can fix a 1978 Vespa in Lisbon?", content: "It starts, then dies after a minute. I can bring it anywhere in the city." },
  thanked: { title: "Looking for a Portuguese tutor in Porto", content: "Twice a week, evenings, for an adult beginner." },
  unlisted: { title: "Who can recommend a quiet room in Tbilisi for a week?", content: "Old town or Vake, from the 3rd, for one person who works from home." },
  dark: { title: "I need a lawyer who knows residence permits", content: "Georgian residence permit for a freelancer; one consultation is enough." },
  public: { title: "Who has a spare ticket to the Saturday chess open?", content: "One ticket, any section. I will pay the face value." },
  twoPasses: { title: "Who can repair an old Leica rangefinder?", content: "An M3 with a sticky shutter at slow speeds." },
  lost: { title: "Who knows a good dentist near Rustaveli?", content: "English-speaking, for a filling this week." },
  give: { title: "Who can translate a lease from Georgian?", content: "Four pages, plain English is enough, by Friday." },
  resigned: { title: "Who can help me move a piano on Sunday?", content: "Third floor, no lift, a short way across the street." },
  undeployed: { title: "Who can read a short contract review for me?", content: "Ten pages; I need a second opinion on two clauses." },
  noReward: { title: "Who wants to play doubles on Thursday evening?", content: "Tennis, intermediate level, the courts by the river." },
  expired: { title: "Who can lend me a tent for one weekend?", content: "For two people, back on Monday." },
  blocked: { title: "Who can find me a used cargo bike?", content: "Two-wheeled, for a child seat, in good shape." },
};

const handJson = (raised: Raised) => ({
  handId: raised.handId,
  n: raised.n,
  mode: raised.mode,
  token: raised.token.kind,
  reward: raised.reward,
  expiry: raised.view.expiry,
  rootKey: raised.view.rootKey,
  inbox: raised.inbox,
  title: raised.title,
  content: raised.content,
});

export interface SeedRun {
  chainId: number;
  core: Address;
  rpc: string;
  relay: string | null;
  site: string;
  book: Hex;
  raiser: { account: number; address: Address };
  accounts: Record<string, Address>;
  fixtures: Partial<Record<FixtureName, Record<string, unknown>>>;
  /** The chain's latest block when the run ended. */
  now: { block: bigint; timestamp: number };
  /** How long the run took, by the chain's blocks (the machine's clock is never read). */
  blocks: { from: bigint; to: bigint };
}

/** Makes the fixtures named in `only` (all by default) and returns the run's JSON-ready record. */
export async function seed(world: World, only: readonly FixtureName[] = FIXTURE_NAMES): Promise<SeedRun> {
  const want = (name: FixtureName) => only.includes(name);
  const out: SeedRun["fixtures"] = {};
  const A = world.address(ROLE.holderA);
  const B = world.address(ROLE.holderB);
  const start = await world.now();
  const raise = (name: FixtureName, spec: Omit<RaiseSpec, "title" | "content">) => world.raise({ ...spec, ...TEXTS[name] });

  // Short expiries first, so one jump of the chain's clock serves both: the refunded Hand ends
  // before every later fixture is raised ("newer by the same asker"), the expired one stays open.
  const SHORT = 60;
  const refunded = want("refunded") ? await raise("refunded", { mode: "unlisted", reward: USD(25), expirySeconds: SHORT }) : undefined;
  const expired = want("expired") ? await raise("expired", { mode: "unlisted", reward: USD(15), expirySeconds: SHORT }) : undefined;
  const lastShort = Math.max(refunded?.view.expiry ?? 0, expired?.view.expiry ?? 0);
  if (lastShort > 0) await world.jumpTo(lastShort);
  if (refunded) {
    const { receipt, rows } = await world.refund(refunded.handId);
    out.refunded = { ...handJson(refunded), address: refunded.address, endedBlock: receipt.blockNumber, refundTx: receipt.transactionHash, receipt: rowsJson(rows) };
  }

  if (want("thanked")) {
    const raised = await raise("thanked", { mode: "unlisted", reward: USD(40) });
    const passed = await world.pass(raised.address, { payee: A, keepBps: 500 });
    const given = await world.giveAs(passed.address, ROLE.giver);
    const thanked = await world.thank(given.address);
    out.thanked = {
      ...handJson(raised),
      address: raised.address,
      passedAddress: passed.address,
      giveAddress: given.address,
      giveHash: given.giveHash,
      thankTx: thanked.receipt.transactionHash,
      endedBlock: thanked.receipt.blockNumber,
      receipt: rowsJson(thanked.rows),
    };
  }

  for (const mode of ["unlisted", "dark", "public"] as const) {
    if (!want(mode)) continue;
    const raised = await raise(mode, { mode, reward: USD(mode === "public" ? 10 : 50) });
    out[mode] = { ...handJson(raised), address: raised.address, shakes: 0 };
  }

  if (want("twoPasses")) {
    const raised = await raise("twoPasses", { mode: "unlisted", reward: USD(60) });
    const first = await world.pass(raised.address, { payee: A, keepBps: 500 });
    const second = await world.pass(first.address, { keepBps: 0 });
    out.twoPasses = {
      ...handJson(raised),
      firstAddress: raised.address,
      address: second.address,
      shakes: 2,
      passes: [
        { payee: A, keptBps: 500 },
        { payee: null, keptBps: 0 },
      ],
      claimBps: second.opened.end.claimBps,
    };
  }

  if (want("lost")) {
    const raised = await raise("lost", { mode: "dark", reward: USD(20), withoutDescription: true });
    out.lost = { ...handJson(raised), address: raised.address, description: "lost" };
  }

  if (want("give")) {
    const raised = await raise("give", { mode: "unlisted", reward: USD(30) });
    const passed = await world.pass(raised.address, { payee: A, keepBps: 500 });
    const given = await world.giveAs(passed.address, ROLE.giver);
    out.give = {
      ...handJson(raised),
      address: passed.address,
      firstAddress: raised.address,
      giveAddress: given.address,
      giver: world.address(ROLE.giver),
      giveHash: given.giveHash,
      claimBps: given.signedGive.give.claimBps,
    };
  }

  if (want("resigned")) {
    // Route one: A keeps 5% and passes to B, B keeps 5% and passes to the giver, who answers.
    // Route two: A (who still holds the first link) signs straight to the giver's key, leaving B
    // out; the giver signs again with the same key. Core takes both; judgeGive calls it re-signed.
    const raised = await raise("resigned", { mode: "unlisted", reward: USD(80) });
    const toB = await world.pass(raised.address, { payee: A, keepBps: 500 });
    const toGiver = await world.pass(toB.address, { payee: B, keepBps: 500 });
    const first = await world.giveAs(toGiver.address, ROLE.giver);
    const rootOpened = await world.open(raised.address);
    const cut: Shake = {
      nextKey: privateKeyToAddress(keyOfSeed(toGiver.seed)),
      payee: A,
      claimBps: 10_000,
      nextClaimBps: 9_500,
      dataHash: zeroHash,
    };
    const cutSig = await signShake(rootOpened.linkKey!, rootOpened.domain, rootOpened.hand, cut);
    const carry = carryFor(rootOpened, rootOpened.seen.shape);
    const cutLink = await encodeLive(
      { domain: rootOpened.domain, hand: rootOpened.hand, signedShakes: [{ shake: cut, keySig: cutSig }], seed: toGiver.seed, attachments: carry.attachments },
      { ...world.options, outside: carry.outside && packAttachments(carry.outside) },
    );
    const cutAddress = toAddress({ site: world.site, link: cutLink, shape: rootOpened.seen.shape, outside: carry.outside }, world.options);
    const second = await world.giveAs(cutAddress, ROLE.giver);
    const judged = judgeGive(
      [seenGiveOf(first.hand, first.signedShakes, first.signedGive)],
      seenGiveOf(second.hand, second.signedShakes, second.signedGive),
    );
    check(judged.verdict === "resigned", `the re-signed pair was judged ${judged.verdict}`);
    out.resigned = {
      ...handJson(raised),
      address: raised.address,
      firstGiveAddress: first.address,
      secondGiveAddress: second.address,
      verdict: judged.verdict,
      dropped: judged.dropped.map((holder) => ({ position: holder.position, key: holder.key, payee: holder.payee ?? null })),
    };
  }

  if (want("undeployed")) {
    const raised = await raise("undeployed", { mode: "unlisted", reward: USD(35) });
    // One account per Hand: a thank deploys it, and the next run must find a fresh one.
    const salt = raised.handId;
    const given = await world.giveUndeployed(raised.address, ROLE.undeployedOwner, salt);
    let bare = "accepted";
    try {
      await checkGiveOnChain(world.client, world.core, raised.handId, given.signedShakes, given.signedGive);
    } catch (error) {
      bare = refusalName(error) ?? (error as Error).message;
    }
    check(bare !== "accepted", "Core accepted a 6492 wrapper with no setup");
    out.undeployed = {
      ...handJson(raised),
      address: raised.address,
      giveAddress: given.address,
      account: given.account,
      owner: world.address(ROLE.undeployedOwner),
      salt,
      setup: given.setup,
      coreBare: bare,
      coreWithSetup: "accepted",
    };
  }

  if (want("noReward")) {
    const raised = await raise("noReward", { mode: "unlisted", reward: 0n });
    const given = await world.giveAs(raised.address, ROLE.giver);
    out.noReward = { ...handJson(raised), address: raised.address, giveAddress: given.address, giveHash: given.giveHash };
  }

  if (expired) {
    out.expired = { ...handJson(expired), address: expired.address };
  }

  if (want("blocked")) {
    const token = world.token("blacklist");
    const holder = world.address(ROLE.blockedPayee);
    const raised = await raise("blocked", { mode: "unlisted", token: "blacklist", reward: USD(50) });
    const passed = await world.pass(raised.address, { payee: holder, keepBps: 1_000 });
    const given = await world.giveAs(passed.address, ROLE.giver);
    await world.send(ROLE.anyone, world.blockCall(token.address, holder, true));
    const thanked = await world.thank(given.address);
    const waiting = thanked.rows.rows.find((row) => row.eventName === "Pending");
    check(waiting && waiting.payee && isAddressEqual(waiting.payee, holder), "no Pending for the blocked payee");
    const unblock = world.blockCall(token.address, holder, false);
    const withdraw = withdrawCall(world.core, token.address, holder, holder);
    out.blocked = {
      ...handJson(raised),
      address: raised.address,
      giveAddress: given.address,
      thankTx: thanked.receipt.transactionHash,
      endedBlock: thanked.receipt.blockNumber,
      receipt: rowsJson(thanked.rows),
      pending: { token: token.address, payee: holder, amount: waiting.amount },
      unblock: { ...unblock, cast: world.castFor(unblock, ROLE.anyone) },
      withdraw: { ...withdraw, cast: world.castFor(withdraw, ROLE.anyone) },
    };
  }

  // Every state is read from the chain at the end, by its clock.
  const end = await world.now();
  for (const [name, fixture] of Object.entries(out)) {
    const { stateAt } = await readHand(world.client, world.core, fixture!.handId as bigint);
    fixture!.state = stateAt(end.timestamp);
    out[name as FixtureName] = fixture;
  }
  await selfCheck(world, out);

  return {
    chainId: world.stand.chainId,
    core: world.core,
    rpc: world.stand.rpc,
    relay: world.stand.relay,
    site: world.site,
    book: TEST_BOOK,
    raiser: { account: ROLE.raiser, address: world.address(ROLE.raiser) },
    accounts: {
      raiser: world.address(ROLE.raiser),
      holderA: A,
      holderB: B,
      giver: world.address(ROLE.giver),
      undeployedOwner: world.address(ROLE.undeployedOwner),
      blockedPayee: world.address(ROLE.blockedPayee),
      anyone: world.address(ROLE.anyone),
    },
    fixtures: out,
    now: { block: end.number, timestamp: end.timestamp },
    blocks: { from: start.number, to: end.number },
  };
}

const EXPECTED_STATE: Record<FixtureName, HandState> = {
  refunded: "refunded",
  thanked: "thanked",
  unlisted: "open",
  dark: "open",
  public: "open",
  twoPasses: "open",
  lost: "open",
  give: "open",
  resigned: "open",
  undeployed: "open",
  noReward: "open",
  expired: "expired",
  blocked: "thanked",
};

/** Every address of the run opens through the SDK and says what it should, before anything is printed. */
async function selfCheck(world: World, fixtures: SeedRun["fixtures"]): Promise<void> {
  for (const [name, fixture] of Object.entries(fixtures)) {
    check(fixture!.state === EXPECTED_STATE[name as FixtureName], `${name}: state ${String(fixture!.state)}, expected ${EXPECTED_STATE[name as FixtureName]}`);
    for (const [field, value] of Object.entries(fixture!)) {
      if (!/address$/i.test(field) || typeof value !== "string") continue;
      const opened = await world.open(value);
      const description = readDescription(opened).status;
      const expected = name === "lost" ? "lost" : "attached";
      check(description === expected, `${name}.${field}: description ${description}, expected ${expected}`);
      check(opened.hand.handId === fixture!.handId, `${name}.${field}: opens Hand ${opened.hand.handId}`);
    }
  }
}

/* ------------------------------------------------------------------- main */

function parseOnly(argv: string[]): FixtureName[] {
  const text = flagValue(argv, "--only");
  if (text === undefined) return [...FIXTURE_NAMES];
  const names = text.split(",").map((name) => name.trim()).filter(Boolean);
  for (const name of names) {
    if (!(FIXTURE_NAMES as readonly string[]).includes(name)) throw new Error(`no fixture named ${name}; the names are ${FIXTURE_NAMES.join(", ")}`);
  }
  return names as FixtureName[];
}

function summary(run: SeedRun): string {
  const lines = [`fixtures on chain ${run.chainId}, Core ${run.core}, book ${run.book}, blocks ${run.blocks.from}–${run.blocks.to}`];
  for (const [name, fixture] of Object.entries(run.fixtures)) {
    lines.push(`${name.padEnd(11)} hand ${String(fixture!.handId).padStart(4)}  n ${String(fixture!.n).padStart(4)}  ${String(fixture!.state).padEnd(8)}  ${fixture!.address}`);
  }
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const stand = standFrom(argv);
  const only = parseOnly(argv);
  const world = new World(stand, flagValue(argv, "--site"));
  const run = await withChainLock(stand.rpc, () => seed(world, only));
  console.log(argv.includes("--json") ? toJson(run) : summary(run));
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`seed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
