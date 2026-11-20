import {
  CoreRefused,
  LinkError,
  UntrustedCore,
  decodeCoreError,
  fromText,
  giveHash,
  messageIdOf,
  openAddress,
  openLink,
  type Hand,
  type LinkHead,
  type LinkOptions,
  type OpenedLink,
} from "@ahand/sdk";
import { isAddressEqual, type Address, type Hex, type PublicClient } from "viem";

import { isNetworkError } from "../../chain/errors";
import { giveOnChain } from "../../chain/give";
import type { InboxRecord } from "../../store/db";

/**
 * Whether a give link that reached this device is an answer to this Hand (UX-SPEC §7.3, §7.5):
 * opened against the Hand's terms, then put to Core's own `checkGive` by `eth_call`. Nothing is
 * called an answer before Core says yes. A giver signature wrapped per ERC-6492 (an account not
 * set up yet) is asked through the forwarder with its setup first: the same `giveOnChain` /thank
 * uses. A network that does not answer is "offline", never a refusal and never "needs setup".
 */

export interface HandPlace {
  chainId: number;
  core: Address;
  handId: bigint;
}

export type Judged =
  | {
      verdict: "answer";
      opened: OpenedLink;
      giveHash: Hex;
      /** The account answered from is not set up on this network yet; /thank sets it up first. */
      needsSetup: boolean;
      /** The block whose state Core answered on. */
      block: bigint;
    }
  | {
      /** The network did not answer: not judged yet, asked again when the chain is back. */
      verdict: "offline";
    }
  | {
      verdict: "refused";
      /** The catalogue id of the sentence: `core.<Error>`, `link.<code>`, or one of this screen's. */
      messageId: string;
      detail?: string;
    };

/** What a failure to open or check a give link means for the card: a refusal by name, offline, or unknown. */
export function judgedOf(error: unknown): Judged {
  if (error instanceof CoreRefused) return { verdict: "refused", messageId: messageIdOf(error) };
  if (error instanceof LinkError || error instanceof UntrustedCore) return { verdict: "refused", messageId: messageIdOf(error) };
  const refusal = decodeCoreError(error);
  if (refusal) return { verdict: "refused", messageId: messageIdOf(refusal) };
  if (isNetworkError(error)) return { verdict: "offline" };
  return { verdict: "refused", messageId: "my.refused.unknown", detail: error instanceof Error ? error.message.split("\n")[0] : String(error) };
}

/** Opens a give link as it arrived: a whole address (with `#`) or the bare link text. */
async function openGive(text: string, getHand: (head: LinkHead) => Promise<Hand>, options: LinkOptions): Promise<OpenedLink> {
  const trimmed = text.trim();
  if (trimmed.includes("#")) return openAddress(trimmed, getHand, options);
  return openLink(fromText(trimmed), getHand, options);
}

export async function judgeGive(args: {
  giveLink: string;
  place: HandPlace;
  client: PublicClient;
  getHand: (head: LinkHead) => Promise<Hand>;
  options: LinkOptions;
  forwarder: Address | null;
}): Promise<Judged> {
  const { giveLink, place, client, getHand, options, forwarder } = args;
  let opened: OpenedLink;
  try {
    opened = await openGive(giveLink, getHand, options);
  } catch (error) {
    return judgedOf(error);
  }
  const { head } = opened;
  if (head.chainId !== place.chainId || !isAddressEqual(head.core, place.core) || opened.hand.handId !== place.handId) {
    return { verdict: "refused", messageId: "my.refused.otherHand" };
  }
  if (!opened.signedGive) return { verdict: "refused", messageId: "my.refused.notGive" };

  const signedGive = opened.signedGive;
  try {
    const asked = await giveOnChain({ client, core: place.core, handId: place.handId, signedShakes: opened.signedShakes, signedGive, forwarder });
    if (!asked.ok) return { verdict: "refused", messageId: "my.refused.noForwarder" };
    const { block } = asked;
    const needsSetup = asked.setup !== undefined;
    return { verdict: "answer", opened, giveHash: giveHash(opened.hand, signedGive.give), needsSetup, block };
  } catch (error) {
    return judgedOf(error);
  }
}

/**
 * One card per Give (FINDINGS E-3, E-4). Records that Core accepted as the same Give (one
 * giveHash) are one answer, kept in the order this device first saw it: the earliest first-seen
 * time of its copies stands, and the helper's words and chat key come from whichever copy carried
 * them (a pasted copy has neither). Answers come first, in that order; then whatever is still being
 * checked or waits for the network; then what was refused.
 */
export function onePerGive<T extends { record: InboxRecord; judged?: Judged }>(reads: T[]): T[] {
  const answers = new Map<string, T>();
  const rest: T[] = [];
  for (const read of reads) {
    if (read.judged?.verdict !== "answer") {
      rest.push(read);
      continue;
    }
    const hash = read.judged.giveHash.toLowerCase();
    const before = answers.get(hash);
    if (!before) {
      answers.set(hash, read);
      continue;
    }
    const [first, other] = read.record.firstSeen < before.record.firstSeen ? [read, before] : [before, read];
    const record: InboxRecord = { ...first.record };
    if (!record.words && other.record.words) record.words = other.record.words;
    if (!record.replyTo && other.record.replyTo) record.replyTo = other.record.replyTo;
    answers.set(hash, { ...first, record });
  }
  // Still being checked, or waiting for the network, before what was refused.
  const rank = (read: T) => (read.judged && read.judged.verdict !== "offline" ? 2 : 1);
  return [
    ...[...answers.values()].sort((a, b) => a.record.firstSeen - b.record.firstSeen),
    ...rest.sort((a, b) => rank(a) - rank(b) || a.record.firstSeen - b.record.firstSeen),
  ];
}
