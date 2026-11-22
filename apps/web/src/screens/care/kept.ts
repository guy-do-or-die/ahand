import type { Hex } from "viem";

import type { HandRecord } from "../../store/db";
import { describeKept } from "../my/rebuild";

/** Whether the words this device keeps for its own Hand are the Hand's own (free of React and config, tested offline). */
export type DeviceCheck = "attached" | "mismatch" | "unknown";

/**
 * The kept words checked against Core's dataHash, with the inbox key when it is known and without
 * one in any case (a Hand raised where no relay was set up). "mismatch" only when the key is known,
 * since without it a non-match says nothing.
 */
export function checkKept(record: Pick<HandRecord, "mode" | "title" | "content" | "salt">, inbox: Hex | undefined, keyKnown: boolean, dataHash: Hex): DeviceCheck {
  const words = { mode: record.mode, title: record.title, ...(record.content !== undefined ? { content: record.content } : {}), ...(record.salt ? { salt: record.salt } : {}) };
  if (describeKept(words, inbox, dataHash)) return "attached";
  return keyKnown ? "mismatch" : "unknown";
}
