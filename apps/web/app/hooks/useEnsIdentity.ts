import { useEnsAvatar, useEnsName } from "wagmi";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { displayIdentity } from "../lib/ens";

/**
 * Resolve an address to its ENS identity (primary name + avatar).
 * Resolution always runs against mainnet — that's where names live —
 * regardless of the chain the app transacts on. Falls back gracefully
 * to a shortened address, so callers can render `display` unconditionally.
 */
export function useEnsIdentity(address?: `0x${string}` | null) {
  const { data: name } = useEnsName({
    address: address ?? undefined,
    chainId: mainnet.id,
    query: { enabled: Boolean(address), staleTime: 5 * 60_000, retry: 1 },
  });
  const { data: avatar } = useEnsAvatar({
    name: name ? normalize(name) : undefined,
    chainId: mainnet.id,
    query: { enabled: Boolean(name), staleTime: 5 * 60_000, retry: 1 },
  });
  return {
    name: name ?? null,
    avatar: avatar ?? null,
    display: displayIdentity(name, address),
  };
}
