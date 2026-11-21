import { createPublicClient, http, isAddressEqual, type Address, type PublicClient } from "viem";

import { chainNow, faceOf, readDescriptionOf, readHand, type Hand, type MatchedData } from "@ahand/sdk";

import type { FaceConfig, ListedToken } from "./config.ts";
import { Lru } from "./lru.ts";
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
      /**
       * `hands(id).reward`, absent for a Hand with no reward, and its token when the app lists it
       * (FACE_TOKENS); an amount in any other token is never written.
       */
      reward?: { amount: bigint; token?: ListedToken };
      /** The latest block, as the evidence for the state. */
      block: bigint;
    };

export const GENERIC: Preview = { kind: "generic" };

/** A path face reads as a Hand's address: `/<chain>/<hand>` or `/<chain>/<core>/<hand>`. */
export const HAND_PATH = /^\/([0-9]+)\/(?:(0x[0-9a-fA-F]{40})\/)?([0-9]+)$/;

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

/**
 * The part of an address a preview depends on: the path and every `d=` written, in order (the
 * SDK reads `d` only when it is written `d=`, refuses it given twice, and skips every other
 * parameter). Two requests that differ in anything else, face's own `l` and `th` or a parameter
 * added to dodge the memory, read the chain once.
 */
export function previewKey(pathname: string, rawQuery: string): string {
  const kept = rawQuery.split("&").filter((part) => part.startsWith("d="));
  return kept.length > 0 ? `${pathname}?${kept.join("&")}` : pathname;
}

/** How long one preview may spend on the chain before it gives up and is the generic card. */
export const PREVIEW_DEADLINE_MS = 2_500;

export interface ReaderOptions {
  /**
   * How long one reading of a Hand answers for the same address, in milliseconds (default 5 000).
   * A page and its card, and a burst of robots fetching one link, then cost one set of chain
   * reads instead of three per request. A card already says "max-age=300", so five seconds more
   * changes nothing a reader can see.
   */
  ttlMs?: number;
  /** How many addresses are remembered at most (default 1 024); least recently used out first. */
  entries?: number;
  /** The clock of the memory, for tests. */
  now?: () => number;
  /** How long one reading may take before it is the generic card (default PREVIEW_DEADLINE_MS). */
  deadlineMs?: number;
}

export function readerFor(config: FaceConfig, client?: PublicClient, options: ReaderOptions = {}): Reader {
  const read = chainReaderFor(config, client, options.deadlineMs ?? PREVIEW_DEADLINE_MS);
  const ttl = options.ttlMs ?? 5_000;
  if (ttl <= 0) return read;
  const now = options.now ?? Date.now;
  const memory = new Lru<{ until: number; preview: Promise<Preview> }>(options.entries ?? 1_024);
  return {
    preview(pathname, rawQuery) {
      if (!HAND_PATH.test(pathname)) return Promise.resolve(GENERIC);
      const key = previewKey(pathname, rawQuery);
      const found = memory.get(key);
      if (found && found.until > now()) return found.preview;
      // The reader never throws (anything wrong is the generic card), so a reading is kept as is.
      const entry = { until: now() + ttl, preview: read.preview(pathname, rawQuery) };
      memory.set(key, entry);
      return entry.preview;
    },
  };
}

/**
 * The reader with no memory: every call reads the chain.
 *
 * One reading is `hands(id)` and the latest block, sent together as one JSON-RPC batch (a closed
 * Hand adds `thanks(id)`), and nothing else: the token's facts come from FACE_TOKENS, never from
 * the token. CCIP-Read is off, so no contract can send face to a URL of its own (`OffchainLookup`),
 * and the whole reading has one deadline, after which the answer is the generic card.
 */
function chainReaderFor(config: FaceConfig, client: PublicClient | undefined, deadlineMs: number): Reader {
  const chainClient =
    client ??
    (createPublicClient({
      transport: http(config.rpc, { timeout: deadlineMs, retryCount: 0, batch: true }),
      ccipRead: false,
    }) as PublicClient);
  const options = config.canonical ? { canonicalCore: config.canonical } : {};
  const listed = (token: Address) => config.tokens.find((t) => isAddressEqual(t.address, token));

  async function read(pathname: string, rawQuery: string): Promise<Preview> {
    const address = `${config.site}${pathname}${rawQuery ? `?${rawQuery}` : ""}`;
    // The Hand and the clock, read once and together, for faceOf and for the terms alike.
    let reading: ReturnType<typeof readWithClock> | undefined;
    const readWithClock = (core: Address, handId: bigint) =>
      Promise.all([readHand(chainClient, core, handId), chainNow(chainClient)]);
    // faceOf reads the address as written and checks `d` against the Hand's dataHash; any chain
    // or Core outside FACE_CHAIN and FACE_CORES, and a Hand never raised, is refused here.
    const getHand = async ({ chainId, core, handId }: { chainId?: number; core?: Address; handId?: bigint }): Promise<Hand> => {
      if (chainId !== config.chainId || !core || handId === undefined) throw new Error("not a Hand face reads");
      if (!config.trusted.some((trusted) => isAddressEqual(trusted, core))) throw new Error("not a Core face trusts");
      reading = readWithClock(core, handId);
      const [{ view, hand }] = await reading;
      if (view.openedAt === 0) throw new Error("no such Hand");
      return hand;
    };
    const { seen, hand, face } = await faceOf(address, getHand, options);
    if (!hand || !reading || seen.chainId === undefined || !seen.core || seen.handId === undefined) return GENERIC;

    const [{ view, stateAt }, now] = await reading;
    const state = stateAt(now.timestamp);
    if (state === "missing") return GENERIC;
    const token = listed(view.token);
    const reward = view.reward > 0n ? { amount: view.reward, ...(token ? { token } : {}) } : undefined;
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
  }

  return {
    async preview(pathname, rawQuery) {
      if (!HAND_PATH.test(pathname)) return GENERIC;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<Preview>((done) => {
        timer = setTimeout(() => done(GENERIC), deadlineMs);
      });
      try {
        return await Promise.race([read(pathname, rawQuery), late]);
      } catch {
        // A mismatch, an unknown Core or Hand, a refused address or an unreachable chain: the
        // generic card, never an error page and never a word that was not checked.
        return GENERIC;
      } finally {
        clearTimeout(timer);
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
  const read = readDescriptionOf(hand, face);
  const out: { title?: string; content?: string } = {};
  if (read.title !== undefined && read.title.trim() !== "") out.title = read.title;
  if (read.content !== undefined && read.content.trim() !== "") out.content = read.content;
  return out;
}

/**
 * A Hand's terms in the reader's words: no amount at all for a Hand with no reward, and for a
 * reward in a token the app does not list only that it is one (no amount, no "$").
 */
export function termsOf(preview: Extract<Preview, { kind: "hand" }>, lang: Lang): Terms {
  const { state, date, reward } = preview;
  if (!reward) return { state, date };
  if (!reward.token) return { state, date, unknownToken: true };
  return { state, date, amount: amountText(reward.amount, reward.token, lang) };
}
