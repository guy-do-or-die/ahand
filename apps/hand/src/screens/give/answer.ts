import {
  askSigner,
  carryFor,
  checkGive,
  checkGiveOnChain,
  CoreRefused,
  encodeGive,
  giveTypedData,
  isErc6492,
  messageIdOf,
  Refusal,
  signGiveWithKey,
  toAddress,
  toCoreSignature,
  unwrap6492,
  type AccountSetup,
  type Give,
  type LinkOptions,
  type OpenedAddress,
  type SignedGive,
} from "@ahand/sdk";
import { zeroHash, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Answering a live link (ARCHITECTURE §6 step 7, §11 Signing), in this order and no other:
 *
 *   1. the Give: {signer, payee, the claim the route left, its routeHash, dataHash 0} (D-36);
 *   2. the link key confirms it (`signGiveWithKey`), then the giver's own confirmation;
 *   3. the SDK's offline `checkGive`, asking the account's code where there is code (`askSigner`);
 *   4. Core's own `checkGive` by `eth_call`; for an answer wrapped per ERC-6492 (an account not set
 *      up yet) through the forwarder with the setup counted in (R-28, D-62);
 *   5. only then `encodeGive` and a bare address.
 *
 * A wrapped answer stays wrapped: the link carries it as it is, and the thank sets the account up.
 * Nothing here keeps a key: a confirmer is made by the screen for one answer and dropped after it.
 */

export type GiveTyped = ReturnType<typeof giveTypedData>;
export type Confirmed = { ok: true; signature: Hex } | { ok: false; reason: "rejected" | "failed"; message?: string };
export type Confirm = (typed: GiveTyped) => Promise<Confirmed>;

export type AnswerStep = "confirm" | "here" | "core" | "write";

export interface AnswerInput {
  /** The opened live link (it has its link key). */
  opened: OpenedAddress;
  signer: Address;
  payee: Address;
  confirm: Confirm;
  client: PublicClient;
  /** The configuration's forwarder; null where the site has none. */
  forwarder: Address | null;
  /** The site the bare give address starts with. */
  site: string;
  options: LinkOptions;
  onStep?: (step: AnswerStep) => void;
  /** Core's checkGive; the SDK's `checkGiveOnChain` unless a unit test stands in for the chain. */
  checkOnChain?: typeof checkGiveOnChain;
  /** The block Core is asked at, for the evidence line. */
  blockNumber?: () => Promise<bigint>;
}

export type AnswerOutcome =
  | {
      ok: true;
      /** The bare give address, as text. */
      address: string;
      /** The same address with the link as digits, for a QR code. */
      digits: string;
      signedGive: SignedGive;
      giveHash: Hex;
      /** The setup Core was asked with: the account is not set up yet. */
      setup?: AccountSetup;
      /** The block Core answered at (or just after). */
      block: bigint;
    }
  | { ok: false; reason: "rejected" | "refused" | "offline" | "no-forwarder" | "failed"; messageId?: string; message?: string };

/** A network that did not answer, anywhere in the cause chain: said as such, never as a bad answer. */
export function isNetworkError(error: unknown): boolean {
  let node: unknown = error;
  const seen = new Set<unknown>();
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    const { name, message } = node as { name?: unknown; message?: unknown };
    if (typeof name === "string" && /^(HttpRequestError|TimeoutError|WebSocketRequestError|SocketClosedError)$/.test(name)) return true;
    if (typeof message === "string" && /failed to fetch|fetch failed|networkerror|network request failed|ECONNREFUSED/i.test(message)) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

function failureOf(error: unknown): AnswerOutcome {
  if (error instanceof Refusal || error instanceof CoreRefused) return { ok: false, reason: "refused", messageId: messageIdOf(error) };
  if (isNetworkError(error)) return { ok: false, reason: "offline" };
  return { ok: false, reason: "failed", message: error instanceof Error ? error.message.split("\n")[0] : String(error) };
}

/** A key confirms: the one-time key of "An address I have". */
export function confirmWithKey(privateKey: Hex): Confirm {
  return async (typed) => ({ ok: true, signature: toCoreSignature(await privateKeyToAccount(privateKey).signTypedData(typed)) });
}

/** A local account confirms: the address made from twelve words. */
export function confirmWithAccount(account: { signTypedData: (typed: GiveTyped) => Promise<Hex> }): Confirm {
  return async (typed) => ({ ok: true, signature: toCoreSignature(await account.signTypedData(typed)) });
}

export async function answerLink(input: AnswerInput): Promise<AnswerOutcome> {
  const { opened, client } = input;
  const checkOnChain = input.checkOnChain ?? checkGiveOnChain;
  if (!opened.linkKey) return { ok: false, reason: "failed", message: "only a live link can be answered" };
  const give: Give = {
    signer: input.signer,
    payee: input.payee,
    claimBps: opened.end.claimBps,
    routeHash: opened.end.routeHash,
    dataHash: zeroHash,
  };

  input.onStep?.("confirm");
  let signedGive: SignedGive;
  try {
    const keySig = await signGiveWithKey(opened.linkKey, opened.domain, opened.hand, give);
    const answer = await input.confirm(giveTypedData(opened.domain, opened.hand, give));
    if (!answer.ok) return answer.reason === "rejected" ? { ok: false, reason: "rejected" } : { ok: false, reason: "failed", ...(answer.message ? { message: answer.message } : {}) };
    signedGive = { give, keySig, giverSig: answer.signature };
  } catch (error) {
    return failureOf(error);
  }

  const wrapped = isErc6492(signedGive.giverSig) ? unwrap6492(signedGive.giverSig) : undefined;
  if (wrapped && !input.forwarder) return { ok: false, reason: "no-forwarder" };
  const setup: AccountSetup | undefined = wrapped && input.forwarder ? { forwarder: input.forwarder, factory: wrapped.factory, factoryData: wrapped.factoryData } : undefined;

  input.onStep?.("here");
  let giveHash: Hex;
  try {
    giveHash = await checkGive(opened.domain, opened.hand, opened.signedShakes, signedGive, askSigner(client));
  } catch (error) {
    return failureOf(error);
  }

  input.onStep?.("core");
  let block: bigint;
  try {
    block = await (input.blockNumber ?? (() => client.getBlockNumber()))();
    await checkOnChain(client, opened.domain.verifyingContract, opened.hand.handId, opened.signedShakes, signedGive, setup);
  } catch (error) {
    return failureOf(error);
  }

  input.onStep?.("write");
  try {
    // The Hand's words travel on in the shape a bare address can carry them (none outside it).
    const carry = carryFor(opened, "bare");
    const link = await encodeGive(
      { domain: opened.domain, hand: opened.hand, signedShakes: opened.signedShakes, signedGive, attachments: carry.attachments },
      input.options,
    );
    return {
      ok: true,
      address: toAddress({ site: input.site, link, shape: "bare" }, input.options),
      digits: toAddress({ site: input.site, link, shape: "bare", form: "digits" }, input.options),
      signedGive,
      giveHash,
      ...(setup ? { setup } : {}),
      block,
    };
  } catch (error) {
    return failureOf(error);
  }
}
