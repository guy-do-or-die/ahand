import { getAddress, numberToHex, ProviderRpcError, UserRejectedRequestError, type Address, type EIP1193Provider } from "viem";
import { createConnector, type CreateConnectorFn } from "wagmi";

import type { ChainConfig, PrivyConfig } from "../config/schema";
import { chainOf } from "../chain/clients";

/**
 * Email through Privy (ARCHITECTURE §7 Wallets): a person without a crypto app gets a code by
 * email, and Privy makes and keeps a wallet for them (its key lives inside Privy's frame on
 * auth.privy.io; this page never holds it). It is one more wagmi connector beside the browser's
 * wallets, so every money action (raise, give, thank, refund, withdraw) goes through the same
 * `connectedWallet()` → viem wallet client → EIP-1193 `request` path as an injected wallet does.
 *
 * Privy's SDK is large, so this file holds only the connector and a small state store, and the
 * SDK is loaded by `privy-host.tsx` the first time someone picks email: a shared Hand's first
 * paint never pays for it. The import of privy-host.tsx sits in wallet/config.ts behind the build's
 * `__AHAND_PRIVY__`, so a build without `privy` emits none of Privy's code. If Privy cannot be reached (offline, blocked, this site not allowed in
 * the Privy dashboard), the connect fails with `PrivyUnavailableError` and the sheet says so; the
 * browser's own wallets work as before.
 *
 * No wagmi adapter from Privy (@privy-io/wagmi) is used: it wants React providers around the app,
 * while the wallet layer is wagmi's actions on one store (state.ts). This connector only wraps the
 * EIP-1193 provider of the person's Privy wallet.
 */

/** The connector's id and type: one per build that has `privy` in its configuration. */
export const PRIVY_ID = "privy";
export const PRIVY_TYPE = "privy";

/** What the loaded host (privy-host.tsx) does for the connector. */
export interface PrivyHost {
  /**
   * Lets the person in: Privy's own email window when there is no session on this device yet,
   * then their Privy wallet (made on first entry), moved to the build's chain.
   * Rejects with a 4001 when the person closes Privy's window, and with `PrivyUnavailableError`
   * when Privy does not answer.
   */
  signIn(): Promise<{ address: Address; provider: EIP1193Provider }>;
  /** Ends the Privy session on this device. */
  signOut(): Promise<void>;
}

/** How the host is loaded: privy-host.tsx in the app, a fake in tests. */
export type PrivyLoader = (settings: PrivyConfig, chain: ChainConfig) => Promise<PrivyHost>;

/** Privy could not be loaded or did not answer: the sheet says email is unreachable now. */
export class PrivyUnavailableError extends Error {
  readonly code = "privy-unavailable";
  constructor(message = "Privy did not answer") {
    super(message);
    this.name = "PrivyUnavailableError";
  }
}

/**
 * Whether Privy's dashboard allows this site address, by the list the configuration copies from
 * it: an exact origin, or "https://*.host" for any address under host. With no list, yes.
 */
export function privyAllowsOrigin(settings: PrivyConfig, origin: string): boolean {
  if (!settings.origins) return true;
  return settings.origins.some((allowed) => {
    if (!allowed.startsWith("https://*.")) return allowed === origin;
    const suffix = allowed.slice("https://*".length);
    return origin.startsWith("https://") && origin.endsWith(suffix) && origin.length > "https://".length + suffix.length;
  });
}

/** Whether an error, or one it wraps, is `PrivyUnavailableError`. */
export function privyUnavailable(error: unknown): boolean {
  let node: unknown = error;
  const seen = new Set<unknown>();
  while (node && typeof node === "object" && !seen.has(node)) {
    seen.add(node);
    if ((node as { code?: unknown }).code === "privy-unavailable") return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Where the email step stands, for the sheet: "loading" while Privy's code and settings come in,
 * "open" while Privy's own window is on screen (the sheet steps aside: a modal <dialog> would
 * make Privy's window unreachable), "idle" otherwise.
 */
export type PrivyPhase = "idle" | "loading" | "open";

let phase: PrivyPhase = "idle";
const phaseListeners = new Set<() => void>();

export function privyPhase(): PrivyPhase {
  return phase;
}

export function setPrivyPhase(next: PrivyPhase): void {
  if (next === phase) return;
  phase = next;
  for (const listener of [...phaseListeners]) listener();
}

export function watchPrivyPhase(listener: () => void): () => void {
  phaseListeners.add(listener);
  return () => phaseListeners.delete(listener);
}

type Listener = (...args: unknown[]) => void;

/**
 * The person's Privy provider as the app sees it: every request passes through unchanged while
 * the session lasts, and after "Disconnect" every request is refused with 4100, so a screen that
 * kept an old wallet client cannot reach a session that has ended.
 */
export function guardedProvider(inner: EIP1193Provider): EIP1193Provider & { end(): void } {
  let ended = false;
  const request = (async (args: { method: string; params?: unknown }) => {
    if (ended) throw new ProviderRpcError(new Error("this email session has ended"), { code: 4100, shortMessage: "Unauthorized: the email session has ended." });
    return inner.request(args as never);
  }) as EIP1193Provider["request"];
  return {
    request,
    on: ((event: string, listener: Listener) => inner.on(event as never, listener as never)) as EIP1193Provider["on"],
    removeListener: ((event: string, listener: Listener) => inner.removeListener(event as never, listener as never)) as EIP1193Provider["removeListener"],
    end() {
      ended = true;
    },
  };
}

/**
 * The email connector (`type: "privy"`). `load` (wallet/config.ts: privy-host.tsx and Privy's SDK,
 * in chunks of their own) is called once, on the first connect; a failed
 * load is tried again on the next. Nothing is restored on its own after a reload (`isAuthorized`
 * is false, as for every wallet here: storage is null), but a Privy session that is still open
 * on this device lets the next "Continue with email" through without a new code.
 */
export function privyConnector(settings: PrivyConfig, chain: ChainConfig, load: PrivyLoader): CreateConnectorFn {
  const viemChain = chainOf(chain);
  return createConnector<EIP1193Provider>((wagmi) => {
    let host: Promise<PrivyHost> | undefined;
    let session: { address: Address; provider: ReturnType<typeof guardedProvider> } | undefined;

    const onAccounts = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? (accounts as string[]) : [];
      if (list.length === 0) wagmi.emitter.emit("disconnect");
      else wagmi.emitter.emit("change", { accounts: list.map((a) => getAddress(a)) });
    };
    const onChain = (id: unknown) => wagmi.emitter.emit("change", { chainId: Number(id) });

    const hostOf = (): Promise<PrivyHost> => {
      host ??= load(settings, chain).catch((error: unknown) => {
        host = undefined;
        throw error instanceof PrivyUnavailableError ? error : new PrivyUnavailableError(error instanceof Error ? error.message : String(error));
      });
      return host;
    };

    const end = () => {
      if (!session) return;
      session.provider.removeListener("accountsChanged", onAccounts as never);
      session.provider.removeListener("chainChanged", onChain as never);
      session.provider.end();
      session = undefined;
    };

    return {
      id: PRIVY_ID,
      name: "Email",
      type: PRIVY_TYPE,
      async connect(parameters) {
        setPrivyPhase("loading");
        try {
          const { address, provider } = await (await hostOf()).signIn();
          end();
          session = { address: getAddress(address), provider: guardedProvider(provider) };
          session.provider.on("accountsChanged", onAccounts as never);
          session.provider.on("chainChanged", onChain as never);
          const chainId = Number(await session.provider.request({ method: "eth_chainId" }));
          const accounts = parameters?.withCapabilities ? [{ address: session.address, capabilities: {} }] : [session.address];
          return { accounts: accounts as never, chainId };
        } finally {
          setPrivyPhase("idle");
        }
      },
      async disconnect() {
        const had = session !== undefined;
        end();
        if (had && host) await (await host).signOut().catch(() => undefined);
      },
      async getAccounts() {
        return session ? [session.address] : [];
      },
      async getChainId() {
        if (!session) return viemChain.id;
        return Number(await session.provider.request({ method: "eth_chainId" }));
      },
      async getProvider() {
        if (!session) throw new UserRejectedRequestError(new Error("no email session"));
        return session.provider;
      },
      async isAuthorized() {
        return false;
      },
      async switchChain({ chainId }) {
        if (chainId !== viemChain.id) throw new ProviderRpcError(new Error(`only ${viemChain.name}`), { code: 4902, shortMessage: "Unrecognized chain." });
        if (!session) throw new UserRejectedRequestError(new Error("no email session"));
        await session.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] });
        wagmi.emitter.emit("change", { chainId });
        return viemChain;
      },
      onAccountsChanged: onAccounts,
      onChainChanged: onChain,
      onDisconnect() {
        end();
        wagmi.emitter.emit("disconnect");
      },
    };
  });
}
