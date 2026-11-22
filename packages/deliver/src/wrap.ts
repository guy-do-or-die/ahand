/**
 * NIP-17 on its own: an envelope becomes a kind 14 rumor, sealed as kind 13 by the sender's chat key,
 * gift-wrapped as kind 1059 by a throwaway key, each layer encrypted with NIP-44 v2 to the recipient.
 */
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import { createRumor, createSeal, createWrap } from "nostr-tools/nip59";
import { getEventHash, getPublicKey, verifyEvent, type NostrEvent } from "nostr-tools/pure";
import { bare, checkEnvelope, prefixed, secretBytes, type Envelope, type Hex } from "./envelope.ts";

export const RUMOR_KIND = 14;
export const SEAL_KIND = 13;
export const GIFT_WRAP_KIND = 1059;
/**
 * NIP-59 back-dates the seal and the wrap by up to two days, so a relay filter on `since` must
 * reach that far back; the rumor's own time is then compared with what the caller asked for.
 */
export const WRAP_BACKDATE = 2 * 24 * 60 * 60;
/**
 * The largest gift wrap read. NIP-44 v2 itself allows far more; this only stops a hostile relay
 * from making the reader decrypt megabytes. A 2 000-byte give link wraps to about 5 kB.
 */
export const MAX_WRAP_CHARS = 1 << 20;

/** A received envelope with who sent it (the seal's author) and the rumor's id and time. */
export interface Opened {
  envelope: Envelope;
  from: Hex;
  id: string;
  at: number;
}

/**
 * Wraps `envelope` to the x-only key `to`, signed by `secret`. `at` (seconds) is the rumor's time:
 * passing the same one again gives the same rumor id, which is how a retry stays one message.
 * Returns the gift wrap to publish and that rumor id.
 */
export function wrapEnvelope(to: string, envelope: Envelope, secret: string, at?: number): { wrap: NostrEvent; id: string } {
  const recipient = bare(to, "to");
  const sk = secretBytes(secret);
  const clean = checkEnvelope(envelope);
  if (prefixed(getPublicKey(sk)) !== clean.replyTo) {
    throw new Error("envelope: replyTo must be the sender's own chat key");
  }
  const rumor = createRumor(
    {
      kind: RUMOR_KIND,
      content: JSON.stringify(clean),
      tags: [["p", recipient]],
      ...(at === undefined ? {} : { created_at: at }),
    },
    sk,
  );
  return { wrap: createWrap(createSeal(rumor, sk, recipient), recipient), id: rumor.id };
}

/**
 * A clean copy of `value` (only the event's own fields, so no flag cached on the object is
 * trusted) if it is a gift wrap whose id is the hash of its fields and whose signature verifies;
 * otherwise undefined. A relay can send anything under a real id; only a copy that passes this is
 * the event that id names.
 */
export function verifiedWrap(value: unknown): NostrEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const e = value as Record<string, unknown>;
  if (
    e.kind !== GIFT_WRAP_KIND ||
    typeof e.id !== "string" ||
    typeof e.pubkey !== "string" ||
    typeof e.sig !== "string" ||
    typeof e.content !== "string" ||
    !Number.isSafeInteger(e.created_at) ||
    !Array.isArray(e.tags) ||
    !e.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))
  ) {
    return undefined;
  }
  const copy: NostrEvent = {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at as number,
    kind: GIFT_WRAP_KIND,
    tags: e.tags as string[][],
    content: e.content,
    sig: e.sig,
  };
  return verifyEvent(copy) ? copy : undefined;
}

function open(event: NostrEvent, sk: Uint8Array): unknown {
  if (typeof event.content !== "string" || event.content.length > MAX_WRAP_CHARS) throw new Error("unwrap: too large");
  if (typeof event.pubkey !== "string") throw new Error("unwrap: no author");
  return JSON.parse(decrypt(event.content, getConversationKey(sk, event.pubkey)));
}

/**
 * Opens a gift wrap with `secret`, or throws saying why. Checks, in order: the wrap's kind and size;
 * the wrap's own id and signature (`verifiedWrap`); NIP-44 decryption of the wrap (a third key fails here); the seal's kind and signature; decryption
 * of the seal; that the seal's author wrote the rumor; the rumor's kind, id and recipient tag; the
 * envelope's shape; and that `replyTo` is the sender's key.
 */
export function unwrapEnvelope(wrap: NostrEvent, secret: string): Opened {
  if (!wrap || wrap.kind !== GIFT_WRAP_KIND) throw new Error("unwrap: not a gift wrap");
  if (typeof wrap.content !== "string" || wrap.content.length > MAX_WRAP_CHARS) throw new Error("unwrap: too large");
  const checked = verifiedWrap(wrap);
  if (!checked) throw new Error("unwrap: the wrap's id or signature is invalid");
  const sk = secretBytes(secret);
  const seal = open(checked, sk) as NostrEvent;
  if (!seal || seal.kind !== SEAL_KIND) throw new Error("unwrap: not a seal");
  const fields = {
    id: seal.id,
    pubkey: seal.pubkey,
    created_at: seal.created_at,
    kind: seal.kind,
    tags: seal.tags,
    content: seal.content,
    sig: seal.sig,
  };
  if (!verifyEvent(fields)) throw new Error("unwrap: the seal's signature is invalid");
  const rumor = open(seal, sk) as NostrEvent;
  if (!rumor || rumor.pubkey !== seal.pubkey) throw new Error("unwrap: the seal's author did not write the rumor");
  if (rumor.kind !== RUMOR_KIND) throw new Error("unwrap: not a direct message");
  if (!Array.isArray(rumor.tags) || typeof rumor.content !== "string" || !Number.isSafeInteger(rumor.created_at)) {
    throw new Error("unwrap: malformed rumor");
  }
  if (getEventHash(rumor) !== rumor.id) throw new Error("unwrap: rumor id does not match");
  const me = getPublicKey(sk);
  if (!rumor.tags.some((t) => Array.isArray(t) && t[0] === "p" && t[1] === me)) {
    throw new Error("unwrap: not addressed to this key");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rumor.content);
  } catch {
    throw new Error("unwrap: content is not an envelope");
  }
  const envelope = checkEnvelope(parsed);
  const from = prefixed(rumor.pubkey);
  if (envelope.replyTo !== from) throw new Error("unwrap: replyTo is not the sender's key");
  return { envelope, from, id: rumor.id, at: rumor.created_at };
}
