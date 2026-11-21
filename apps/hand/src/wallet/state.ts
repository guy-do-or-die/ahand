import { useSyncExternalStore } from "react";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import type { Config, Connector } from "wagmi";
import { connect, disconnect, getConnection, getConnectors, switchChain, watchConnection, watchConnectors } from "wagmi/actions";

import { config as app } from "../config";
import { pollMsOf } from "../config/schema";
import { chainOf } from "../chain/clients";
import { walletConfig } from "./config";
import { FALLBACK_ID } from "./fallback";
import { PRIVY_TYPE, privyUnavailable } from "./privy";
import type { DevRole, DevWho } from "./dev";
import { unknownNetwork } from "./errors";
import { safeIcon } from "./icons";
import type { SignedInWallet } from "./send";

/**
 * The wallet as screens see it: who is connected, on which chain, whether that account can send,
 * and the choices "Connect a wallet" offers. Built on wagmi's actions and one external store, so
 * no provider has to wrap the app and screens never touch wagmi.
 */

export { unknownNetwork } from "./errors";

export interface WalletState {
  /** False until the wallet configuration is made (one tick after first use). */
  ready: boolean;
  status: "disconnected" | "connecting" | "connected";
  address?: Address;
  chainId?: number;
  connectorId?: string;
  /** The wallet's own name for itself (never checked; see ConnectSheet). */
  name?: string;
  devRole?: DevRole;
  /** On the build's chain. */
  onChain: boolean;
  /** False for an account that cannot send (the dev wallet's "not set up yet"). */
  canSend: boolean;
  /**
   * An email account (Privy): it confirms on this page with no window of its own, so whatever it
   * confirms must stand on the app's own screen in both views.
   */
  email?: boolean;
}

export interface WalletOption {
  /** The connector's id. */
  id: string;
  name: string;
  /** A `data:` image, or none. */
  icon?: string;
  /** "email": Privy (wallet/privy.ts), offered only when the configuration has `privy`. */
  kind: "found" | "dev" | "email";
  /** `window.ethereum`, offered only when no wallet announced itself (wallet/config.ts). */
  fallback?: boolean;
  devRole?: DevRole;
  devWho?: DevWho;
}

interface Snapshot {
  state: WalletState;
  options: WalletOption[];
}

const listeners = new Set<() => void>();
let snapshot: Snapshot = { state: { ready: false, status: "disconnected", onChain: false, canSend: false }, options: [] };
let started: Promise<Config> | undefined;

function emit(next: Snapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

function optionOf(connector: Connector): WalletOption {
  const dev = connector.type === "dev";
  if (connector.type === PRIVY_TYPE) return { id: connector.id, name: connector.name, kind: "email" };
  const extra = connector as unknown as { devRole?: DevRole; devWho?: DevWho };
  const icon = dev ? undefined : safeIcon(connector.icon);
  return {
    id: connector.id,
    name: connector.name,
    kind: dev ? "dev" : "found",
    ...(!dev && connector.id === FALLBACK_ID ? { fallback: true } : {}),
    ...(icon ? { icon } : {}),
    ...(dev ? { devRole: extra.devRole, devWho: extra.devWho } : {}),
  };
}

function read(config: Config): Snapshot {
  const connection = getConnection(config);
  const connector = connection.connector;
  const extra = connector as unknown as { devRole?: DevRole } | undefined;
  const status = connection.status === "connected" ? "connected" : connection.status === "disconnected" ? "disconnected" : "connecting";
  const state: WalletState = {
    ready: true,
    status,
    onChain: connection.chainId === app.chain.id,
    canSend: status === "connected" && extra?.devRole !== "unset",
    ...(connection.address ? { address: connection.address } : {}),
    ...(connection.chainId !== undefined ? { chainId: connection.chainId } : {}),
    ...(connector ? { connectorId: connector.id, name: connector.name } : {}),
    ...(extra?.devRole ? { devRole: extra.devRole } : {}),
    ...(connector?.type === PRIVY_TYPE ? { email: true } : {}),
  };
  return { state, options: getConnectors(config).map(optionOf) };
}

function start(): Promise<Config> {
  started ??= walletConfig().then((config) => {
    const refresh = () => emit(read(config));
    watchConnection(config, { onChange: refresh });
    watchConnectors(config, { onChange: refresh });
    refresh();
    return config;
  });
  return started;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void start();
  return () => listeners.delete(listener);
}

/** Who is connected now; re-renders on every change. */
export function useWallet(): WalletState {
  return useSyncExternalStore(subscribe, () => snapshot.state);
}

/** What "Connect a wallet" offers: email (when configured), wallets this browser announced, then the dev accounts (local only). */
export function useWalletOptions(): WalletOption[] {
  return useSyncExternalStore(subscribe, () => snapshot.options);
}

export { foundOptions } from "./fallback";

/** "unavailable": email through Privy could not be reached (the browser's wallets still work). */
export type ConnectOutcome = { ok: true; address: Address } | { ok: false; reason: "refused" | "failed" | "unknown-network" | "unavailable" };

function said(error: unknown, code: number): boolean {
  let node: unknown = error;
  const seen = new Set<unknown>();
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    if ((node as { code?: unknown }).code === code) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

/** Connects the option with this id, on the build's chain. */
export async function connectWallet(id: string): Promise<ConnectOutcome> {
  const config = await start();
  const connector = getConnectors(config).find((c) => c.id === id);
  if (!connector) return { ok: false, reason: "failed" };
  const current = getConnection(config);
  if (current.status === "connected" && current.connector) await disconnect(config, { connector: current.connector }).catch(() => undefined);
  try {
    const result = await connect(config, { connector, chainId: app.chain.id });
    return { ok: true, address: result.accounts[0]! };
  } catch (error) {
    if (privyUnavailable(error)) return { ok: false, reason: "unavailable" };
    if (unknownNetwork(error)) return { ok: false, reason: "unknown-network" };
    return { ok: false, reason: said(error, 4001) ? "refused" : "failed" };
  }
}

export async function disconnectWallet(): Promise<void> {
  const config = await start();
  const { connector } = getConnection(config);
  if (connector) await disconnect(config, { connector });
}

/** Asks the connected wallet to move to the build's chain. */
export async function switchToAppChain(): Promise<boolean> {
  const config = await start();
  try {
    await switchChain(config, { chainId: app.chain.id });
    return true;
  } catch {
    return false;
  }
}

/** A viem wallet client over the connected wallet's own provider, or undefined when none is. */
export async function connectedWallet(): Promise<SignedInWallet | undefined> {
  const config = await start();
  const connection = getConnection(config);
  if (connection.status !== "connected" || !connection.address || !connection.connector) return undefined;
  const provider = (await connection.connector.getProvider()) as EIP1193Provider;
  // The chain's pace is its real block time (200 ms on Base), so viem's default polling would be
  // 500 ms; the app's own polling interval is set instead, as on every other client.
  return createWalletClient({ account: connection.address, chain: chainOf(app.chain), transport: custom(provider), pollingInterval: pollMsOf(app.chain) });
}

/** The address a dev account answers for (read from its own provider), or undefined for other wallets. */
export async function optionAddress(id: string): Promise<Address | undefined> {
  const config = await start();
  const connector = getConnectors(config).find((c) => c.id === id);
  if (!connector || connector.type !== "dev") return undefined;
  const provider = (await connector.getProvider()) as { address?: () => Promise<Address> };
  return provider.address?.();
}
