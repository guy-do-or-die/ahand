import { CoreRefused, getHandFor, LinkError, messageIdOf, openAddress, UntrustedCore, type LinkOptions, type OpenedAddress } from "@ahand/sdk";
import { useCallback, useEffect, useState } from "react";

import { CLIENTS } from "../../chain";
import { config } from "../../config";
import { isNetworkError } from "../../chain/errors";
import type { OpenedLink } from "../../store/memory";

/**
 * The link this tab holds (store/memory.ts), opened as every screen opens one: the SDK's
 * `openAddress` against the Cores this build trusts, failing closed with the sentence of its
 * error. A link pasted without the address before it is read as a bare address of this site.
 */

export const LINK_OPTIONS: LinkOptions = config.cores.canonical ? { canonicalCore: config.cores.canonical } : {};

export type Opening = { status: "none" } | { status: "opening" } | { status: "open"; opened: OpenedAddress } | { status: "error"; messageId: string };

/** Whether an opening failed only because the network did not answer: worth trying again. */
export function isOffline(opening: Opening): boolean {
  return opening.status === "error" && opening.messageId === "common.time.offline";
}

function whole(link: OpenedLink): string {
  return `${link.before || `${config.site}/`}#${link.fragment}`;
}

function messageOf(error: unknown): string {
  if (error instanceof LinkError || error instanceof UntrustedCore || error instanceof CoreRefused) return messageIdOf(error);
  if (isNetworkError(error)) return "common.time.offline";
  return "link.malformed";
}

/**
 * Opens the tab's link. When the network did not answer, `retry` opens it again, and so does the
 * browser coming back online (FINDINGS U-1): the link stays in this tab meanwhile.
 */
export function useOpening(link: OpenedLink | undefined): Opening & { retry: () => void } {
  const [state, setState] = useState<{ link?: OpenedLink; opening: Opening }>({ opening: { status: "none" } });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!link) return;
    let live = true;
    setState({ link, opening: { status: "opening" } });
    openAddress(whole(link), getHandFor(CLIENTS, config.cores.trusted), LINK_OPTIONS).then(
      (opened) => live && setState({ link, opening: { status: "open", opened } }),
      (error: unknown) => live && setState({ link, opening: { status: "error", messageId: messageOf(error) } }),
    );
    return () => {
      live = false;
    };
  }, [link, attempt]);
  const opening: Opening = !link ? { status: "none" } : state.link === link ? state.opening : { status: "opening" };
  const offline = isOffline(opening);
  useEffect(() => {
    if (!offline || typeof window === "undefined") return;
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [offline, retry]);
  return { ...opening, retry };
}
