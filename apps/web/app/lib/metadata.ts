import { z } from "zod";
import canonicalize from "canonicalize";

const utf8len = (s: string) => new TextEncoder().encode(s).length;

export const CHARS_PER_HOP = 195;

export const Envelope = z.object({
  v: z.literal(1),
  visibility: z.enum(["public", "preview", "dark"]),
  nonce: z.string().min(22),
  preview: z
    .object({
      title: z.string().min(1).max(80),
      teaser: z.string().max(140).optional(),
    })
    .passthrough(),
  bodyHash: z.string().regex(/^0x[0-9a-f]{64}$/),
}).passthrough();

export const Body = z.object({
  description: z.string().refine((s) => utf8len(s) <= 1000, "at most 1000 bytes of UTF-8 (≈1000 latin / ≈500 cyrillic chars)"),
  contacts: z.string().max(500).optional(),
  image: z.string().url().optional(),
  nonce: z.string().min(22),
}).passthrough();

export type Envelope = z.infer<typeof Envelope>;
export type Body = z.infer<typeof Body>;

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
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hashHex}`;
}

export async function buildMetadata(input: {
  text: string;
  contacts?: string;
  image?: string;
  visibility: "public" | "preview" | "dark";
  opts?: { nonces?: { body: string; envelope: string } };
}): Promise<{
  envelope: Envelope;
  body: Body;
  envelopeBytes: Uint8Array;
  bodyBytes: Uint8Array;
  envelopeB64: string;
  bodyB64: string;
  metadataHash: `0x${string}`;
}> {
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

  const parsedBodyObj = Body.parse(bodyObj);
  const bodyCanonicalStr = canonicalize(parsedBodyObj)!;
  const bodyBytes = new TextEncoder().encode(bodyCanonicalStr);
  const bodyHash = await sha256hex(bodyBytes);

  const envelopeObj = {
    v: 1 as const,
    visibility: input.visibility,
    nonce: input.opts?.nonces?.envelope || newNonce(),
    preview: { title, ...(teaser ? { teaser } : {}) },
    bodyHash,
  };

  const parsedEnvelopeObj = Envelope.parse(envelopeObj);
  const envelopeCanonicalStr = canonicalize(parsedEnvelopeObj)!;
  const envelopeBytes = new TextEncoder().encode(envelopeCanonicalStr);
  const metadataHash = await sha256hex(envelopeBytes);

  return {
    envelope: parsedEnvelopeObj,
    body: parsedBodyObj,
    envelopeBytes,
    bodyBytes,
    envelopeB64: b64urlEncode(envelopeBytes),
    bodyB64: b64urlEncode(bodyBytes),
    metadataHash,
  };
}

export async function verifyMetadata(
  envelopeB64: string,
  bodyB64: string,
  onchainHash: `0x${string}`
): Promise<{ ok: true; envelope: Envelope; body: Body } | { ok: false; reason: string }> {
  try {
    const envelopeBytes = b64urlDecode(envelopeB64);
    const bodyBytes = b64urlDecode(bodyB64);

    const calcEnvHash = await sha256hex(envelopeBytes);
    if (calcEnvHash !== onchainHash) {
      return { ok: false, reason: "Envelope hash mismatch with on-chain anchor" };
    }

    const envelopeStr = new TextDecoder().decode(envelopeBytes);
    const rawEnvelope = JSON.parse(envelopeStr);
    const envelope = Envelope.parse(rawEnvelope);

    const calcBodyHash = await sha256hex(bodyBytes);
    if (calcBodyHash !== envelope.bodyHash) {
      return { ok: false, reason: "Body hash mismatch with envelope anchor" };
    }

    const bodyStr = new TextDecoder().decode(bodyBytes);
    const rawBody = JSON.parse(bodyStr);
    const body = Body.parse(rawBody);

    return { ok: true, envelope, body };
  } catch (err: any) {
    return { ok: false, reason: `Verification error: ${err.message}` };
  }
}

export function assembleLink(
  base: string,
  handId: bigint | string,
  parts: { envelopeB64: string; bodyB64: string },
  encodePayloadFn: (metadata: any) => string,
  visibility: "public" | "preview" | "dark"
): string {
  const metadata = visibility === "dark" 
    ? { envelopeB64: parts.envelopeB64, bodyB64: parts.bodyB64 }
    : { bodyB64: parts.bodyB64 };

  const payloadStr = encodePayloadFn(metadata);

  const url = new URL(`h/${handId}`, base.endsWith('/') ? base : base + '/');
  if (visibility !== "dark") {
    url.searchParams.set("e", parts.envelopeB64);
  }
  url.hash = payloadStr;
  return url.toString();
}

export function parseLink(urlStr: string, decodePayloadFn: (s: string) => any): {
  handId: bigint;
  envelopeB64: string;
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

  const queryE = url.searchParams.get("e");
  const metaE = meta.envelopeB64;
  
  if (queryE && metaE && queryE !== metaE) {
    throw new Error("Inconsistent link: envelope in query does not match fragment");
  }

  const envelopeB64 = queryE || metaE;
  if (!envelopeB64) throw new Error("Missing envelopeB64 in query or fragment");

  return {
    handId,
    envelopeB64,
    bodyB64: meta.bodyB64,
    decodedPayload,
  };
}

export async function resolvePublicMetadata(hash: `0x${string}`): Promise<Uint8Array | null> {
  // TODO: fetch from IPFS/Pinata using the anchor hash
  return null;
}
