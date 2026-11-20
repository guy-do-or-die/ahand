import {
  CoreRefused,
  LinkError,
  UntrustedCore,
  checkGiveOnChain,
  decodeCoreError,
  fromText,
  giveHash,
  messageIdOf,
  openAddress,
  openLink,
  unwrap6492,
  type Hand,
  type LinkHead,
  type LinkOptions,
  type OpenedLink,
} from "@ahand/sdk";
import { isAddressEqual, type Address, type Hex, type PublicClient } from "viem";

/**
 * Whether a give link that reached this device is an answer to this Hand (UX-SPEC §7.3, §7.5):
 * opened against the Hand's terms, then put to Core's own `checkGive` by `eth_call`. Nothing is
 * called an answer before Core says yes. A giver signature wrapped per ERC-6492 (an account not
 * set up yet) is asked through the forwarder with its setup first, as /thank does; Core alone
 * would refuse the wrapper.
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
      verdict: "refused";
      /** The catalogue id of the sentence: `core.<Error>`, `link.<code>`, or one of this screen's. */
      messageId: string;
      detail?: string;
    };

function refusedBy(error: unknown): Judged {
  if (error instanceof CoreRefused) return { verdict: "refused", messageId: messageIdOf(error) };
  if (error instanceof LinkError || error instanceof UntrustedCore) return { verdict: "refused", messageId: messageIdOf(error) };
  const refusal = decodeCoreError(error);
  if (refusal) return { verdict: "refused", messageId: messageIdOf(refusal) };
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
    return refusedBy(error);
  }
  const { head } = opened;
  if (head.chainId !== place.chainId || !isAddressEqual(head.core, place.core) || opened.hand.handId !== place.handId) {
    return { verdict: "refused", messageId: "my.refused.otherHand" };
  }
  if (!opened.signedGive) return { verdict: "refused", messageId: "my.refused.notGive" };

  const signedGive = opened.signedGive;
  const wrapped = unwrap6492(signedGive.giverSig);
  let needsSetup = false;
  if (wrapped) {
    const code = await client.getCode({ address: signedGive.give.signer }).catch(() => undefined);
    needsSetup = code === undefined || code === "0x";
  }
  try {
    const block = await client.getBlockNumber();
    if (needsSetup) {
      if (!forwarder) return { verdict: "refused", messageId: "my.refused.noForwarder" };
      await checkGiveOnChain(client, place.core, place.handId, opened.signedShakes, signedGive, { forwarder, factory: wrapped!.factory, factoryData: wrapped!.factoryData });
    } else if (wrapped) {
      // Set up by now: Core reads the inner signature, as the thank will send it.
      await checkGiveOnChain(client, place.core, place.handId, opened.signedShakes, { ...signedGive, giverSig: wrapped.signature });
    } else {
      await checkGiveOnChain(client, place.core, place.handId, opened.signedShakes, signedGive);
    }
    return { verdict: "answer", opened, giveHash: giveHash(opened.hand, signedGive.give), needsSetup, block };
  } catch (error) {
    return refusedBy(error);
  }
}
