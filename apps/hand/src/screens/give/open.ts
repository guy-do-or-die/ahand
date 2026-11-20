import { CoreRefused, getHandFor, LinkError, messageIdOf, openAddress, UntrustedCore, type LinkOptions, type OpenedAddress } from "@ahand/sdk";
import { useEffect, useState } from "react";

import { CLIENTS } from "../../chain";
import { config } from "../../config";
import { isNetworkError } from "./answer";
import type { OpenedLink } from "../../store/memory";

/**
 * The link this tab holds (store/memory.ts), opened as every screen opens one: the SDK's
 * `openAddress` against the Cores this build trusts, failing closed with the sentence of its
 * error. A link pasted without the address before it is read as a bare address of this site.
 */

export const LINK_OPTIONS: LinkOptions = config.cores.canonical ? { canonicalCore: config.cores.canonical } : {};

export type Opening = { status: "none" } | { status: "opening" } | { status: "open"; opened: OpenedAddress } | { status: "error"; messageId: string };

function whole(link: OpenedLink): string {
  return `${link.before || `${config.site}/`}#${link.fragment}`;
}

function messageOf(error: unknown): string {
  if (error instanceof LinkError || error instanceof UntrustedCore || error instanceof CoreRefused) return messageIdOf(error);
  if (isNetworkError(error)) return "common.time.offline";
  return "link.malformed";
}

export function useOpening(link: OpenedLink | undefined): Opening {
  const [state, setState] = useState<{ link?: OpenedLink; opening: Opening }>({ opening: { status: "none" } });
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
  }, [link]);
  if (!link) return { status: "none" };
  return state.link === link ? state.opening : { status: "opening" };
}
