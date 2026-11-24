import { PrivyProvider, useCreateWallet, useLinkAccount, useLogin, useLogout, usePrivy, useWallets, type ConnectedWallet, type PrivyClientConfig, type User } from "@privy-io/react-auth";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getAddress, UserRejectedRequestError, type Address, type EIP1193Provider } from "viem";

import type { ChainConfig, PrivyConfig } from "../config/schema";
import { chainOf } from "../chain/clients";
import { AMBER_HEX, SURFACE_DARK_HEX } from "../design/tokens";
import { currentLang, i18n } from "../i18n";
import { armLinkCarry } from "../link-carry";
import { lensOn, watchLens } from "../shell/lens";
import type { Lang } from "../ui/ambient";
import { privyReturning } from "./privy-mark";
import { PrivyUnavailableError, setPrivyPhase, type PrivyHost, type PrivyLoginMethod, type PrivySession } from "./privy";

/**
 * Privy's SDK, mounted on first use (wallet/privy.ts loads this chunk when someone presses "Log in"
 * or an action that needs an account, or on idle when this browser holds the mark of a session).
 * It renders Privy's provider into a root of its own beside the app, so nothing in the app's tree
 * waits on it, and hands the connector a `PrivyHost`: log in, restore, get the wallet the person
 * is in with on the build's chain, log out, add a passkey.
 *
 * Choices:
 *
 *   - one window, Privy's: email, Google, Apple, X, Farcaster, a passkey and crypto wallets, on
 *     every screen; nothing of the app's own comes before it. Google, Apple and X send the person
 *     away and back by a full load: the raise form is kept across it (screens/raise/kept.ts), and
 *     since 2026-11-21 so is an opened link, in this tab's
 *     session storage for that one trip only (link-carry.ts, the one exception to a reload forgetting an opened link).
 *   - crypto wallets: those this browser announces (EIP-6963: MetaMask, Rabby, Coinbase Wallet's
 *     extension and others), then MetaMask, Rainbow, Zerion and Uniswap by name (so a phone
 *     without them is offered the app), then WalletConnect's list for every other phone app.
 *     Coinbase's own SDK (its smart wallet's pop-up and relay) is not listed: the app's COOP
 *     header would cut the pop-up off, and its extension is found by EIP-6963 anyway.
 *   - a wallet Privy keeps is made on first entry for anyone without one (`users-without-wallets`):
 *     whoever comes with a crypto wallet gets none.
 *   - Privy's own confirmation windows follow the lens (`showWalletUIs: look.lens`), as decided by
 *     since 2026-11-21. With the lens on, a wallet Privy keeps (email, social,
 *     passkey) shows Privy's window for every signature and transaction, so a person who checks
 *     sees what is signed in Privy's words; for a transaction that window also waits for the
 *     receipt and hands the hash back only at its "All Done", so the app's rail stays on "asking"
 *     until then. With it off, the app's review step and its progress rail are the confirmation,
 *     and a second window with raw calldata and a gas price, which a newcomer cannot check, stays
 *     away. `Host` gives Privy new settings on every flip (`lookKey`, `watchLook`), not a new
 *     mount: Privy reads `showWalletUIs` as each request comes (its `isHeadlessSigning`), and the
 *     wallet's EIP-1193 provider, which the app uses, carries no per-request `uiOptions`, so this
 *     setting is the only switch. It governs only the wallets Privy keeps: a crypto wallet shows
 *     its own window for every request either way.
 *   - the build's one chain, as Privy's default and only chain, with the build's own RPC.
 *   - the window follows the page: its theme (light or dark, read again when it flips), the amber
 *     accent, the aHand lockup, and the language (Privy translates only its title, its line under
 *     the logo and its wallet screens; the rest of it stays in English).
 */

/** What the Privy hooks say now, published by the bridge on every render. */
interface Live {
  ready: boolean;
  authenticated: boolean;
  user: User | null;
  /** Privy's own window is on screen. */
  modalOpen: boolean;
  walletsReady: boolean;
  wallets: ConnectedWallet[];
  login: ReturnType<typeof useLogin>["login"];
  logout: () => Promise<void>;
  createWallet: () => Promise<unknown>;
  /**
   * Opens Privy's own passkey window for a logged-in person. Settles once the window is asked for;
   * rejects when Privy refuses first (nobody in, the account at its most passkeys, the challenge
   * not fetched).
   */
  linkPasskey: () => Promise<void>;
}

/**
 * How long Privy may take to load its code's settings before logging in is called unreachable.
 * Privy was seen ready 1.3 to 2.5 s after the press; a blocked host otherwise keeps the person
 * behind "Opening log in…" for the whole wait.
 */
const READY_MS = 8_000;
/** How long the person's wallet may take to appear after they are in. */
const WALLET_MS = 30_000;
/** How long a returning person's crypto wallet may take to reconnect before their old session is set aside. */
const RECONNECT_MS = 4_000;
/** How long the login window may stay open (the person goes to their inbox for the code). */
const LOGIN_MS = 30 * 60_000;
/** After Privy's window closes, how long the session may take to show that the person is in. */
const CLOSE_GRACE_MS = 2_000;
/** How long a social login that came back here may take to finish. */
const RETURN_MS = 60_000;

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
  const { ready, authenticated, user, isModalOpen } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  // No callbacks: Privy's passkey window shows its own errors and success, and `addPasskey` reads
  // the outcome from the account once the window closes. Privy types `linkPasskey` as returning
  // nothing, but in 3.51.3 and 3.52.0 it is async and rejects before its window opens (nobody in, a sixth
  // passkey, the challenge not fetched), so its promise is kept and handed on.
  const { linkPasskey } = useLinkAccount();
  const { login } = useLogin({
    onComplete: () => {
      loginOutcome?.resolve();
      loginOutcome = undefined;
    },
    onError: (error) => {
      // "exited_auth_flow": the person closed Privy's window. Anything else: Privy could not finish.
      loginOutcome?.reject(error === "exited_auth_flow" ? new UserRejectedRequestError(new Error("the login window was closed")) : new Error(`Privy: ${String(error)}`));
      loginOutcome = undefined;
    },
  });
  useEffect(() => {
    publish({ ready, authenticated, user, modalOpen: isModalOpen, walletsReady, wallets, login, logout, createWallet: () => createWallet(), linkPasskey: () => Promise.resolve(linkPasskey() as unknown).then(() => undefined) });
  });
  return null;
}

/** The theme the page shows now: the switch's choice, else the device's; light where there is no page (unit tests). */
function themeNow(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function watchTheme(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/** What Privy's window says in each language, where Privy lets it be said. */
export const PRIVY_WORDS: Record<Lang, { landingHeader: string; loginMessage: string }> = {
  en: {
    landingHeader: "Log in or sign up",
    loginMessage: "With your email, a social account or a crypto app.",
  },
  ru: {
    landingHeader: "Войти или создать аккаунт",
    // Privy translates nothing below this line on its first screen (its textLocalization covers only
    // the wallet screens; the line is capped at 100 characters), so it names the ways in and says
    // the buttons that follow are English.
    loginMessage: "Почта, Google и другие соцсети или криптокошелёк. Кнопки ниже — на английском.",
  },
};

/** Privy's wallet screens in Russian (`intl.textLocalization`, Privy's own keys); English is Privy's default. */
export const PRIVY_RU: NonNullable<NonNullable<PrivyClientConfig["intl"]>["textLocalization"]> = {
  "connectionStatus.successfullyConnected": "Подключено: {walletName}",
  "connectionStatus.errorTitle": "{errorMessage}",
  "connectionStatus.connecting": "Подключаем",
  "connectionStatus.connectOneWallet": "Лучше подключать по одному кошельку за раз.",
  "connectionStatus.checkOtherWindows": "Не видишь кошелёк? Загляни в другие окна браузера.",
  "connectionStatus.stillHere": "Всё ещё ждёшь?",
  "connectionStatus.tryConnectingAgain": "Попробовать снова",
  "connectionStatus.or": "или",
  "connectionStatus.useDifferentLink": "открой другую ссылку",
  "connectWallet.connectYourWallet": "Подключить кошелёк",
  "connectWallet.waitingForWallet": "Ждём {walletName}",
  "connectWallet.connectToAccount": "Подключи кошелёк к аккаунту {appName}",
  "connectWallet.installAndConnect": "Чтобы подключить {walletName}, установи и открой приложение, потом подтверди подключение.",
  "connectWallet.tryConnectingAgain": "Попробуй подключиться ещё раз.",
  "connectWallet.openInApp": "Открыть в приложении",
  "connectWallet.copyLink": "Скопировать ссылку",
  "connectWallet.retry": "Ещё раз",
  "connectWallet.searchPlaceholder": "Найти из {count}",
  "connectWallet.noWalletsFound": "Ничего не нашлось. Попробуй другой запрос.",
  "connectWallet.lastUsed": "В прошлый раз",
  "connectWallet.selectYourWallet": "Выбери кошелёк",
  "connectWallet.selectNetwork": "Выбери сеть",
  "connectWallet.goToWallet": "Перейди в {walletName}, чтобы продолжить",
  "connectWallet.scanToConnect": "Отсканируй код, чтобы подключить {walletName}",
  "connectWallet.openOrInstall": "Открыть или установить {walletName}",
};

export interface PrivyLook {
  theme: "light" | "dark";
  lang: Lang;
  /** The lens is on: Privy's own confirmation windows show for a wallet it keeps. */
  lens: boolean;
}

/** Privy's settings for this build and this look. Pure: the look is read by the caller. */
export function privyClientConfig(chain: ChainConfig, look: PrivyLook): PrivyClientConfig {
  const viemChain = chainOf(chain);
  return {
    loginMethods: ["email", "google", "apple", "twitter", "farcaster", "passkey", "wallet"],
    defaultChain: viemChain,
    supportedChains: [viemChain],
    embeddedWallets: {
      ethereum: { createOnLogin: "users-without-wallets" },
      // Since 2026-11-21: Privy's windows in the lens only. Read by Privy at each request (its
      // `isHeadlessSigning`), so the window that comes is the lens's of that moment.
      showWalletUIs: look.lens,
    },
    appearance: {
      // Dark: the app's own dark card, from which Privy works out the rest; light: Privy's white, the app's card.
      theme: look.theme === "dark" ? (SURFACE_DARK_HEX as `#${string}`) : "light",
      // The app's amber (design/tokens.ts), the same in both themes.
      accentColor: AMBER_HEX as `#${string}`,
      // The site's own lockup file (img-src 'self') in the theme's ink, with its size written out:
      // the file has none, and Privy's slot would give it no width. Privy takes an <img> or a URL.
      logo: <img src={look.theme === "dark" ? "/ahand-logo-dark.svg" : "/ahand-logo-light.svg"} width={154} height={60} alt="aHand" />,
      landingHeader: PRIVY_WORDS[look.lang].landingHeader,
      loginMessage: PRIVY_WORDS[look.lang].loginMessage,
      showWalletLoginFirst: false,
      walletChainType: "ethereum-only",
      // Well-known wallets by name before WalletConnect's alphabetical list of hundreds.
      walletList: ["detected_ethereum_wallets", "metamask", "rainbow", "zerion", "uniswap", "wallet_connect"],
    },
    ...(look.lang === "ru" ? { intl: { defaultCountry: "RU" as const, textLocalization: PRIVY_RU } } : {}),
  };
}

/** The page's look now, from which `Host` makes Privy's settings. */
export function lookNow(): PrivyLook {
  return { theme: themeNow(), lang: currentLang(), lens: lensOn() };
}

/** Names the look: it changes exactly when Privy needs new settings (theme, language or lens). */
export function lookKey(): string {
  return `${themeNow()}|${currentLang()}|${lensOn() ? "lens" : "calm"}`;
}

/** Calls `onChange` when the theme, the language or the lens moves; returns the way to stop. */
export function watchLook(onChange: () => void): () => void {
  const stopTheme = watchTheme(onChange);
  const stopLang = i18n.on("change", onChange);
  const stopLens = watchLens(onChange);
  return () => {
    stopTheme();
    stopLang();
    stopLens();
  };
}

/**
 * Privy's provider with the page's look, given again whenever the theme, the language or the lens
 * changes. The provider stays mounted: Privy takes new settings in place (its client and the
 * session stay), and reports each set it has not seen on this device once to its own
 * analytics (`sdk_initialize`), as it does for a new theme.
 */
function Host({ settings, chain }: { settings: PrivyConfig; chain: ChainConfig }) {
  const key = useSyncExternalStore(watchLook, lookKey, lookKey);
  // `key` names the look: the settings are made again only when the theme, the language or the lens moves.
  const config = useMemo(() => privyClientConfig(chain, lookNow()), [chain, key]);
  return (
    <PrivyProvider appId={settings.appId} config={config}>
      <Bridge />
    </PrivyProvider>
  );
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
    root.render(<Host settings={settings} chain={chain} />);
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

/**
 * The wallet the person is in with: the one their Privy account names (`user.wallet`, the crypto
 * wallet they logged in with, or the wallet Privy made them), once Privy reports it connected here.
 */
export function accountWallet(now: Pick<Live, "walletsReady" | "wallets" | "user">): ConnectedWallet | undefined {
  if (!now.walletsReady) return undefined;
  const named = now.user?.wallet?.address?.toLowerCase();
  if (!named) return undefined;
  return now.wallets.find((wallet) => wallet.address.toLowerCase() === named);
}

/** The passkeys of a Privy account, by credential id: its linked accounts of type "passkey" (up to 5, added or removed in one window). */
export function passkeysOf(user: Pick<User, "linkedAccounts"> | null | undefined): string[] {
  return (user?.linkedAccounts ?? []).flatMap((account) => (account.type === "passkey" ? [account.credentialId] : []));
}

/**
 * Privy's passkey window, in order: ask for it (`link`, which rejects at once when Privy refuses
 * before the window opens, so nothing waits on a window that will not come and the sheet never
 * comes back under one), see it open, then wait for it to close. `open(state, ms)` waits for the
 * window to be open or closed, and rejects after `ms`.
 */
export async function passkeyWindow(link: () => Promise<void>, open: (state: boolean, ms: number) => Promise<void>): Promise<void> {
  await link();
  await open(true, READY_MS);
  await open(false, LOGIN_MS);
}

/** Whether the Privy account names no wallet yet, or names one Privy keeps (which only needs time to appear). */
const keptOrNone = (now: Live): boolean => !now.user?.wallet || privyKept(now.user.wallet.walletClientType);

/**
 * Whether a wallet client type names a wallet Privy keeps: "privy", or "privy-v2", which Privy's
 * own code treats the same (its server's value reaches `user.wallet` unchanged).
 */
export function privyKept(walletClientType: string | undefined): boolean {
  return walletClientType === "privy" || walletClientType === "privy-v2";
}

async function sessionOf(wallet: ConnectedWallet): Promise<PrivySession> {
  const provider = (await wallet.getEthereumProvider()) as unknown as EIP1193Provider;
  return {
    address: getAddress(wallet.address) as Address,
    provider,
    embedded: privyKept(wallet.walletClientType),
    switchChain: async (chainId) => {
      await wallet.switchChain(chainId);
    },
  };
}

/** The wallet of an authenticated person, made first when their account has none. Undefined when a crypto wallet does not show up. */
async function walletOfSession(): Promise<ConnectedWallet | undefined> {
  const now = live!;
  if (!keptOrNone(now)) {
    // A crypto wallet: Privy reconnects it on its own when the browser still allows it.
    return when(accountWallet, RECONNECT_MS, () => new Error("not here")).catch(() => undefined);
  }
  try {
    return await when(accountWallet, now.user?.wallet ? WALLET_MS : 5_000, () => new Error("no wallet appeared"));
  } catch {
    // Someone who came in before wallets were made on entry: make theirs now (Privy refuses if it is already making one).
    if (!live!.user?.wallet) await live!.createWallet().catch(() => undefined);
    return when(accountWallet, WALLET_MS, () => new PrivyUnavailableError("no Privy wallet appeared"));
  }
}

/** Opens Privy's window with these ways in and waits until the person is in, or closes it. */
async function openLogin(methods: readonly PrivyLoginMethod[]): Promise<void> {
  const now = live!;
  const failed = new Promise<never>((_resolve, reject) => {
    loginOutcome?.reject(new UserRejectedRequestError(new Error("a new login began")));
    loginOutcome = { resolve: () => undefined, reject };
  });
  setPrivyPhase("open");
  now.login({ loginMethods: [...methods] });
  // Google, Apple and X leave the page from inside Privy's window: while it is open, an opened link
  // on screen is written as the page leaves and erased if the login ends here (link-carry.ts, the
  //  Privy's own `location.assign` gives the app no earlier moment.
  const disarm = armLinkCarry();
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
    () => new UserRejectedRequestError(new Error("logging in took too long")),
  );
  settled.catch(() => undefined); // when Privy's error comes first, nobody waits on this one any more
  try {
    const outcome = await Promise.race([settled, failed]);
    if (outcome === "closed") {
      // The window closes itself once the person is in; their session may land a moment later.
      await when((l) => (l.authenticated ? true : undefined), CLOSE_GRACE_MS, () => new UserRejectedRequestError(new Error("the login window was closed")));
    }
  } finally {
    loginOutcome = undefined;
    disarm();
    // In: the app's status line comes back while the wallet is fetched.
    setPrivyPhase("loading");
  }
}

function host(chain: ChainConfig): PrivyHost {
  return {
    async signIn(methods) {
      if (live!.authenticated) {
        const kept = await walletOfSession();
        if (kept) return finish(kept);
        // A session whose crypto wallet is not here (locked, removed): set it aside and log in afresh.
        await live!.logout();
        await when((l) => (l.authenticated ? undefined : true), CLOSE_GRACE_MS, () => new Error("Privy did not log out"));
      }
      await openLogin(methods);
      const wallet = await walletOfSession();
      if (!wallet) throw new PrivyUnavailableError("the crypto wallet did not answer");
      return finish(wallet);
    },
    async restore() {
      // A social login that came back to this page finishes inside Privy as it loads.
      if (privyReturning()) await when((l) => (l.authenticated ? true : undefined), RETURN_MS, () => new Error("the social login did not finish")).catch(() => undefined);
      if (!live!.authenticated) return undefined;
      const wallet = await walletOfSession();
      return wallet ? sessionOf(wallet) : undefined;
    },
    async signOut() {
      if (live?.authenticated) await live.logout();
    },
    passkeys() {
      return live?.authenticated ? passkeysOf(live.user) : [];
    },
    async addPasskey() {
      if (!live?.authenticated) throw new Error("nobody is logged in");
      // Privy fetches a challenge, then opens its window; the person adds a passkey, removes one or
      // closes it. Its success screen ("Passkeys updated") comes after the account is updated, so
      // the passkeys are read as the window closes.
      await passkeyWindow(live.linkPasskey, (state, ms) =>
        when((l) => (l.modalOpen === state ? true : undefined), ms, () => new Error(state ? "Privy's passkey window did not open" : "the passkey window stayed open too long")).then(() => undefined),
      );
      return passkeysOf(live?.user);
    },
  };

  async function finish(wallet: ConnectedWallet): Promise<PrivySession> {
    const session = await sessionOf(wallet);
    // Privy's own wallet moves at once; a crypto wallet is asked by the connector.
    if (session.embedded && wallet.chainId !== `eip155:${chain.id}`) await wallet.switchChain(chain.id);
    return session;
  }
}
