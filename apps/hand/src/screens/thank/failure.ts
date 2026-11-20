import { LinkError, UntrustedCore, decodeCoreError, messageIdOf } from "@ahand/sdk";

import { isNetworkError } from "../../chain/errors";

export type CheckFailure =
  /** The sentence's message id (`link.*`, `core.*`, or this screen's own), and Core's or the link's name for it. */
  { messageId: string; code?: string; kind: "link" | "core" | "offline" | "not-give" | "no-forwarder" };

/**
 * What the thank's check says when opening the link or asking Core failed: the link's own reason,
 * Core's refusal by name, "Can't reach the network right now." only when the network did not
 * answer (the app's one `isNetworkError`), and otherwise that the check failed, never "offline".
 */
export function failureOf(error: unknown): CheckFailure {
  if (error instanceof LinkError || error instanceof UntrustedCore) {
    return { kind: "link", messageId: messageIdOf(error), code: error instanceof LinkError ? error.code : "untrusted" };
  }
  const refusal = decodeCoreError(error);
  if (refusal) return { kind: "core", messageId: `core.${refusal.name}`, code: refusal.name };
  if (isNetworkError(error)) return { kind: "offline", messageId: "common.time.offline" };
  return { kind: "core", messageId: "thank.error.checkFailed" };
}
