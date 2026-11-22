import { UntrustedCore } from "./chain.js";
import { isCoreRefusal, type CoreRefusal } from "./errors.js";
import { LinkError } from "./link.js";
import type { PriceSnapshot } from "./money.js";
import { Refusal } from "./verify.js";

/**
 * `@ahand/sdk/app`: choices of an application built on the protocol, not rules of the protocol.
 * Another application may choose otherwise; nothing in the rest of the SDK depends on these.
 */

/**
 * The most characters the base64url `d` part (the public part) of a public address may take:
 * 8,192, counted as `describeHand` counts them, on the packed attachments written in base64url.
 * Base64url is ASCII, so each character is one byte of the request line, and the packed
 * attachments it carries are three quarters of it. Everything before `#` travels in the request
 * line a browser or a preview robot sends. A server with Bun's default header limit (about
 * 16 KiB) answers 431 to an address of about 16,000 characters before `#`, so a public Hand with
 * about 12 kB of words stopped opening at all. Half of that limit leaves room for the site, the
 * path and whatever a messenger adds.
 *
 * Pass it to `describeHand` as `{ publicPartMaxChars: PUBLIC_PART_MAX_CHARS }`.
 */
export const PUBLIC_PART_MAX_CHARS = 8192;

/**
 * The dated price snapshot this application shows costs with (`costOf`): always with its date,
 * never as a quote. From a fee study of 2026-11-10: Base's base fee was 0.005 gwei plus a tip
 * (read live on 2026-11-09 at 23:52 UTC); Ethereum is at its 2026 average of 0.3 gwei; ETH at
 * $2,400 (quoted at $2,417 on 2026-11-05).
 */
export const PRICES: PriceSnapshot = {
  date: "2026-11-10",
  ethUsd: 2400,
  base: { gwei: 0.006 },
  ethereum: { gwei: 0.3 },
  source: "aHand fee study of 2026-11-10: Base base fee 0.005 gwei plus tip, live on 2026-11-09 23:52 UTC; Ethereum at the 2026 average of 0.3 gwei; ETH at $2,400 (quoted at $2,417 on 2026-11-05)",
};

/**
 * The message id a screen shows for a failure: "core.<error>" for Core's refusals and for the
 * SDK's offline `Refusal` (the same errors, predicted), "link.<code>" for a link that cannot be
 * read (among them "link.unsupported" for a newer format and "link.no-canonical-core" for a link
 * that names the canonical Core where the reader was told it knows none), and "link.untrusted"
 * for a contract this site does not read. The position is not part of the id: the sentence takes
 * it as a value.
 *
 * The ids follow `LinkErrorCode` exactly, so a renamed code renames its id: when the application's
 * i18n catalogue arrives with the app, its keys move with them ("link.no-canonical" became
 * "link.no-canonical-core").
 */
export function messageIdOf(e: CoreRefusal | LinkError | Refusal | UntrustedCore): string {
  if (e instanceof UntrustedCore) return "link.untrusted";
  if (e instanceof LinkError) return `link.${e.code}`;
  if (e instanceof Refusal) return `core.${e.error}`;
  if (isCoreRefusal(e)) return `core.${e.name}`;
  throw new TypeError("messageIdOf: not a CoreRefusal, LinkError, Refusal or UntrustedCore");
}
