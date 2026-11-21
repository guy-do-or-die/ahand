import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { useLens } from "./ambient";
import { shortAddress } from "./format";
import { useWords } from "./words";

export interface IdentityProps {
  address: Address;
  /**
   * A name for the address, only when the caller has proved it: an ENS name that resolves to
   * this address and back (UX-SPEC §4). The kit resolves nothing itself.
   */
  name?: string;
  /** The whole address on its own line instead of the short form. */
  full?: boolean;
  /**
   * The viewer's own account, or one they are about to pick. It is not proof about someone else:
   * it is how a person knows which account they use, so it stands in both views.
   */
  own?: boolean;
  className?: string;
}

/**
 * An address as it stands on screen: in mono, because it is exact data, with its own capitals.
 * A proved name stands before it in the human voice; the address is never replaced by a name.
 *
 * The short form is proof of who someone is, so the calm view (lens off) says the proved name,
 * or "someone", in its place. The whole address (`full`) is what a person checks before money
 * lands there, and the viewer's own account (`own`) is how they know which one they use, so both
 * stand in both views.
 */
export function Identity({ address, name, full = false, own = false, className }: IdentityProps) {
  const lens = useLens();
  const words = useWords();
  if (!full && !own && !lens) return <span className={clsx("ah-label", className)}>{name ?? words.rail.someone}</span>;
  return (
    <span className={clsx("inline-flex max-w-full flex-wrap items-baseline gap-x-[6px]", className)}>
      {name ? <span className="ah-label">{name}</span> : null}
      <span className="ah-meta ah-meta--exact" title={full ? undefined : address}>
        {full ? address : shortAddress(address)}
      </span>
    </span>
  );
}
