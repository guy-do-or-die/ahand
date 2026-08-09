import { z } from "zod";
import canonicalize from "canonicalize";

const utf8len = (s: string) => new TextEncoder().encode(s).length;

/**
 * Three-layer metadata (local/design/offchain.md → web):
 *
 *   envelope   {v, visibility, nonce, schema, discoveryHash, routeBodyHash}
 *              → metadataCommitment = sha256(canonical envelope) — on-chain anchor.
 *   discovery  {title, teaser?}  — the public face (OG card, boards).
 *              → discoveryCommitment = sha256(canonical discovery) on-chain,
 *                ZERO_HASH for dark hands (nothing public is committed).
 *   route body {description, contacts?} — travels only in the link fragment.
 *              → routeBodyHash, bound inside the envelope.
 *
 * The envelope always binds all three layers (dark included) so a viewer can
 * verify title and body against the single on-chain metadataCommitment.
 * Dark rules: zero discoveryCommitment, no ?e= in links, no public tags.
 */

/** Marks the envelope's document family for indexers and future migrations. */
export const METADATA_SCHEMA = "ahand/meta@2";

/** ≈ chars one hop adds to a v2 payload link (survival counter divisor). */
export const CHARS_PER_HOP = 116;

/** Hard cap for a rendered link — messengers truncate beyond this. */
export const MAX_LINK_CHARS = 1900;

/** bytes32 zero — dark hands post this as their discoveryCommitment. */
export const ZERO_HASH: `0x${string}` = `0x${"0".repeat(64)}`;

const Hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);

export const Envelope = z.object({
  v: z.literal(2),
  visibility: z.enum(["public", "preview", "dark"]),
  nonce: z.string().min(22),
  schema: z.literal(METADATA_SCHEMA),
  discoveryHash: Hex32,
  routeBodyHash: Hex32,
}).passthrough();

/**
 * Open-hand extras inside a PUBLIC discovery doc: the root bearer secret plus
 * everything needed to rebuild the canonical envelope byte-for-byte (the
 * envelope commits to the discovery hash, so it cannot ride inside the doc
 * itself). Public means open — anyone who can discover the hand can join its
 * chain; the raiser opts in by choosing public visibility.
 */
export const OpenExtras = z.object({
  secret: z.string().regex(/^0x[0-9a-f]{64}$/i),
  envNonce: z.string().min(22),
  /** b64url of the canonical route-body bytes. */
  body: z.string().min(1),
});

export const Discovery = z.object({
  title: z.string().min(1).max(80),
  teaser: z.string().max(140).optional(),
  nonce: z.string().min(22),
  open: OpenExtras.optional(),
}).passthrough();

export const RouteBody = z.object({
  description: z.string().refine((s) => utf8len(s) <= 1000, "at most 1000 bytes of UTF-8 (≈1000 latin / ≈500 cyrillic chars)"),
  contacts: z.string().max(500).optional(),
  image: z.string().url().optional(),
  nonce: z.string().min(22),
}).passthrough();

export type Envelope = z.infer<typeof Envelope>;
export type Discovery = z.infer<typeof Discovery>;
export type RouteBody = z.infer<typeof RouteBody>;

/** @deprecated the body layer is called RouteBody in the three-layer split. */
export const Body = RouteBody;
export type Body = RouteBody;

// Isomorphic Base64URL
export function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return b64urlEncode(bytes);
}

export async function sha256hex(bytes: Uint8Array): Promise<`0x${string}`> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hashHex}`;
}

export interface BuiltMetadata {
  envelope: Envelope;
  discovery: Discovery;
  body: RouteBody;
  envelopeBytes: Uint8Array;
  discoveryBytes: Uint8Array;
  bodyBytes: Uint8Array;
  envelopeB64: string;
  discoveryB64: string;
  bodyB64: string;
  /** sha256 of the canonical envelope — RaiseParams.metadataCommitment. */
  metadataCommitment: `0x${string}`;
  /** On-chain discovery anchor — ZERO_HASH for dark hands. */
  discoveryCommitment: `0x${string}`;
  /** == envelope.routeBodyHash, surfaced for convenience. */
  routeBodyHash: `0x${string}`;
  /** @deprecated alias of metadataCommitment (pre-split name). */
  metadataHash: `0x${string}`;
}

export async function buildMetadata(input: {
  text: string;
  contacts?: string;
  image?: string;
  visibility: "public" | "preview" | "dark";
  /** Public only: embed the root bearer secret so the hand is openly joinable. */
  open?: { secret: `0x${string}` };
  opts?: { nonces?: Partial<{ envelope: string; discovery: string; body: string }> };
}): Promise<BuiltMetadata> {
  if (!input.text.trim()) {
    throw new Error("Text cannot be empty");
  }

  if (utf8len(input.text) > 1000) {
    throw new Error("Text exceeds 1000 bytes UTF-8");
  }

  let cut = input.text.indexOf("\n");
  if (cut === -1 || cut > 80) {
    if (input.text.length <= 80) {
      cut = input.text.length;
    } else {
      cut = input.text.lastIndexOf(" ", 80);
      if (cut === -1) cut = 80;
    }
  }

  const title = input.text.slice(0, cut).trim();
  const description = input.text.slice(cut).trim();
  const descriptionClean = description.replace(/\s+/g, " ").trim();
  const teaser = descriptionClean
    ? descriptionClean.slice(0, 137).trim() + (descriptionClean.length > 137 ? "..." : "")
    : "";

  const bodyObj = {
    description,
    ...(input.contacts ? { contacts: input.contacts } : {}),
    ...(input.image ? { image: input.image } : {}),
    nonce: input.opts?.nonces?.body || newNonce(),
  };

  const parsedBodyObj = RouteBody.parse(bodyObj);
  const bodyCanonicalStr = canonicalize(parsedBodyObj)!;
  const bodyBytes = new TextEncoder().encode(bodyCanonicalStr);
  const routeBodyHash = await sha256hex(bodyBytes);

  // The envelope nonce is fixed BEFORE the discovery doc: open (public) docs
  // carry it so readers can rebuild the canonical envelope from the doc alone.
  const envelopeNonce = input.opts?.nonces?.envelope || newNonce();

  const discoveryObj = {
    title,
    ...(teaser ? { teaser } : {}),
    nonce: input.opts?.nonces?.discovery || newNonce(),
    ...(input.visibility === "public" && input.open
      ? {
          open: {
            secret: input.open.secret,
            envNonce: envelopeNonce,
            body: b64urlEncode(bodyBytes),
          },
        }
      : {}),
  };

  const parsedDiscoveryObj = Discovery.parse(discoveryObj);
  const discoveryCanonicalStr = canonicalize(parsedDiscoveryObj)!;
  const discoveryBytes = new TextEncoder().encode(discoveryCanonicalStr);
  const discoveryHash = await sha256hex(discoveryBytes);

  const envelopeObj = {
    v: 2 as const,
    visibility: input.visibility,
    nonce: envelopeNonce,
    schema: METADATA_SCHEMA as typeof METADATA_SCHEMA,
    discoveryHash,
    routeBodyHash,
  };

  const parsedEnvelopeObj = Envelope.parse(envelopeObj);
  const envelopeCanonicalStr = canonicalize(parsedEnvelopeObj)!;
  const envelopeBytes = new TextEncoder().encode(envelopeCanonicalStr);
  const metadataCommitment = await sha256hex(envelopeBytes);

  return {
    envelope: parsedEnvelopeObj,
    discovery: parsedDiscoveryObj,
    body: parsedBodyObj,
    envelopeBytes,
    discoveryBytes,
    bodyBytes,
    envelopeB64: b64urlEncode(envelopeBytes),
    discoveryB64: b64urlEncode(discoveryBytes),
    bodyB64: b64urlEncode(bodyBytes),
    metadataCommitment,
    // Dark: nothing public is committed — the chain shows a zero anchor.
    discoveryCommitment: input.visibility === "dark" ? ZERO_HASH : discoveryHash,
    routeBodyHash,
    metadataHash: metadataCommitment,
  };
}

export type VerifyMetadataResult =
  | { ok: true; envelope: Envelope; discovery: Discovery | null; body: RouteBody }
  | { ok: false; reason: string };

/**
 * Fail-closed verification of link-carried layers against the on-chain
 * anchors. Discovery is optional (a stripped ?e= loses the title, not the
 * hand); when present it must match the hash bound inside the envelope.
 */
export async function verifyMetadata(
  parts: { envelopeB64: string; discoveryB64?: string; bodyB64: string },
  onchain: { metadataCommitment: `0x${string}`; discoveryCommitment?: `0x${string}` },
): Promise<VerifyMetadataResult> {
  try {
    const envelopeBytes = b64urlDecode(parts.envelopeB64);
    const bodyBytes = b64urlDecode(parts.bodyB64);

    const calcEnvHash = await sha256hex(envelopeBytes);
    if (calcEnvHash !== onchain.metadataCommitment) {
      return { ok: false, reason: "Envelope hash mismatch with on-chain anchor" };
    }

    const envelopeStr = new TextDecoder().decode(envelopeBytes);
    const rawEnvelope = JSON.parse(envelopeStr);
    const envelope = Envelope.parse(rawEnvelope);

    const calcBodyHash = await sha256hex(bodyBytes);
    if (calcBodyHash !== envelope.routeBodyHash) {
      return { ok: false, reason: "Route body hash mismatch with envelope anchor" };
    }

    const bodyStr = new TextDecoder().decode(bodyBytes);
    const rawBody = JSON.parse(bodyStr);
    const body = RouteBody.parse(rawBody);

    if (onchain.discoveryCommitment !== undefined) {
      if (envelope.visibility === "dark") {
        if (onchain.discoveryCommitment !== ZERO_HASH) {
          return { ok: false, reason: "Dark hand must carry a zero discovery commitment" };
        }
      } else if (onchain.discoveryCommitment !== envelope.discoveryHash) {
        return { ok: false, reason: "Discovery commitment mismatch with envelope anchor" };
      }
    }

    let discovery: Discovery | null = null;
    if (parts.discoveryB64 !== undefined) {
      const discoveryBytes = b64urlDecode(parts.discoveryB64);
      const calcDiscHash = await sha256hex(discoveryBytes);
      if (calcDiscHash !== envelope.discoveryHash) {
        return { ok: false, reason: "Discovery hash mismatch with envelope anchor" };
      }
      const discoveryStr = new TextDecoder().decode(discoveryBytes);
      const rawDiscovery = JSON.parse(discoveryStr);
      discovery = Discovery.parse(rawDiscovery);
    }

    return { ok: true, envelope, discovery, body };
  } catch (err: any) {
    return { ok: false, reason: `Verification error: ${err.message}` };
  }
}

/**
 * Rebuild link-shaped metadata parts from a fetched-and-verified PUBLIC
 * discovery doc that carries open-hand extras. The canonical envelope is
 * reconstructed deterministically (same canonicalize, same field set); the
 * caller then runs the ordinary fail-closed verifyMetadata against the
 * on-chain commitments, so a doctored doc gets exactly as far as a doctored
 * link would. Returns null when the doc has no open extras.
 */
export async function reopenFromDiscovery(docBytes: Uint8Array): Promise<{
  secret: `0x${string}`;
  metaParts: { envelopeB64: string; discoveryB64: string; bodyB64: string };
} | null> {
  const doc = Discovery.parse(JSON.parse(new TextDecoder().decode(docBytes)));
  if (!doc.open) return null;

  const discoveryHash = await sha256hex(docBytes);
  const routeBodyHash = await sha256hex(b64urlDecode(doc.open.body));
  const envelopeObj = Envelope.parse({
    v: 2 as const,
    visibility: "public" as const,
    nonce: doc.open.envNonce,
    schema: METADATA_SCHEMA as typeof METADATA_SCHEMA,
    discoveryHash,
    routeBodyHash,
  });
  const envelopeBytes = new TextEncoder().encode(canonicalize(envelopeObj)!);

  return {
    secret: doc.open.secret.toLowerCase() as `0x${string}`,
    metaParts: {
      envelopeB64: b64urlEncode(envelopeBytes),
      discoveryB64: b64urlEncode(docBytes),
      bodyB64: doc.open.body,
    },
  };
}

/**
 * Link layout — dark keeps everything in the fragment (no ?e=, per the Dark
 * rules); public/preview expose only the discovery doc to servers/scrapers:
 *
 *   public/preview  /h/:id?e=<discoveryB64>#<payload{envelopeB64, bodyB64}>
 *   dark            /h/:id#<payload{envelopeB64, discoveryB64, bodyB64}>
 *
 * Open public hands omit ?e= — their doc now embeds the route body, which
 * would balloon the query string; the doc is pinned and every reader (SSR
 * included) can fetch it by the on-chain commitment instead.
 */
export function assembleLink(
  base: string,
  handId: bigint | string,
  parts: { envelopeB64: string; discoveryB64?: string; bodyB64: string },
  encodePayloadFn: (metadata: any) => string,
  visibility: "public" | "preview" | "dark",
  opts?: { omitDiscoveryParam?: boolean }
): string {
  const metadata = visibility === "dark"
    ? { envelopeB64: parts.envelopeB64, discoveryB64: parts.discoveryB64, bodyB64: parts.bodyB64 }
    : { envelopeB64: parts.envelopeB64, bodyB64: parts.bodyB64 };

  const payloadStr = encodePayloadFn(metadata);

  const url = new URL(`h/${handId}`, base.endsWith('/') ? base : base + '/');
  if (visibility !== "dark" && parts.discoveryB64 && !opts?.omitDiscoveryParam) {
    url.searchParams.set("e", parts.discoveryB64);
  }
  url.hash = payloadStr;
  return url.toString();
}

export function parseLink(urlStr: string, decodePayloadFn: (s: string) => any): {
  handId: bigint;
  envelopeB64: string;
  discoveryB64?: string;
  bodyB64: string;
  decodedPayload: any;
} {
  const url = new URL(urlStr, "http://localhost");
  const handIdMatch = url.pathname.match(/\/h\/(\d+)(?:\/|$)/);
  if (!handIdMatch) throw new Error("Invalid link path, missing handId");
  const handId = BigInt(handIdMatch[1]);

  if (!url.hash || url.hash.length < 2) throw new Error("Missing payload in URL fragment");
  const payloadStr = url.hash.slice(1);
  const decodedPayload = decodePayloadFn(payloadStr);

  const meta = decodedPayload.metadata as any;
  if (!meta || !meta.bodyB64) throw new Error("Payload missing bodyB64 metadata");
  if (!meta.envelopeB64) throw new Error("Payload missing envelopeB64 metadata");

  const queryE = url.searchParams.get("e");
  const metaD = meta.discoveryB64;

  if (queryE && metaD && queryE !== metaD) {
    throw new Error("Inconsistent link: discovery in query does not match fragment");
  }

  // Discovery is optional — a link with ?e= stripped still opens; the title
  // can be re-fetched via the on-chain discoveryRef later.
  const discoveryB64 = queryE || metaD || undefined;

  return {
    handId,
    envelopeB64: meta.envelopeB64,
    discoveryB64,
    bodyB64: meta.bodyB64,
    decodedPayload,
  };
}
