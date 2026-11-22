import { getAddress, numberToHex, ProviderRpcError, UserRejectedRequestError, type Address, type EIP1193Provider } from "viem";
import { createConnector, type CreateConnectorFn } from "wagmi";

import type { ChainConfig, PrivyConfig } from "../config/schema";
import { chainOf } from "../chain/clients";
import { markPrivy } from "./privy-mark";

/**
 * Logging in through Privy: one window, Privy's own, offers email, social
 * accounts (Google, Apple, X, Farcaster), a passkey, and crypto wallets (the browser's, found by
 * EIP-6963, and phone apps through WalletConnect). Someone who comes by email or a social account
 * gets a wallet Privy makes and keeps for them (its key lives inside Privy's frame on
 * auth.privy.io; this page never holds it); someone who comes with a crypto wallet keeps using it.
 * Either way the account is one wagmi connector over that wallet's EIP-1193 provider, so every money
 * action (raise, give, thank, refund, withdraw) goes through the same `connectedWallet()` → viem
 * wallet client → EIP-1193 `request` path as the local stand's wallets do.
 *
 * Privy's SDK is large, so this file holds only the connector and a small state store, and the
 * SDK is loaded by `privy-host.tsx` the first time someone presses "Log in" or an action that needs
 * an account, or once the page is idle when this browser holds the mark of a Privy session
 * (privy-mark.ts): a shared Hand's first paint never pays for it. The import of privy-host.tsx sits
 * in wallet/config.ts behind the build's `__AHAND_PRIVY__`, so a build without `privy` emits none
 * of Privy's code. If Privy cannot be reached (offline, blocked, this site not allowed in the Privy
 * dashboard), the connect fails with `PrivyUnavailableError` and the app says so; the browser's own
 * wallets are then offered on the app's own sheet.
 *
 * No wagmi adapter from Privy (@privy-io/wagmi) is used: it wants React providers around the app,
 * while the wallet layer is wagmi's actions on one store (state.ts). This connector only wraps the
 * EIP-1193 provider of the wallet the person logged in with.
 */

/**
 * The ways in Privy's window offers. Each must also be turned on in the Privy dashboard
 * (docs/public-test-deployment.md lists them); one that is off there is not shown.
 */
export type PrivyLoginMethod = "email" | "google" | "apple" | "twitter" | "farcaster" | "passkey" | "wallet";
export const PRIVY_METHODS: readonly PrivyLoginMethod[] = ["email", "google", "apple", "twitter", "farcaster", "passkey", "wallet"];

/*
 * Google, Apple and X leave this page: Privy sends the person to the provider and they come back
 * by a fresh load of the same address (Privy's SDK calls `window.location.assign`; it has no
 * pop-up for them). They are offered everywhere all the same, (since 2026-11-21:
 * email, social accounts and wallets in one window). What a fresh load would forget is handled
 * where it lives: the raise form is kept across that one trip (screens/raise/kept.ts), and so is an
 * opened link, in this tab's session storage only, erased on return (link-carry.ts,
 * the one exception to a reload forgetting an opened link). Where that storage refuses,
 * the screen says to open the link once more (`LinkAgain`).
 */

/** The connector's id and type: one per build that has `privy` in its configuration. */
export const PRIVY_ID = "privy";
export const PRIVY_TYPE = "privy";

/** The wallet a person is in with: Privy's own (email, social, passkey) or the crypto wallet they logged in with. */
export interface PrivySession {
  address: Address;
  provider: EIP1193Provider;
  /**
   * A wallet Privy keeps (email, social, passkey): it shows Privy's own confirmation window only
   * while the lens is on (privy-host.tsx, `showWalletUIs`). False for a crypto wallet, which shows
   * its own window for every request.
   */
  embedded: boolean;
  /** Moves the wallet to a chain the way Privy does (adding the chain to a crypto wallet that lacks it); else `wallet_switchEthereumChain`. */
  switchChain?(chainId: number): Promise<void>;
}

/** What the loaded host (privy-host.tsx) does for the connector. */
export interface PrivyHost {
  /**
   * Lets the person in: Privy's own window with these ways in when there is no session on this
   * device yet, then the wallet they are in with (Privy's own wallet is made on first entry).
   * Rejects with a 4001 when the person closes Privy's window, and with `PrivyUnavailableError`
   * when Privy does not answer.
   */
  signIn(methods: readonly PrivyLoginMethod[]): Promise<PrivySession>;
  /**
   * The session this device still holds, or the one a social login just brought back, without
   * opening any window; undefined when there is none or its wallet is not here.
   */
  restore(): Promise<PrivySession | undefined>;
  /** Ends the Privy session on this device. */
  signOut(): Promise<void>;
}

/** What `connect` may ask of this connector beyond wagmi's own parameters (state.ts passes it). */
export interface PrivyAsk {
  /** The ways in to offer; all by default. */
  methods?: readonly PrivyLoginMethod[];
  /** Restore a session this device holds, silently: no window opens, and nothing is asked of a crypto wallet. */
  restore?: boolean;
}

/** How the host is loaded: privy-host.tsx in the app, a fake in tests. */
export type PrivyLoader = (settings: PrivyConfig, chain: ChainConfig) => Promise<PrivyHost>;

/** Privy could not be loaded or did not answer: the app says logging in is unreachable now. */
export class PrivyUnavailableError extends Error {
  readonly code = "privy-unavailable";
  constructor(message = "Privy did not answer") {
    super(message);
    this.name = "PrivyUnavailableError";
  }
}

/**
 * Whether Privy's dashboard allows this site address, by the list the configuration expects it to
 * keep (`privy.origins`): an exact origin, or "https://*.host" for any address under host. With no list, yes.
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
 * Where logging in stands, for the app's one status line: "loading" while Privy's code and
 * settings come in and while the wallet is fetched after the person is in, "open" while Privy's
 * own window is on screen (the app shows nothing of its own then), "idle" otherwise.
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
 * The person's provider as the app sees it: every request passes through unchanged while the
 * session lasts, and after "Log out" every request is refused with 4100, so a screen that kept an
 * old wallet client cannot reach a session that has ended.
 */
export function guardedProvider(inner: EIP1193Provider): EIP1193Provider & { end(): void } {
  let ended = false;
  const request = (async (args: { method: string; params?: unknown }) => {
    if (ended) throw new ProviderRpcError(new Error("this Privy session has ended"), { code: 4100, shortMessage: "Unauthorized: the Privy session has ended." });
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
 * The Privy connector (`type: "privy"`). `load` (wallet/config.ts: privy-host.tsx and Privy's SDK,
 * in chunks of their own) is called once, on the first connect; a failed load is tried again on
 * the next. wagmi restores nothing on its own (`isAuthorized` is false, as for every wallet here:
 * storage is null); state.ts restores a session this device holds by a connect with
 * `privy: { restore: true }`, which opens no window.
 *
 * After the person is in, the wallet is asked to move to the build's chain: Privy's own wallet
 * moves at once; a crypto wallet shows its own window, and if the person says no it stays where it
 * is, connected, and the screens' own "switch to Base Sepolia" step takes over, as for any wallet.
 */
export function privyConnector(settings: PrivyConfig, chain: ChainConfig, load: PrivyLoader): CreateConnectorFn {
  const viemChain = chainOf(chain);
  return createConnector<EIP1193Provider>((wagmi) => {
    let host: Promise<PrivyHost> | undefined;
    let session: (Omit<PrivySession, "provider"> & { provider: ReturnType<typeof guardedProvider> }) | undefined;

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

    const move = async (to: NonNullable<typeof session>, chainId: number) => {
      if (to.switchChain) await to.switchChain(chainId);
      else await to.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] });
    };

    return {
      id: PRIVY_ID,
      name: "Privy",
      type: PRIVY_TYPE,
      /** The account is a wallet Privy keeps (email, social, passkey), whose window shows only with the lens on. */
      privyEmbedded(): boolean {
        return session?.embedded === true;
      },
      async connect(parameters) {
        const ask: PrivyAsk = (parameters as { privy?: PrivyAsk } | undefined)?.privy ?? {};
        if (!ask.restore) setPrivyPhase("loading");
        try {
          const h = await hostOf();
          const found = ask.restore ? await h.restore() : await h.signIn(ask.methods ?? PRIVY_METHODS);
          if (!found) {
            markPrivy(false);
            throw new UserRejectedRequestError(new Error("no Privy session on this device"));
          }
          end();
          session = { ...found, address: getAddress(found.address), provider: guardedProvider(found.provider) };
          const now = session;
          now.provider.on("accountsChanged", onAccounts as never);
          now.provider.on("chainChanged", onChain as never);
          let chainId = Number(await now.provider.request({ method: "eth_chainId" }));
          // A crypto wallet is asked only when the person has just logged in, never on a silent restore.
          if (chainId !== viemChain.id && (now.embedded || !ask.restore)) {
            try {
              await move(now, viemChain.id);
              chainId = Number(await now.provider.request({ method: "eth_chainId" }));
            } catch {
              // Said no, or the wallet could not: connected on its own chain; the screens ask again.
            }
          }
          markPrivy(true);
          const accounts = parameters?.withCapabilities ? [{ address: now.address, capabilities: {} }] : [now.address];
          return { accounts: accounts as never, chainId };
        } finally {
          if (!ask.restore) setPrivyPhase("idle");
        }
      },
      async disconnect() {
        const had = session !== undefined;
        end();
        markPrivy(false);
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
        if (!session) throw new UserRejectedRequestError(new Error("no Privy session"));
        return session.provider;
      },
      async isAuthorized() {
        return false;
      },
      async switchChain({ chainId }) {
        if (chainId !== viemChain.id) throw new ProviderRpcError(new Error(`only ${viemChain.name}`), { code: 4902, shortMessage: "Unrecognized chain." });
        if (!session) throw new UserRejectedRequestError(new Error("no Privy session"));
        await move(session, chainId);
        wagmi.emitter.emit("change", { chainId });
        return viemChain;
      },
      onAccountsChanged: onAccounts,
      onChainChanged: onChain,
      onDisconnect() {
        end();
        // The wallet itself ended the session: nothing to restore on the next visit.
        markPrivy(false);
        wagmi.emitter.emit("disconnect");
      },
    };
  });
}

/** Whether a wagmi connector is the Privy connector holding a wallet Privy keeps. */
export function isPrivyEmbedded(connector: unknown): boolean {
  const c = connector as { type?: string; privyEmbedded?: () => boolean } | undefined;
  return c?.type === PRIVY_TYPE && c.privyEmbedded?.() === true;
}
