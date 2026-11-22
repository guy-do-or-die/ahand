import { createContext, useContext, type ReactNode } from "react";

import { useLens } from "./ambient";

export interface ProofProps {
  /** The evidence: mono lines, marks, block numbers, addresses, Core's own names. */
  children: ReactNode;
  /**
   * What stands in its place while the lens is off, in plain words: "someone" for an address,
   * a sentence for a count of requests. Left out, nothing stands there.
   */
  calm?: ReactNode;
}

/**
 * The one switch between the calm view and the lens. With the lens off (the
 * default) a screen speaks in plain sentences, amounts and dates, and the chain's machinery
 * stays out of sight; with it on, the evidence stands where it always stood.
 *
 * Only proof goes behind it. What a person needs to act safely (a warning, an error, the
 * test-network ribbon, a fee they pay, a refusal and its reason, that the asker's words are
 * not checked) never does: those stay in plain words whatever the lens says.
 */
export function Proof({ children, calm }: ProofProps) {
  const shown = useShown();
  return <>{shown ? children : (calm ?? null)}</>;
}

const OnProofPage = createContext(false);

/**
 * A page whose subject is the proof (the passport, /check, /core): its evidence is drawn whatever
 * the lens says, as it was before the calm view existed, with each disclosure and mark closed
 * until it is opened. The lens still opens every one of them in place.
 */
export function ProofPage({ children }: { children: ReactNode }) {
  return <OnProofPage.Provider value={true}>{children}</OnProofPage.Provider>;
}

/** Whether evidence is drawn here: under the lens, or anywhere on a proof page. */
export function useShown(): boolean {
  const lens = useLens();
  return useContext(OnProofPage) || lens;
}
