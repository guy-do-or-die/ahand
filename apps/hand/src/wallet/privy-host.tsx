import { PrivyProvider, useCreateWallet, useLogin, useLogout, usePrivy, useWallets, type ConnectedWallet, type PrivyClientConfig } from "@privy-io/react-auth";
import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getAddress, UserRejectedRequestError, type Address, type EIP1193Provider } from "viem";

import type { ChainConfig, PrivyConfig } from "../config/schema";
import { chainOf } from "../chain/clients";
import { currentLang } from "../i18n";
import { PrivyUnavailableError, setPrivyPhase, type PrivyHost } from "./privy";

/**
 * Privy's SDK, mounted on first use (wallet/privy.ts loads this chunk when someone picks email).
 * It renders Privy's provider into a root of its own beside the app, so nothing in the app's
 * tree waits on it, and hands the connector a `PrivyHost`: sign in, get the person's Privy
 * wallet on the build's chain, sign out.
 *
 * Choices, each for a person who has never used a crypto app:
 *
 *   - email only. Google would be one more line here, but Privy's Google login leaves this page
 *     and comes back, and a Hand's link keeps its secret only in this page's memory (link-intake.ts
 *     takes it out of the address): the person would come back without it.
 *   - a Privy wallet is made on first entry for anyone without one (`users-without-wallets`).
 *   - Privy's own confirmation windows are off (`showWalletUIs: false`): every money action already
 *     has the app's own review step and its progress rail, and a second window that shows raw
 *     calldata and a gas price adds nothing a newcomer can check. The app's screens are the
 *     confirmation, as with the old app. A Privy window would also be unreachable when asked from
 *     inside one of the app's sheets (a modal <dialog> sits above everything). This is a proposed
 *     deviation from R-23 / R-29 ("the wallet shows every field") for email accounts only, not an
 *     owner decision (docs/defaults.md, D-21 and question 10).
 *   - the build's one chain, as Privy's default and only chain, with the build's own RPC.
 */

/** What the Privy hooks say now, published by the bridge on every render. */
interface Live {
  ready: boolean;
  authenticated: boolean;
  /** Privy's own window is on screen. */
  modalOpen: boolean;
  walletsReady: boolean;
  wallets: ConnectedWallet[];
  login: ReturnType<typeof useLogin>["login"];
  logout: () => Promise<void>;
  createWallet: () => Promise<unknown>;
}

/** How long Privy may take to load its settings before email is called unreachable. */
const READY_MS = 15_000;
/** How long the person's Privy wallet may take to appear after they are in. */
const WALLET_MS = 30_000;
/** How long the email step may stay open (the person goes to their inbox for the code). */
const LOGIN_MS = 30 * 60_000;
/** After Privy's window closes, how long the session may take to show that the person is in. */
const CLOSE_GRACE_MS = 2_000;

let live: Live | undefined;
const waiters = new Set<() => void>();
let loginOutcome: { resolve: () => void; reject: (error: unknown) => void } | undefined;

function publish(next: Live): void {
  live = next;
  for (const waiter of [...waiters]) waiter();
}

/** Resolves with `pick(live)` once it is defined, or rejects with `onTimeout()` after `ms`. */
function when<T>(pick: (now: Live) => T | undefined, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const check = () => {
      const found = live ? pick(live) : undefined;
      if (found === undefined) return false;
      waiters.delete(check);
      clearTimeout(timer);
      resolve(found);
      return true;
    };
    const timer = setTimeout(() => {
      waiters.delete(check);
      reject(onTimeout());
    }, ms);
    waiters.add(check);
    check();
  });
}

function Bridge() {
  const { ready, authenticated, isModalOpen } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const { login } = useLogin({
    onComplete: () => {
      loginOutcome?.resolve();
      loginOutcome = undefined;
    },
    onError: (error) => {
      // "exited_auth_flow": the person closed Privy's window. Anything else: Privy could not finish.
      loginOutcome?.reject(error === "exited_auth_flow" ? new UserRejectedRequestError(new Error("the email window was closed")) : new Error(`Privy: ${String(error)}`));
      loginOutcome = undefined;
    },
  });
  useEffect(() => {
    publish({ ready, authenticated, modalOpen: isModalOpen, walletsReady, wallets, login, logout, createWallet: () => createWallet() });
  });
  return null;
}

/** The theme the page shows now: the switch's choice, else the device's. */
function themeNow(): "light" | "dark" {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The app's accent as a #rrggbb Privy takes, or none. */
function accentNow(): `#${string}` | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--amber").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? (value as `#${string}`) : undefined;
}

/** Privy's settings for this build. Pure apart from the theme and language read at mount. */
export function privyClientConfig(chain: ChainConfig): PrivyClientConfig {
  const viemChain = chainOf(chain);
  const accent = accentNow();
  return {
    loginMethods: ["email"],
    defaultChain: viemChain,
    supportedChains: [viemChain],
    embeddedWallets: {
      ethereum: { createOnLogin: "users-without-wallets" },
      showWalletUIs: false,
    },
    appearance: {
      theme: themeNow(),
      ...(accent ? { accentColor: accent } : {}),
      landingHeader: currentLang() === "ru" ? "Вход по почте" : "Continue with email",
      showWalletLoginFirst: false,
      walletList: [],
    },
  };
}

let mounted: Promise<PrivyHost> | undefined;

/** Mounts Privy once and returns the host the connector uses. Rejects with `PrivyUnavailableError` if Privy never gets ready. */
export function mountPrivy(settings: PrivyConfig, chain: ChainConfig): Promise<PrivyHost> {
  let root: Root | undefined;
  mounted ??= (async () => {
    // Offline, Privy cannot load its settings: say so now instead of after the whole wait.
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new PrivyUnavailableError("offline");
    const element = document.createElement("div");
    element.id = "privy-host";
    document.body.appendChild(element);
    root = createRoot(element);
    root.render(
      <PrivyProvider appId={settings.appId} config={privyClientConfig(chain)}>
        <Bridge />
      </PrivyProvider>,
    );
    await when((now) => (now.ready ? true : undefined), READY_MS, () => new PrivyUnavailableError("Privy did not get ready"));
    return host(chain);
  })().catch((error: unknown) => {
    mounted = undefined;
    // Unmounted, not only removed: a detached provider would keep asking Privy for its settings.
    root?.unmount();
    live = undefined;
    document.getElementById("privy-host")?.remove();
    throw error instanceof PrivyUnavailableError ? error : new PrivyUnavailableError(error instanceof Error ? error.message : String(error));
  });
  return mounted;
}

const privyWallet = (now: Live): ConnectedWallet | undefined => (now.walletsReady ? now.wallets.find((wallet) => wallet.walletClientType === "privy") : undefined);

function host(chain: ChainConfig): PrivyHost {
  return {
    async signIn() {
      const now = live!;
      if (!now.authenticated) {
        const failed = new Promise<never>((_resolve, reject) => {
          loginOutcome?.reject(new UserRejectedRequestError(new Error("a new email step began")));
          loginOutcome = { resolve: () => undefined, reject };
        });
        setPrivyPhase("open");
        now.login({ loginMethods: ["email"] });
        // Privy does not report every closed window as an error (Escape, the backdrop), so the
        // window itself is watched: in, or opened and closed again with nobody in.
        let opened = false;
        const settled = when(
          (l) => {
            if (l.authenticated) return "in" as const;
            if (l.modalOpen) opened = true;
            return opened && !l.modalOpen ? ("closed" as const) : undefined;
          },
          LOGIN_MS,
          () => new UserRejectedRequestError(new Error("the email step took too long")),
        );
        settled.catch(() => undefined); // when Privy's error comes first, nobody waits on this one any more
        const outcome = await Promise.race([settled, failed]);
        loginOutcome = undefined;
        if (outcome === "closed") {
          // The window closes itself once the person is in; their session may land a moment later.
          await when((l) => (l.authenticated ? true : undefined), CLOSE_GRACE_MS, () => new UserRejectedRequestError(new Error("the email window was closed")));
        }
        // In: the sheet comes back with "Opening the email step…" while the wallet is fetched,
        // instead of staying hidden for as long as Privy takes to make it.
        setPrivyPhase("loading");
      }
      let wallet: ConnectedWallet;
      try {
        wallet = await when(privyWallet, WALLET_MS, () => new Error("no Privy wallet appeared"));
      } catch {
        // Someone who came in before wallets were made on entry: make theirs now.
        await live!.createWallet();
        wallet = await when(privyWallet, WALLET_MS, () => new PrivyUnavailableError("no Privy wallet appeared"));
      }
      setPrivyPhase("loading");
      if (wallet.chainId !== `eip155:${chain.id}`) await wallet.switchChain(chain.id);
      const provider = (await wallet.getEthereumProvider()) as unknown as EIP1193Provider;
      return { address: getAddress(wallet.address) as Address, provider };
    },
    async signOut() {
      if (live?.authenticated) await live.logout();
    },
  };
}
