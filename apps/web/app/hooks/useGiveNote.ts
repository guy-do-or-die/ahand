import { useEffect, useMemo, useState } from "react";
import { verifySolutionNote, type TerminalProofPayload } from "@ahand/sdk";
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
 * device holds the XMTP message (the link carries the seal, never the words;
 * the delivered copy also carries the salt that opens it).
 * Null when the inbox is off, still syncing, or the give arrived by link.
 */
export function useGiveNote(proof: TerminalProofPayload | null): GiveNote | null {
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
      verified:
        !!proof && verifySolutionNote(match.note, proof.give.give.solutionHash, proof.evidence),
      conversationId: match.conversationId,
    };
  }, [inbox, fragment, proof]);
}
