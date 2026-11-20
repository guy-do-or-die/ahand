import type { Hex } from "viem";

import type { AddressShape, OpenedAddress } from "./address.js";
import type { Attachments, OpenedLink } from "./link.js";

// Wave 1 stub: the signatures are the contract between packages (ARCHITECTURE §4);
// the module `sdk-words` writes the bodies in wave 2.

/** How much of a description stands before `#`: all of it, the title, or nothing. */
export type DescribeMode = "public" | "unlisted" | "dark";

export interface Description {
  mode: DescribeMode;
  title: string;
  content?: string;
  /** The Hand's inbox: a 32-byte x-only public key (`inbox.n1`). */
  inbox?: Hex;
  salt?: Hex;
}

function notBuilt(name: string): never {
  throw new Error(`${name}: not built`);
}

/** NFC, LF line ends; applied to input before hashing and attaching. */
export function normalizeText(_input: string): string {
  return notBuilt("normalizeText");
}

export function describeHand(_d: Description): {
  dataHash: Hex;
  shape: AddressShape;
  inside?: Attachments;
  outside?: Attachments;
} {
  return notBuilt("describeHand");
}

/** From `opened.ofHand` only. */
export function readDescription(_opened: OpenedLink): {
  status: "none" | "attached" | "lost";
  title?: string;
  content?: string;
  inbox?: Hex;
} {
  return notBuilt("readDescription");
}

/** What a holder passes on: the same shape, or bare. */
export function carryFor(_opened: OpenedAddress, _shape: AddressShape): { attachments: Attachments; outside?: Attachments } {
  return notBuilt("carryFor");
}

/** Only towards bare. */
export function canReshape(_from: AddressShape, _to: AddressShape): boolean {
  return notBuilt("canReshape");
}
