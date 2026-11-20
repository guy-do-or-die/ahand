import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";

import { chainNow, faceOf, getHandFor, readDescription, readHand, type Hand, type MatchedData, type OpenedLink } from "@ahand/sdk";

import type { FaceConfig } from "./config.ts";
import { amountText, type CardState, type Lang, type Terms } from "./words.ts";

/**
 * What face may say about the address a preview robot fetched: the part before `#`, nothing else.
 *
 *   generic   a bare path, a mismatched `d`, an unknown chain, Core or Hand, any error
 *   hand      a Hand on a trusted Core: its terms from `hands()`, and its title only when `d`
 *             matched the dataHash Core keeps
 *
 * Every state is judged by the latest block's timestamp (the chain's clock), never this server's.
 */
export type Preview =
  | { kind: "generic" }
  | {
      kind: "hand";
      chainId: number;
      core: Address;
      handId: bigint;
      /** The address's own path, e.g. `/31337/12` or `/31337/0x…/12`. */
      path: string;
      /** `d` exactly as the address carried it, only when it matched. */
      d?: string;
      title?: string;
      /** The details, when the raiser made them public too. */
      content?: string;
      state: CardState;
      /** The expiry, or the closing time of a closed Hand: a block's timestamp. */
      date: number;
      /** `hands(id).reward` and its token; absent for a Hand with no reward. */
      reward?: { amount: bigint; symbol: string; decimals: number };
      /** The latest block, as the evidence for the state. */
      block: bigint;
    };

export const GENERIC: Preview = { kind: "generic" };

/** A path face reads as a Hand's address: `/<chain>/<hand>` or `/<chain>/<core>/<hand>`. */
export const HAND_PATH = /^\/([0-9]+)\/(?:(0x[0-9a-fA-F]{40})\/)?([0-9]+)$/;

interface TokenFacts {
  symbol: string;
  decimals: number;
}

export interface Reader {
  preview(pathname: string, rawQuery: string): Promise<Preview>;
}

/** The raw value of `d` as written, or undefined; the SDK refuses `d` given twice. */
function rawD(rawQuery: string): string | undefined {
  return rawQuery
    .split("&")
    .find((part) => part.startsWith("d="))
    ?.slice(2);
}

export function readerFor(config: FaceConfig, client?: PublicClient): Reader {
  const chainClient =
    client ??
    (createPublicClient({ transport: http(config.rpc, { timeout: 4_000, retryCount: 0 }) }) as PublicClient);
  const clients: Record<number, PublicClient> = { [config.chainId]: chainClient };
  const getHand = getHandFor(
    clients,
    config.trusted.map((core) => ({ chainId: config.chainId, core })),
  );
  const options = config.canonical ? { canonicalCore: config.canonical } : {};
  // A token's symbol and decimals, read from the token once.
  const tokens = new Map<string, Promise<TokenFacts>>();
  const tokenFacts = (token: Address): Promise<TokenFacts> => {
    const key = token.toLowerCase();
    let found = tokens.get(key);
    if (!found) {
      found = Promise.all([
        chainClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
        chainClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]).then(([symbol, decimals]) => ({ symbol, decimals }));
      found.catch(() => tokens.delete(key));
      tokens.set(key, found);
    }
    return found;
  };

  return {
    async preview(pathname, rawQuery) {
      if (!HAND_PATH.test(pathname)) return GENERIC;
      try {
        const address = `${config.site}${pathname}${rawQuery ? `?${rawQuery}` : ""}`;
        // faceOf reads the address as written and checks `d` against the Hand's dataHash;
        // getHandFor throws UntrustedCore for any chain or Core outside FACE_CORES.
        const { seen, hand, face } = await faceOf(address, (named) => getHand(named), options);
        if (!hand || seen.chainId === undefined || !seen.core || seen.handId === undefined) return GENERIC;

        const [{ view, stateAt }, now] = await Promise.all([readHand(chainClient, seen.core, seen.handId), chainNow(chainClient)]);
        const state = stateAt(now.timestamp);
        if (state === "missing") return GENERIC;
        const reward = view.reward > 0n ? { amount: view.reward, ...(await tokenFacts(view.token)) } : undefined;
        const words = face ? describedBy(hand, face) : {};
        return {
          kind: "hand",
          chainId: seen.chainId,
          core: seen.core,
          handId: seen.handId,
          path: pathname,
          ...(face ? { d: rawD(rawQuery) } : {}),
          ...words,
          state,
          date: state === "thanked" || state === "refunded" ? view.closedAt : view.expiry,
          ...(reward ? { reward } : {}),
          block: now.number,
        };
      } catch {
        // A mismatch, an unknown Core or Hand, a refused address or an unreachable chain: the
        // generic card, never an error page and never a word that was not checked.
        return GENERIC;
      }
    },
  };
}

/**
 * The title (and public details) that hang on the Hand's dataHash, read with the SDK's own reader
 * of a description. An unlisted Hand's details stay hidden inside the link, so only its title is
 * here. Lists a holder hung on a Shake never travel in `d` and are never read.
 */
function describedBy(hand: Hand, face: MatchedData): { title?: string; content?: string } {
  const read = readDescription({ hand, ofHand: face } as unknown as OpenedLink);
  const out: { title?: string; content?: string } = {};
  if (read.title !== undefined && read.title.trim() !== "") out.title = read.title;
  if (read.content !== undefined && read.content.trim() !== "") out.content = read.content;
  return out;
}

/** A Hand's terms in the reader's words; no amount at all for a Hand with no reward. */
export function termsOf(preview: Extract<Preview, { kind: "hand" }>, lang: Lang): Terms {
  const { state, date, reward } = preview;
  return reward ? { state, date, amount: amountText(reward.amount, reward, lang) } : { state, date };
}
