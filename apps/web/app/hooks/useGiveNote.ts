import { useEffect, useMemo, useState } from "react";
import { keccak256, toBytes } from "viem";
import { useGiveInbox } from "./useGiveInbox";
import type { InboxGive } from "../lib/xmtpClient";

export type GiveNote = {
  note: string;
  /** The words hash to the seal inside the signed Give — provably theirs. */
  verified: boolean;
  conversationId: string;
};

/**
 * The giver's actual words for the proof on this thank page, when this
 * device holds the XMTP message (the link itself only carries the seal).
 * Null when the inbox is off, still syncing, or the give arrived by link.
 */
export function useGiveNote(solutionHash?: string): GiveNote | null {
  const { inbox } = useGiveInbox();
  const [fragment, setFragment] = useState<string | null>(null);

  useEffect(() => {
    setFragment(window.location.hash.replace("#", "") || null);
  }, []);

  return useMemo(() => {
    if (!fragment || !inbox) return null;
    const match = inbox.gives.find((g: InboxGive) => g.fragment === fragment);
    if (!match || !match.note) return null;
    return {
      note: match.note,
      verified: Boolean(solutionHash) && keccak256(toBytes(match.note)) === solutionHash,
      conversationId: match.conversationId,
    };
  }, [inbox, fragment, solutionHash]);
}
