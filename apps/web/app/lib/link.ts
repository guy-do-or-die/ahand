import type { Capability, HandRef, RouteContext } from "@ahand/sdk";
import { b64urlDecode, b64urlEncode } from "./metadata";
import type { Hand } from "./hand";

/**
 * Link-layer glue between the three-layer metadata split (metadata.ts) and
 * the v2 payload codec's two opaque metadata slots:
 *
 *   codec envelope slot — the canonical envelope bytes, because the route
 *     verifier recomputes sha256 over the envelope against the on-chain
 *     metadataCommitment. Public/preview links carry discovery in ?e=
 *     (outside the fragment), so their slot IS the bare envelope, byte for
 *     byte. Dark links forbid ?e= and would lose the title in transit, so
 *     their slot is a marked wrapper: 0x00 | u16 envelopeLen | envelope |
 *     discovery. Canonical envelope JSON always starts with "{" (0x7b), so
 *     the leading byte disambiguates the two shapes.
 *   codec body slot     — exactly the route-body bytes; the codec's 256-byte
 *     inline cap applies to the description alone in every visibility.
 */

export interface LinkMetadataParts {
  envelopeB64: string;
  discoveryB64?: string;
  bodyB64: string;
}

const ENVELOPE_JSON_FIRST_BYTE = 0x7b; // "{"
const WRAPPED_MARKER = 0x00;

export function packLinkMetadata(parts: LinkMetadataParts): {
  envelope: Uint8Array;
  body: Uint8Array;
} {
  const envelope = b64urlDecode(parts.envelopeB64);
  const body = b64urlDecode(parts.bodyB64);
  if (!parts.discoveryB64) return { envelope, body };

  const discovery = b64urlDecode(parts.discoveryB64);
  if (envelope.length > 0xffff) throw new Error("envelope too large for the link");
  const wrapped = new Uint8Array(3 + envelope.length + discovery.length);
  wrapped[0] = WRAPPED_MARKER;
  wrapped[1] = envelope.length >> 8;
  wrapped[2] = envelope.length & 0xff;
  wrapped.set(envelope, 3);
  wrapped.set(discovery, 3 + envelope.length);
  return { envelope: wrapped, body };
}

export function unpackLinkMetadata(metadata: {
  envelope: Uint8Array;
  body: Uint8Array;
}): LinkMetadataParts {
  const slot = metadata.envelope;
  const bodyB64 = b64urlEncode(metadata.body);
  if (slot.length === 0) throw new Error("link metadata envelope slot is empty");
  if (slot[0] === ENVELOPE_JSON_FIRST_BYTE) {
    return { envelopeB64: b64urlEncode(slot), bodyB64 };
  }
  if (slot[0] !== WRAPPED_MARKER || slot.length < 3)
    throw new Error("link metadata envelope slot is malformed");
  const envelopeLen = (slot[1] << 8) | slot[2];
  if (3 + envelopeLen > slot.length)
    throw new Error("link metadata envelope length overruns the slot");
  const envelope = slot.subarray(3, 3 + envelopeLen);
  const discovery = slot.subarray(3 + envelopeLen);
  return {
    envelopeB64: b64urlEncode(envelope),
    ...(discovery.length > 0 ? { discoveryB64: b64urlEncode(discovery) } : {}),
    bodyB64,
  };
}

/** Canonical HandRef for this deployment — one identity across sdk calls. */
export function handRefFor(
  chainId: number | bigint,
  core: `0x${string}`,
  handId: bigint,
): HandRef {
  return { chainId: BigInt(chainId), core, handId };
}

/** On-chain facts the codec reconstructs untransported fields from. */
export function routeContextFor(
  hand: Pick<Hand, "expiry" | "rootCapability">,
  handRef: HandRef,
): RouteContext {
  return {
    handRef,
    expiry: BigInt(hand.expiry),
    rootCapability: hand.rootCapability,
  };
}

/** The one secret-bearing shape links minted by this app use. */
export function bearerCapability(secret: `0x${string}`): Capability {
  return { mode: "bearer", secret };
}
