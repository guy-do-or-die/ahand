#!/usr/bin/env bun
/**
 * aHand from a clone: no site, no published package, no server. Run from the repository:
 *
 *   bun tools/ahand.ts <command> [arguments] [options]      (bun tools/ahand.ts help lists them)
 *
 * It uses the SDK, viem and the ABIs, and it reads time from the chain's latest block, never from
 * this machine's clock. It never prints a secret unless a command's own explicit option asks for
 * it: a live link's seed shows only as "secret: present (16 bytes)". `pass` prints the new link
 * (its output is the link itself), once, on standard output; `recover` prints a rebuilt link only
 * with --print-link. Everything the site proves, `verify` proves from here (D-51).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { AHandCoreAbi, ForwarderAbi } from "@ahand/abi";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  isErc6492Signature,
  parseAbi,
  parseErc6492Signature,
  size,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";

import { openAddress, seenIn, toAddress, type AddressShape, type SeenAddress } from "../packages/sdk/src/address.ts";
import { passesLeft, thankCalldata, worstThankGas } from "../packages/sdk/src/gas.ts";
import { digest, domainSeparator, giveHash } from "../packages/sdk/src/hash.ts";
import {
  LinkError,
  SEED_BYTES,
  fromText,
  openLink,
  passOn,
  peekLink,
  toDigits,
  toText,
  type LinkHead,
  type LinkOptions,
  type MatchedData,
  type OpenedLink,
} from "../packages/sdk/src/link.ts";
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION, type Hand, type SignedGive } from "../packages/sdk/src/types.ts";
import { isKeySignature } from "../packages/sdk/src/verify.ts";
import { textValue } from "../packages/sdk/src/data.ts";
import { Fail, addressFlag, amountOf, clean, connect, group, parseArgs, pct, span, trustedCore, utc, type Args, type Chain, type TrustedCore } from "./lib/cli.ts";
import { findCommand } from "./lib/find.ts";
import { recoverCommand } from "./lib/recover.ts";
import { verifyCommand } from "./lib/verify.ts";
import {
  CORE_SALT,
  CREATE2_FACTORY,
  coreAddressOf,
  coreBuild,
  deploymentPath,
  manifestOf,
  readDeployment,
  reproduceCommand,
} from "./manifest.ts";

export { Fail };

/** Every command with one example. `help` prints it; a test checks that each command is named. */
export const USAGE = `aHand from a clone: bun tools/ahand.ts <command> ... (no site, no published package)

  inspect <address-or-link> [--rpc URL] [--core 0x...]
      The link's head, each pass (payee, share, key), where it ends, its sizes, and with an RPC
      the Hand's state by the latest block's time. Never prints the link's secret.
      e.g. bun tools/ahand.ts inspect 'https://site/31337/7#AQ...' --rpc http://127.0.0.1:8545

  thank-calldata <give-address> --rpc URL [--core 0x...] [--forwarder 0x...] [--out FILE]
      Asks Core's checkGive and prints the calldata for contracts/exit/ahand.sh thank, with the
      worst gas. For a giver's account that is not deployed yet (ERC-6492): first a cast send line
      that sets it up through the forwarder, then the thank calldata with the inner signature.
      e.g. bun tools/ahand.ts thank-calldata 'https://site/31337/7#BQ...' --rpc $RPC --out thank.hex

  pass <live-address> --rpc URL [--share-bps N --payee 0x...] [--core 0x...]
      Passes a live link on without any site and prints the new address (and only it) on stdout.
      e.g. bun tools/ahand.ts pass 'https://site/31337/7#AQ...' --rpc $RPC --share-bps 1000 --payee 0xYou

  manifest <chainId> [--deployment FILE] [--app DIR] [--out FILE]
      Writes contracts/deployments/<chainId>.manifest.json: the deployment, the commit, the dirty
      flag, the compiler settings, the SDK version, and the hash of a built app folder.
      e.g. bun tools/ahand.ts manifest 8453 --app apps/hand/dist

  core-check --rpc URL [--deployment FILE]
      Recomputes the initcode hash from contracts/out, derives the CREATE2 address, compares it
      with the deployment, and checks the code and the EIP-712 domain on chain.
      e.g. bun tools/ahand.ts core-check --rpc $RPC

  verify --rpc URL [--core 0x...] <handId> [--give ADDRESS] [--between] [--details] [--save FILE]
  verify --bundle FILE [--details]
      The Hand's passport, check by check, the same checks and ids as the site's proof page: one
      line each with ok, FAIL or "not checkable" and its sentence. Exit 0 only when none failed.
      With --bundle, the same from a saved proof with no network. --give adds a give address so
      the description and signatures are checked from it; --save writes the bundle; --between
      reads the blocks between the raise and the closing however many requests that takes.
      e.g. bun tools/ahand.ts verify --rpc $RPC --core $CORE 7
           bun tools/ahand.ts verify --bundle hand-7.proof.json

  find --rpc URL [--core 0x...] --raiser 0x... [--days N] [--chunk BLOCKS]
      Every Hand a raiser opened in the last N days (default 1, by the chain's time): Raised logs
      filtered by the raiser, in windows of 2 000 blocks (a day of Base is about 216). Prints the
      number of requests before the first, shows progress, and Ctrl-C stops it and prints what was
      found. Each Hand with its number, state and reward. An indexer would replace this search.
      e.g. bun tools/ahand.ts find --rpc $RPC --raiser 0xRaiser --days 7

  recover --book HEX [--max N] --rpc URL [--core 0x...] <handId> [--print-link [--site URL]]
      Rebuilds a Hand's root key from the raiser's keys signature, read from standard input (never
      from an argument, so it stays out of shell history), and the device's book (its 16-character
      code). Prints whether a number n was found and the root key's first characters; only with
      --print-link the live link itself, under a warning.
      e.g. pbpaste | bun tools/ahand.ts recover --book 0x1f2e3d4c5b6a7980 --rpc $RPC 7

  help
      This list.

  --rpc defaults to $RPC and --core to $CORE, as in contracts/exit/ahand.sh. Without --core the
  trusted Core is the one this clone builds: create2(factory, salt, initcode of contracts/out).`;

/* ------------------------------------------------------------------ basics */

function castPath(): string {
  const path = join(process.env.FOUNDRY_BIN || join(homedir(), ".foundry/bin"), "cast");
  return existsSync(path) ? path : "cast";
}

const EXIT_SCRIPT = "contracts/exit/ahand.sh";

/* ------------------------------------------------------------ Core's words */

/** Core's errors in plain words: the same sentences as contracts/exit/ahand.sh. */
const REFUSALS: Record<string, string> = {
  ExpiryTooEarly: "The end date must be in the future and, when extending, later than the current one.",
  ExpiryTooLate: "The end date can be at most 180 days from now.",
  ZeroRootKey: "No link key was given.",
  MinClaimTooHigh: "The giver's minimum share is above 100%.",
  NotOpen: "This Hand doesn't exist or is already closed (thanked or refunded).",
  NotRaised: "No Hand has this number on this network.",
  NotRaiser: "Only the person who raised this Hand can do that.",
  Expired: "Time is up. This Hand can only be refunded now.",
  GiverIsRaiser: "You can't thank yourself: the giver signed with the raiser's address.",
  ZeroPayee: "The Give says nowhere to send the money.",
  InvalidClaim: "Shares don't add up at one pass of the route.",
  AnonymousMargin: "A pass keeps a share but names no one to pay it to.",
  InvalidKeySig: "A link key's signature is unreadable or from another key.",
  InvalidRouteHash: "The Give was signed for a different route.",
  BelowMinClaim: "The route leaves the giver less than the raiser's guaranteed minimum.",
  InvalidGiverSig: "The giver's signature doesn't check out: wrong key, or the smart wallet refused or isn't deployed.",
  NotExpired: "It's too early to refund. The Hand is still running.",
  NotPayee: "Only the payee can send their waiting money somewhere else.",
  ZeroDestination: "Can't send to the zero address.",
  NothingPending: "Nothing is waiting for this address in this token.",
  InexactTransfer: "The token moved a different amount than asked.",
  Reentered: "A token or wallet tried to call back in mid-operation. Refused.",
};

function refusalSentence(name: string, args?: readonly unknown[]): string {
  const at = args && args.length > 0 ? ` (at pass ${Number(args[0]) + 1})` : "";
  return `Core refused: ${name}${at}. ${REFUSALS[name] ?? "Core's own error."}`;
}

/** Core's refusal in an error from viem, or in raw revert data; undefined when it is something else. */
function refusalOf(error: unknown): string | undefined {
  if (typeof error === "string") {
    try {
      const decoded = decodeErrorResult({ abi: AHandCoreAbi, data: error as Hex });
      return refusalSentence(decoded.errorName, decoded.args as readonly unknown[] | undefined);
    } catch {
      return undefined;
    }
  }
  if (error instanceof BaseError) {
    const reverted = error.walk((inner) => inner instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted?.data?.errorName) return refusalSentence(reverted.data.errorName, reverted.data.args as readonly unknown[] | undefined);
    if (reverted?.raw) return refusalOf(reverted.raw);
  }
  return undefined;
}

/* ------------------------------------------------------------------- chain */

/** The latest block: the only clock this tool reads. */
async function chainNow(chain: Chain): Promise<{ number: bigint; timestamp: number }> {
  const block = await chain.client.getBlock({ blockTag: "latest" });
  return { number: block.number, timestamp: Number(block.timestamp) };
}

/** Code at the address, and an EIP-712 domain that says aHand / core, this chain and this address. */
async function checkCoreAnswers(chain: Chain, core: Address): Promise<void> {
  const code = await chain.client.getCode({ address: core });
  if (!code || code === "0x") throw new Fail(`there is no contract at ${core} on chain ${chain.chainId}`);
  let domain: readonly unknown[];
  try {
    domain = (await chain.client.readContract({ address: core, abi: AHandCoreAbi, functionName: "eip712Domain" })) as readonly unknown[];
  } catch {
    throw new Fail(`${core} does not answer as an aHand Core (no eip712Domain)`);
  }
  const [, name, version, chainId, verifyingContract] = domain as [Hex, string, string, bigint, Address];
  if (name !== EIP712_DOMAIN_NAME || version !== EIP712_DOMAIN_VERSION) {
    throw new Fail(`${core} is not an aHand Core: its EIP-712 domain is ${clean(name)} / ${clean(version)}, not aHand / core`);
  }
  if (Number(chainId) !== chain.chainId || !isAddressEqual(verifyingContract, core)) {
    throw new Fail(`${core} signs for chain ${chainId} and contract ${verifyingContract}, not for itself on chain ${chain.chainId}`);
  }
}

interface HandView {
  hand: Hand;
  expiry: number;
  openedAt: number;
  closedAt: number;
  reward: bigint;
  giveHash: Hex;
}

const HAND_FIELDS = ["raiser", "expiry", "openedAt", "closedAt", "token", "payoutGasK", "minClaimBps", "reward", "rootKey", "dataHash"] as const;

async function readHand(chain: Chain, core: Address, handId: bigint): Promise<HandView> {
  const raw = (await chain.client.readContract({ address: core, abi: AHandCoreAbi, functionName: "hands", args: [handId] })) as readonly unknown[];
  const h = Object.fromEntries(HAND_FIELDS.map((name, index) => [name, raw[index]])) as Record<(typeof HAND_FIELDS)[number], never>;
  const openedAt = Number(h.openedAt);
  if (openedAt === 0) throw new Fail(`Hand ${handId} is not raised on Core ${core} (chain ${chain.chainId})`);
  const closedAt = Number(h.closedAt);
  let giveHash: Hex = zeroHash;
  if (closedAt !== 0) {
    const thanks = (await chain.client.readContract({ address: core, abi: AHandCoreAbi, functionName: "thanks", args: [handId] })) as readonly Hex[];
    giveHash = thanks[0]!;
  }
  return {
    hand: {
      handId,
      raiser: h.raiser,
      token: h.token,
      rootKey: h.rootKey,
      payoutGasK: Number(h.payoutGasK),
      minClaimBps: Number(h.minClaimBps),
      dataHash: h.dataHash,
    },
    expiry: Number(h.expiry),
    openedAt,
    closedAt,
    reward: h.reward as bigint,
    giveHash,
  };
}

type HandState = "open" | "expired" | "thanked" | "refunded";

/** The Hand's state at `now`, a block's timestamp. "expired": still open on chain, time is up (Core refuses from the expiry's second on). */
function stateAt(view: HandView, now: number): HandState {
  if (view.closedAt !== 0) return view.giveHash === zeroHash ? "refunded" : "thanked";
  return now >= view.expiry ? "expired" : "open";
}

function stateLine(view: HandView, now: number): string {
  switch (stateAt(view, now)) {
    case "open":
      return `open, ${span(view.expiry - now)} left`;
    case "expired":
      return `time's up since ${utc(view.expiry)}; it can only be refunded (bash ${EXIT_SCRIPT} refund ${view.hand.handId})`;
    case "thanked":
      return `closed: thanked at ${utc(view.closedAt)}`;
    case "refunded":
      return `closed: refunded at ${utc(view.closedAt)}`;
  }
}

/* -------------------------------------------------------------------- links */

interface Input {
  /** The whole address, when one was given; undefined for a link given as bare text. */
  address?: string;
  seen?: SeenAddress;
  /** The link's bytes. */
  bytes: Uint8Array;
}

/** Reads what was given: a web address with the link after `#`, or the link alone (base64url or digits). */
function readInput(text: string | undefined, options: LinkOptions): Input {
  if (!text) throw new Fail("give an address or a link", 2);
  const hash = text.indexOf("#");
  try {
    if (hash < 0) return { bytes: fromText(text.trim()) };
    return { address: text, seen: seenIn(text.slice(0, hash), options), bytes: fromText(text.slice(hash + 1)) };
  } catch (error) {
    throw linkFailure(error);
  }
}

function linkFailure(error: unknown): Error {
  if (error instanceof Fail) return error;
  if (error instanceof LinkError) {
    const why: Record<string, string> = {
      malformed: "this is not an aHand link",
      unsupported: "this link uses a format this tool does not read",
      "non-canonical": "this link is written in a way the format does not allow",
      "too-long": "this link is longer than any route one transaction can thank",
      "another-hand": "the address and the link name different Hands",
      "not-this-hand": "this link is not for this Hand",
      invalid: "Core would refuse this link",
      "unmatched-data": "this link carries words that no hash stands for",
    };
    return new Fail(`${why[error.code] ?? "this link does not open"} (${clean(error.message)})`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Opens a link against the chain: only on the RPC's chain and only on the trusted Core. */
async function openOn(chain: Chain, trusted: TrustedCore, input: Input): Promise<{ opened: OpenedLink; view: HandView }> {
  let view: HandView | undefined;
  const getHand = async (head: LinkHead): Promise<Hand> => {
    if (head.chainId !== chain.chainId) throw new Fail(`the link is for chain ${head.chainId}, and the RPC serves chain ${chain.chainId}`);
    if (!isAddressEqual(head.core, trusted.core)) {
      throw new Fail(`the link names Core ${head.core}, which this tool does not trust (trusted: ${trusted.core}); give --core ${head.core} to read it anyway`);
    }
    await checkCoreAnswers(chain, head.core);
    view = await readHand(chain, head.core, head.handId);
    return view.hand;
  };
  const options: LinkOptions = { canonicalCore: trusted.core };
  try {
    const opened = input.address !== undefined ? await openAddress(input.address, getHand, options) : await openLink(input.bytes, getHand, options);
    return { opened, view: view! };
  } catch (error) {
    throw linkFailure(error);
  }
}

function kindLine(kind: LinkHead["kind"]): string {
  return kind === "live" ? "live (carries the secret of its last key)" : kind === "give" ? "give (a Give ends it; no secret)" : "addressed (ends at an address; no secret)";
}

function attachedLine(data: MatchedData): string {
  const lists = data.statements.length;
  const texts = data.texts.length;
  return lists + texts === 0 ? "nothing" : `${lists} list${lists === 1 ? "" : "s"}, ${texts} text${texts === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ inspect */

async function inspect(args: Args): Promise<void> {
  const chain = await connect(args, false);
  const given = addressFlag(args, "--core", "CORE");
  const trusted = chain ? trustedCore(args, chain.chainId) : given ? { core: given, source: "given with --core" } : undefined;
  let canonical = trusted?.core;
  if (!canonical) {
    try {
      canonical = coreAddressOf(coreBuild().initcodeHash);
    } catch {
      canonical = undefined;
    }
  }
  const options: LinkOptions = { canonicalCore: canonical };
  const input = readInput(args.positional[0], options);
  let head: LinkHead;
  try {
    head = peekLink(input.bytes, options);
  } catch (error) {
    throw linkFailure(error);
  }

  const out: string[] = [];
  const row = (label: string, value: string) => out.push(`${`${label}:`.padEnd(13)}${value}`);
  row("link", `version ${head.version} · ${kindLine(head.kind)}`);
  row("hand", `${head.handId} on chain ${head.chainId}`);
  row("core", `${head.core}${canonical && isAddressEqual(head.core, canonical) ? " (named by leaving it out: the canonical Core)" : " (named in the link)"}`);
  if (input.seen) {
    const shape: Record<AddressShape, string> = {
      bare: "bare: a site sees nothing of it",
      numbered: "numbered: a site sees which Hand it is",
      faced: "faced: a site sees which Hand and the public part (d)",
    };
    row("address", shape[input.seen.shape]);
  }
  const sizes = [
    `link ${input.bytes.length} bytes`,
    `${toText(input.bytes).length} characters as text`,
    `${toDigits(input.bytes).length} digits for a QR code`,
  ];
  if (input.address) sizes.push(`address ${input.address.length} characters`);
  row("size", sizes.join(" · "));
  if (head.kind === "live") row("secret", `present (${SEED_BYTES} bytes)`);

  if (!chain || !trusted) {
    row("route", `${head.shakes} pass${head.shakes === 1 ? "" : "es"}; who signed each, and where it ends, is proven against the Hand's terms on chain: add --rpc URL`);
    console.log(out.join("\n"));
    return;
  }

  const { opened, view } = await openOn(chain, trusted, input);
  const { hand } = opened;
  const now = await chainNow(chain);
  row("route", `${opened.signedShakes.length} pass${opened.signedShakes.length === 1 ? "" : "es"} from the root key ${hand.rootKey}`);
  let from = hand.rootKey;
  opened.signedShakes.forEach(({ shake }, index) => {
    const share = shake.claimBps - shake.nextClaimBps;
    const payee = isAddressEqual(shake.payee, zeroAddress) ? "no one (keeps nothing)" : shake.payee;
    out.push(`  ${String(index + 1).padStart(2)}  key ${from} → ${shake.nextKey}`);
    out.push(`      payee ${payee} · share ${pct(share)} of the reward · ${pct(shake.claimBps)} → ${pct(shake.nextClaimBps)}${shake.dataHash !== zeroHash ? ` · states ${shake.dataHash}` : ""}`);
    from = shake.nextKey;
  });
  if (opened.signedGive) {
    const { give, giverSig } = opened.signedGive;
    row("ends with", `a Give by ${give.signer}${isAddressEqual(give.payee, give.signer) ? "" : `, paid to ${give.payee}`}`);
    row("giver gets", `${pct(give.claimBps)} of the reward`);
    row("signature", signatureKind(giverSig));
    row("give data", give.dataHash === zeroHash ? `${give.dataHash} (none: the words travel by message)` : give.dataHash);
  } else if (opened.seed) {
    row("ends at", `${opened.end.lastKey}, the key of this link's secret: whoever holds the link signs for it`);
    row("giver gets", `${pct(opened.end.claimBps)} of the reward, if no one else keeps a share`);
  } else {
    row("ends at", `${opened.end.lastKey}, an address that signs for itself`);
    row("giver gets", `${pct(opened.end.claimBps)} of the reward`);
  }
  row("passes left", `${passesLeft(hand, opened.signedShakes)} more, by the worst gas of one thank`);
  row("attached", `in the link: ${attachedLine(opened.inside)} · outside it: ${attachedLine(opened.outside)}`);
  for (const line of describe(opened.ofHand)) out.push(`  ${line}`);

  out.push("");
  row("on chain", `by block ${now.number}, at ${utc(now.timestamp)} (the chain's time)`);
  row("state", stateLine(view, now.timestamp));
  row("raiser", hand.raiser);
  row("reward", await amountOf(chain, hand.token, view.reward));
  row("token", hand.token);
  row("opened", utc(view.openedAt));
  row("expiry", `${utc(view.expiry)} (${view.expiry})`);
  row("minimum", `the giver keeps at least ${pct(hand.minClaimBps)}; each payout may use ${hand.payoutGasK}k gas`);
  row("data hash", hand.dataHash);
  if (view.giveHash !== zeroHash) row("give hash", view.giveHash);
  row("trusted", `${trusted.core}: ${trusted.source}`);
  console.log(out.join("\n"));
}

/** The Hand's own words, each shown only after it matched its hash; texts made safe for a terminal. */
function describe(ofHand: MatchedData): string[] {
  const byHash = new Map(ofHand.texts.map((text) => [textValue(text).toLowerCase(), text]));
  const lines: string[] = [];
  for (const list of ofHand.statements) {
    for (const { name, value } of list) {
      const text = byHash.get(value.toLowerCase());
      lines.push(`${clean(name, 32).padEnd(10)}${text !== undefined ? `"${clean(text).replaceAll('"', '\\"')}"` : value}`);
    }
  }
  return lines.length ? ["the Hand's words, each checked against its hash:", ...lines.map((line) => `  ${line}`)] : [];
}

function signatureKind(signature: Hex): string {
  if (isKeySignature(signature)) return "a key's (65 bytes)";
  if (isErc6492Signature(signature)) {
    const { address } = parseErc6492Signature(signature);
    return `wrapped for an account not deployed yet (ERC-6492, ${size(signature)} bytes, factory ${address})`;
  }
  return `an account's own (ERC-1271, ${size(signature)} bytes)`;
}

/* ----------------------------------------------------------- thank-calldata */

const CHECK_GIVE = "checkGive" as const;

async function thankCalldataCommand(args: Args): Promise<void> {
  const chain = (await connect(args, true))!;
  const trusted = trustedCore(args, chain.chainId);
  const input = readInput(args.positional[0], { canonicalCore: trusted.core });
  const { opened, view } = await openOn(chain, trusted, input);
  if (!opened.signedGive) {
    throw new Fail(`this is a ${opened.head.kind} link, not a give link: only a Give can be thanked`);
  }
  const { hand, signedShakes } = opened;
  const now = await chainNow(chain);
  const state = stateAt(view, now.timestamp);
  if (state !== "open") throw new Fail(`Hand ${hand.handId} cannot be thanked: ${stateLine(view, now.timestamp)}`);

  const { give, keySig, giverSig } = opened.signedGive;
  const wrapped = unwrap6492(giverSig);
  const inner: SignedGive = { give, keySig, giverSig: wrapped ? wrapped.signature : giverSig };
  const signerCode = (await chain.client.getCode({ address: give.signer })) ?? "0x";
  const deployed = signerCode !== "0x";
  const needsSetup = wrapped !== undefined && !deployed;
  const checkArgs = [hand.handId, signedShakes, inner] as const;
  const signed = digest(domainSeparator(opened.domain), giveHash(hand, give));

  let coreGiveHash: Hex;
  let forwarder: Address | undefined;
  let setupData: Hex | undefined;
  let giverCodeGas = 0;
  if (needsSetup) {
    forwarder = addressFlag(args, "--forwarder") ?? forwarderOf(chain.chainId);
    if (!forwarder) {
      throw new Fail(
        "the giver's account is not deployed yet and no forwarder is known: give --forwarder 0x... (Multicall3's aggregate3, or the stand's Forwarder). " +
          "Without one, ask the giver to sign with a key and name the account as the payee (R-28's third way).",
      );
    }
    const forwarderCode = await chain.client.getCode({ address: forwarder });
    if (!forwarderCode || forwarderCode === "0x") throw new Fail(`there is no forwarder contract at ${forwarder} on chain ${chain.chainId}`);
    const setup = { target: wrapped!.address, allowFailure: false, callData: wrapped!.data };
    setupData = encodeFunctionData({ abi: ForwarderAbi, functionName: "aggregate3", args: [[setup]] });
    const check = { target: opened.head.core, allowFailure: true, callData: encodeFunctionData({ abi: AHandCoreAbi, functionName: CHECK_GIVE, args: checkArgs }) };
    // One eth_call: the account's setup through the forwarder, then Core's checkGive with the inner signature.
    let results: readonly { success: boolean; returnData: Hex }[];
    try {
      const { data } = await chain.client.call({ to: forwarder, data: encodeFunctionData({ abi: ForwarderAbi, functionName: "aggregate3", args: [[setup, check]] }) });
      results = decodeFunctionResult({ abi: ForwarderAbi, functionName: "aggregate3", data: data ?? "0x" }) as typeof results;
    } catch {
      throw new Fail(`the setup call of the giver's account fails (factory ${wrapped!.address}): the account cannot be set up this way`);
    }
    const answer = results[1]!;
    if (!answer.success) throw new Fail(refusalOf(answer.returnData) ?? "Core refused this Give with an error this tool does not know");
    coreGiveHash = decodeFunctionResult({ abi: AHandCoreAbi, functionName: CHECK_GIVE, data: answer.returnData }) as Hex;
    // What the account's own check costs: the setup with the check, less the setup alone.
    const isValid = encodeFunctionData({ abi: ERC1271, functionName: "isValidSignature", args: [signed, inner.giverSig] });
    const both = encodeFunctionData({ abi: ForwarderAbi, functionName: "aggregate3", args: [[setup, { target: give.signer, allowFailure: false, callData: isValid }]] });
    const [withCheck, alone] = await Promise.all([chain.client.estimateGas({ to: forwarder, data: both }), chain.client.estimateGas({ to: forwarder, data: setupData })]);
    giverCodeGas = Number(withCheck - alone);
  } else {
    try {
      coreGiveHash = (await chain.client.readContract({ address: opened.head.core, abi: AHandCoreAbi, functionName: CHECK_GIVE, args: checkArgs })) as Hex;
    } catch (error) {
      throw new Fail(refusalOf(error) ?? `Core's checkGive did not answer: ${clean(error instanceof Error ? error.message.split("\n")[0]! : String(error))}`);
    }
    const delegated = signerCode.toLowerCase().startsWith("0xef0100") && size(signerCode) === 23;
    if (deployed && !(delegated && isKeySignature(inner.giverSig))) {
      const isValid = encodeFunctionData({ abi: ERC1271, functionName: "isValidSignature", args: [signed, inner.giverSig] });
      giverCodeGas = Number(await chain.client.estimateGas({ to: give.signer, data: isValid })) - 21_000;
    }
  }

  const gas = worstThankGas(hand, signedShakes, inner, { giverCodeGas });
  if (!gas.fits) throw new Fail(`this thank does not fit one transaction: ${group(gas.gasLimit)} gas, ${gas.calldataBytes} bytes of calldata`);
  const calldata = thankCalldata(hand.handId, signedShakes, inner);
  const file = args.flags.get("--out");
  if (file) {
    mkdirSync(dirname(resolve(file)), { recursive: true });
    writeFileSync(resolve(file), `${calldata}\n`);
  }

  const out: string[] = [];
  const row = (label: string, value: string) => out.push(`${`${label}:`.padEnd(13)}${value}`);
  row("hand", `${hand.handId} on chain ${chain.chainId}, Core ${opened.head.core}`);
  row("state", stateLine(view, now.timestamp));
  row("reward", await amountOf(chain, hand.token, view.reward));
  row("route", `${signedShakes.length} pass${signedShakes.length === 1 ? "" : "es"}; the giver gets ${pct(give.claimBps)}`);
  for (const [index, { shake }] of signedShakes.entries()) {
    if (shake.nextClaimBps < shake.claimBps) out.push(`  ${String(index + 1).padStart(2)}  ${shake.payee} gets ${pct(shake.claimBps - shake.nextClaimBps)}`);
  }
  out.push(`  give  ${give.payee} gets ${pct(give.claimBps)}`);
  row("giver", `${give.signer}: ${signatureKind(giverSig)}${wrapped ? (deployed ? "; the account is deployed by now, so the inner signature is used" : "; its setup call comes first") : ""}`);
  row("core says", `checkGive accepts it${needsSetup ? " after the setup call, asked through the forwarder" : ""} (give hash ${coreGiveHash})`);
  row("worst gas", `${group(gas.gasLimit)} (every payee burns its ${hand.payoutGasK}k limit; send the thank with this limit)`);
  row("calldata", `${gas.calldataBytes} bytes${file ? `, written to ${file}` : ""}`);
  out.push("");
  const thankLine = `RPC=${chain.rpc} CORE=${opened.head.core} bash ${EXIT_SCRIPT} thank ${file ?? "<calldata below>"} -- --gas-limit ${gas.gasLimit} <the raiser's signing option, e.g. --ledger>`;
  if (needsSetup) {
    out.push("step 1 of 2: set up the giver's account through the forwarder. Anyone may send it; it runs as the forwarder, never in your name.");
    out.push(`setup ${castPath()} send ${forwarder} --data ${setupData} --rpc-url ${chain.rpc} <your signing option>`);
    out.push("");
    out.push(`step 2 of 2: the raiser ${hand.raiser} sends the thank (you may run this command again first: Core is then asked directly).`);
  } else {
    out.push(`the raiser ${hand.raiser} sends the thank:`);
  }
  out.push(`send  ${thankLine}`);
  out.push(`thank ${calldata}`);
  console.log(out.join("\n"));
}

/** An ERC-6492 wrapper read with viem's parser: the factory, its calldata and the inner signature. */
function unwrap6492(signature: Hex): { address: Address; data: Hex; signature: Hex } | undefined {
  if (!isErc6492Signature(signature)) return undefined;
  const { address, data, signature: inner } = parseErc6492Signature(signature);
  if (!address || !data) throw new Fail("the giver's signature is wrapped per ERC-6492 but names no factory call");
  return { address, data, signature: inner };
}

const ERC1271 = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);

function forwarderOf(chainId: number): Address | undefined {
  const file = deploymentPath(chainId);
  if (!existsSync(file)) return undefined;
  const forwarder = readDeployment(file).forwarder;
  return forwarder ? getAddress(forwarder) : undefined;
}

/* --------------------------------------------------------------------- pass */

/** The site an address was written on: what stands before the Hand's number, or before `/#`. */
function siteOf(address: string, shape: AddressShape): string {
  const before = address.slice(0, address.indexOf("#"));
  const path = before.includes("?") ? before.slice(0, before.indexOf("?")) : before;
  if (shape === "bare") return path.slice(0, -1);
  return path.replace(/\/[0-9]+\/(?:0x[0-9a-fA-F]{40}\/)?[0-9]+$/, "");
}

async function pass(args: Args): Promise<void> {
  const chain = (await connect(args, true))!;
  const trusted = trustedCore(args, chain.chainId);
  const options: LinkOptions = { canonicalCore: trusted.core };
  const input = readInput(args.positional[0], options);
  const { opened, view } = await openOn(chain, trusted, input);
  if (!opened.linkKey) throw new Fail(`this is a ${opened.head.kind} link: only a live link, which carries its secret, can be passed on`);
  const { hand } = opened;
  const now = await chainNow(chain);
  if (stateAt(view, now.timestamp) !== "open") throw new Fail(`Hand ${hand.handId} cannot be passed on: ${stateLine(view, now.timestamp)}`);

  const shareText = args.flags.get("--share-bps") ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(shareText)) throw new Fail(`--share-bps is a whole number of basis points (100 = 1%), not ${clean(shareText)}`, 2);
  const share = Number(shareText);
  const payee = addressFlag(args, "--payee") ?? zeroAddress;
  const claim = opened.end.claimBps;
  if (share > 0 && isAddressEqual(payee, zeroAddress)) throw new Fail("a share needs somewhere to land: give --payee 0x...", 2);
  if (args.flags.has("--payee") && isAddressEqual(payee, zeroAddress)) throw new Fail("the zero address cannot be paid: money sent there is lost", 2);
  if (isAddressEqual(payee, opened.head.core)) throw new Fail("that address is the contract itself; money sent there waits forever");
  if (claim - share < hand.minClaimBps) {
    throw new Fail(`a share of ${pct(share)} is too much: ${pct(claim)} reaches this link and the giver must keep at least ${pct(hand.minClaimBps)}, so at most ${pct(Math.max(0, claim - hand.minClaimBps))} can be kept`);
  }
  if (!isAddressEqual(payee, zeroAddress) && isAddressEqual(payee, hand.raiser)) console.error("note: this share lands at the raiser's own address.");
  if (!isAddressEqual(payee, zeroAddress) && isAddressEqual(payee, hand.token)) console.error("note: this share lands at the token's own address, where it may be lost.");

  const seen = input.seen;
  const passOptions: LinkOptions = { ...options, outside: seen?.data };
  let link: Uint8Array;
  try {
    ({ link } = await passOn(opened, { payee, nextClaimBps: claim - share }, passOptions));
  } catch (error) {
    throw linkFailure(error);
  }
  let written: string;
  if (input.address && seen) {
    const outside = seen.shape === "faced" ? { statements: opened.outside.statements, texts: opened.outside.texts } : undefined;
    try {
      written = toAddress({ site: siteOf(input.address, seen.shape), link, shape: seen.shape, outside }, options);
    } catch (error) {
      throw linkFailure(error);
    }
  } else {
    written = toText(link);
  }

  // Read the new link back, as a holder's browser will, and say what it says.
  const back = await openOn(chain, trusted, readInput(written, options));
  const last = back.opened.signedShakes.at(-1)!.shake;
  const landing = isAddressEqual(last.payee, zeroAddress) ? "keeps no share" : `pays ${last.payee} ${pct(last.claimBps - last.nextClaimBps)} if its route is thanked`;
  console.error(`checked here: the new link opens with ${back.opened.signedShakes.length} pass${back.opened.signedShakes.length === 1 ? "" : "es"}; your pass ${landing}; the giver gets ${pct(back.opened.end.claimBps)}.`);
  console.error("Whoever had the old link can still pass it another way. The new address follows on its own line; it holds the new secret.");
  console.log(written);
}

/* ----------------------------------------------------------------- manifest */

function manifestCommand(args: Args): void {
  const chainText = args.positional[0];
  if (!chainText || !/^[1-9][0-9]*$/.test(chainText)) throw new Fail("usage: manifest <chainId> [--deployment FILE] [--app DIR] [--out FILE]", 2);
  const chainId = Number(chainText);
  const file = args.flags.get("--deployment") ?? deploymentPath(chainId);
  let deployment;
  try {
    deployment = readDeployment(file);
  } catch (error) {
    throw new Fail((error as Error).message);
  }
  if (deployment.chainId !== chainId) throw new Fail(`${file} describes chain ${deployment.chainId}, not ${chainId}`);
  let manifest;
  try {
    manifest = manifestOf(deployment, { app: args.flags.get("--app") });
  } catch (error) {
    throw new Fail((error as Error).message);
  }
  const out = resolve(args.flags.get("--out") ?? join(dirname(resolve(file)), `${chainId}.manifest.json`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${out}`);
  console.log(`core        ${manifest.core} on chain ${chainId}`);
  console.log(`commit      ${manifest.commit ?? "unknown"}${manifest.dirty ? " (dirty: Core's inputs differed from it)" : ""} (from ${manifest.commitFrom ?? "nowhere"})`);
  console.log(`initcode    ${manifest.initcode.matches ? "this tree builds the deployed initcode" : `this tree builds ANOTHER initcode (${manifest.initcode.tree})`}`);
  console.log(`compiler    solc ${manifest.compiler.solc}, optimizer ${manifest.compiler.optimizer ? manifest.compiler.optimizerRuns : "off"}, evm ${manifest.compiler.evmVersion}`);
  console.log(`sdk         ${manifest.sdk.version}`);
  if (manifest.app) console.log(`app         ${manifest.app.hash} (${manifest.app.files} files)`);
}

/* --------------------------------------------------------------- core-check */

async function coreCheck(args: Args): Promise<void> {
  const chain = (await connect(args, true))!;
  const lines: string[] = [];
  const ok = (text: string) => lines.push(`ok    ${text}`);
  const failWith = (text: string): never => {
    console.log(lines.join("\n"));
    throw new Fail(text);
  };

  let build;
  try {
    build = coreBuild();
  } catch (error) {
    return failWith((error as Error).message);
  }
  if (!build.sourceMatches) failWith("contracts/out was not built from contracts/src/AHandCore.sol as it is now: rebuild it (cd contracts && forge build)");
  ok(`initcode hash ${build.initcodeHash} (${build.initcodeBytes} bytes, built from AHandCore.sol sha256 ${build.sourceSha256})`);
  const derived = coreAddressOf(build.initcodeHash);
  ok(`create2(${CREATE2_FACTORY}, keccak256("aHand.core/1") = ${CORE_SALT}, initcode) = ${derived}`);

  const named = args.flags.get("--deployment");
  const file = named ?? deploymentPath(chain.chainId);
  let core = derived;
  if (named !== undefined || existsSync(file)) {
    let deployment;
    try {
      deployment = readDeployment(file);
    } catch (error) {
      return failWith((error as Error).message);
    }
    if (deployment.chainId !== chain.chainId) failWith(`the deployment file describes chain ${deployment.chainId}, and the RPC serves chain ${chain.chainId}`);
    if (deployment.initcodeHash.toLowerCase() !== build.initcodeHash.toLowerCase()) {
      failWith(`the deployment names initcode ${deployment.initcodeHash}, and this tree builds ${build.initcodeHash}`);
    }
    const fileDerived = coreAddressOf(deployment.initcodeHash as Hex, getAddress(deployment.factory), deployment.salt as Hex);
    if (!isAddressEqual(fileDerived, getAddress(deployment.core))) {
      failWith(`the deployment names Core ${getAddress(deployment.core)}, but create2 of its own factory, salt and initcode is ${fileDerived}`);
    }
    if (!isAddressEqual(getAddress(deployment.core), derived)) {
      failWith(`the deployment names Core ${getAddress(deployment.core)}, and the Core this tree builds stands at ${derived} (factory or salt differ)`);
    }
    ok(`the deployment file ${file} names this Core, factory and salt`);
    core = getAddress(deployment.core);
  } else {
    lines.push(`note  no deployment file for chain ${chain.chainId}: checked the address this tree derives`);
  }

  try {
    await checkCoreAnswers(chain, core);
  } catch (error) {
    return failWith((error as Error).message);
  }
  const code = (await chain.client.getCode({ address: core }))!;
  ok(`code at ${core} on chain ${chain.chainId}: ${size(code)} bytes; it can only have come from that initcode`);
  ok(`eip712Domain() answers "${EIP712_DOMAIN_NAME}", "${EIP712_DOMAIN_VERSION}", chain ${chain.chainId}, verifying contract ${core}`);
  const cap = (await chain.client.readContract({ address: core, abi: AHandCoreAbi, functionName: "MAX_EXPIRY_PERIOD" })) as bigint;
  ok(`MAX_EXPIRY_PERIOD ${cap} seconds (${Number(cap) / 86400} days)`);
  lines.push("");
  lines.push("reproduce the initcode hash from a clone:");
  lines.push(`  ${reproduceCommand()}`);
  if (build.compiler.pathDependent) {
    lines.push("warn  this build's metadata names an absolute path (a remapping Foundry detected by itself), so a clone in");
    lines.push("      another folder builds another initcode hash: the command reproduces it only at this very path.");
    lines.push(`      remappings: ${build.compiler.remappings.filter((entry) => entry.includes("<repo>/") || entry.startsWith("/")).join(" ")}`);
  }
  lines.push(`Core ${core} is the AHandCore this tree builds.`);
  console.log(lines.join("\n"));
}

/* --------------------------------------------------------------------- main */

export async function main(argv: string[]): Promise<number> {
  try {
    const [command, ...rest] = argv;
    if (!command || command === "help" || command === "-h" || command === "--help") {
      console.log(USAGE);
      return command ? 0 : 2;
    }
    const args = parseArgs(rest);
    if (args.flags.has("--help")) {
      console.log(USAGE);
      return 0;
    }
    switch (command) {
      case "inspect":
        await inspect(args);
        break;
      case "thank-calldata":
        await thankCalldataCommand(args);
        break;
      case "pass":
        await pass(args);
        break;
      case "manifest":
        manifestCommand(args);
        break;
      case "core-check":
        await coreCheck(args);
        break;
      case "verify":
        return await verifyCommand(args);
      case "find":
        return await findCommand(args);
      case "recover":
        return await recoverCommand(args);
      default:
        throw new Fail(`unknown command ${clean(command)}; see bun tools/ahand.ts help`, 2);
    }
    return 0;
  } catch (error) {
    if (error instanceof Fail) {
      console.error(`ahand: ${error.message}`);
      return error.status;
    }
    // Something this tool did not expect: one line, never a stack that might quote a link.
    const message = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    console.error(`ahand: failed: ${clean(message, 300)}`);
    return 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

