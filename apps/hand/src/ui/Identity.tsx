import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { shortAddress } from "./format";

export interface IdentityProps {
  address: Address;
  /**
   * A name for the address, only when the caller has proved it: an ENS name that resolves to
   * this address and back (UX-SPEC §4). The kit resolves nothing itself.
   */
  name?: string;
  /** The whole address on its own line instead of the short form. */
  full?: boolean;
  className?: string;
}

/**
 * An address as it stands on screen: in mono, because it is exact data, with its own capitals.
 * A proved name stands before it in the human voice; the address is never replaced by a name.
 */
export function Identity({ address, name, full = false, className }: IdentityProps) {
  return (
    <span className={clsx("inline-flex max-w-full flex-wrap items-baseline gap-x-[6px]", className)}>
      {name ? <span className="ah-label">{name}</span> : null}
      <span className="ah-meta ah-meta--exact" title={full ? undefined : address}>
        {full ? address : shortAddress(address)}
      </span>
    </span>
  );
}
