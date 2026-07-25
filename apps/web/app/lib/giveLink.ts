import { decodeTerminalProof, ZERO_ADDRESS } from "@ahand/sdk";
import { b64urlDecode } from "./metadata";

/**
 * Give-message codec — pure helpers for delivering a Give over XMTP.
 *
 * A give message is plain text: the giver's note, a blank line, then the
 * `/h/:id/thank#payload` proof link. Plain text keeps the message readable
 * in any XMTP client (Coinbase Wallet, Convos, …); the URL alone carries
 * the whole proof, so a raiser can settle even from a foreign client.
 */

export type GiveMessage = {
  /** Hand the give answers (from the link path). */
  handId: string;
  /** Base64url thank payload — the part after `#`. */
  fragment: string;
  /** The giver's note — message text with the link removed. */
  note: string;
};

/** One thank-link per message: note first, link on its own line. */
export function buildGiveMessage(args: { solveUrl: string; solutionText: string }): string {
  const note = args.solutionText.trim();
  return note ? `${note}\n\n${args.solveUrl}` : args.solveUrl;
}

/**
 * Anything longer than a real give message (note + one link) is spam;
 * refusing early also keeps the regex work bounded on hostile input.
 */
const MAX_PARSE_LENGTH = 8192;

// Bounded quantifiers keep backtracking linear — hostile DMs are parsed
// on the raiser's device, so this must never be super-linear.
const THANK_LINK_RE = /https?:\/\/[^\s]{1,256}?\/h\/(\d{1,18})\/thank#([A-Za-z0-9_-]+)/g;

/**
 * Pick a give out of arbitrary message text. Returns null for anything that
 * isn't a thank-link with a decodable payload (foreign links, plain chatter),
 * so inbox rendering can safely flat-map over every DM. When several links
 * appear, the LAST one wins — buildGiveMessage always puts the real proof
 * last, so a link pasted inside the note can't shadow it.
 */
export function parseGiveMessage(text: unknown): GiveMessage | null {
  if (typeof text !== "string" || text.length > MAX_PARSE_LENGTH) return null;
  let match: RegExpMatchArray | null = null;
  for (const m of text.matchAll(THANK_LINK_RE)) match = m;
  if (!match) return null;
  const [link, handId, fragment] = match;
  if (!isThankPayload(fragment, handId)) return null;
  const note = text.replace(link, "").trim();
  return { handId, fragment, note };
}

/**
 * Current-origin path for a received give, so a link minted on another
 * origin (ngrok, another stand) still settles locally.
 */
export function thankPathFor(msg: Pick<GiveMessage, "handId" | "fragment">): string {
  return `/h/${msg.handId}/thank#${msg.fragment}`;
}

/** Header layout: magic(2) ver(1) kind(1) chainId(8) core(20) handId(32). */
const HEADER_LENGTH = 64;

function readBig(bytes: Uint8Array, start: number, len: number): bigint {
  let v = 0n;
  for (let i = start; i < start + len; i++) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

/**
 * Structural validation via the real terminal-proof codec. The HandRef
 * context comes from the payload's own header (self-consistent decode) —
 * chain facts like expiry are unknown at inbox time, so placeholders stand
 * in for the reconstructed-only fields; the thank page re-decodes against
 * the on-chain hand and verifies signatures before anything can settle.
 */
function isThankPayload(fragment: string, handId: string): boolean {
  try {
    const bytes = b64urlDecode(fragment);
    if (bytes.length < HEADER_LENGTH) return false;
    const headerHandId = readBig(bytes, 32, 32);
    if (headerHandId !== BigInt(handId)) return false;
    const core = `0x${Array.from(bytes.subarray(12, 32), (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
    decodeTerminalProof(fragment, {
      handRef: { chainId: readBig(bytes, 4, 8), core, handId: headerHandId },
      expiry: 0n,
      rootCapability: ZERO_ADDRESS,
    });
    return true;
  } catch {
    return false;
  }
}
