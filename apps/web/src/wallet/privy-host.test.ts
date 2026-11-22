import { describe, expect, test } from "bun:test";
import type { ConnectedWallet, User } from "@privy-io/react-auth";

import type { ChainConfig } from "../config/schema";
import { AMBER_HEX, SURFACE_DARK_HEX } from "../design/tokens";
import { i18n } from "../i18n";
import { initLens } from "../shell/lens";
import { accountWallet, lookKey, lookNow, PRIVY_RU, PRIVY_WORDS, privyClientConfig, privyKept, watchLook } from "./privy-host";
import { PRIVY_METHODS } from "./privy";

/**
 * Privy's settings (privy-host.tsx `privyClientConfig`) and the choice of the wallet a person is in
 * with (`accountWallet`), without mounting Privy: one window with every way in, these wallets
 * listed first (the browser's, MetaMask, WalletConnect), Privy's own confirmation windows only with
 * the lens on, the page's look and language.
 */

const SEPOLIA: ChainConfig = { id: 84532, name: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], blockTimeMs: 2000, local: false, hasL1: true, testnet: true };

describe("Privy's settings", () => {
  test("one window with email, Google, Apple, X, Farcaster, a passkey and crypto wallets; the build's chain only", () => {
    const config = privyClientConfig(SEPOLIA, { theme: "light", lang: "en", lens: false });
    expect(config.loginMethods).toEqual([...PRIVY_METHODS]);
    expect(config.defaultChain?.id).toBe(84532);
    expect(config.supportedChains?.map((chain) => chain.id)).toEqual([84532]);
    expect(config.appearance?.walletList).toEqual(["detected_ethereum_wallets", "metamask", "rainbow", "zerion", "uniswap", "wallet_connect"]);
    expect(config.appearance?.walletChainType).toBe("ethereum-only");
    expect(config.appearance?.showWalletLoginFirst).toBe(false);
  });

  test("Privy's own confirmation windows follow the lens (since 2026-11-21): on with it, off without; a wallet is made only for those without one", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const lang of ["en", "ru"] as const) {
        expect(privyClientConfig(SEPOLIA, { theme, lang, lens: false }).embeddedWallets?.showWalletUIs).toBe(false);
        expect(privyClientConfig(SEPOLIA, { theme, lang, lens: true }).embeddedWallets?.showWalletUIs).toBe(true);
      }
    }
    expect(privyClientConfig(SEPOLIA, { theme: "dark", lang: "en", lens: true }).embeddedWallets?.ethereum?.createOnLogin).toBe("users-without-wallets");
  });

  test("the lens moves nothing else in Privy's settings: the ways in, the wallets listed and offered (whose own windows Privy does not govern), the chain and the look stay as they are", () => {
    const calm = privyClientConfig(SEPOLIA, { theme: "dark", lang: "ru", lens: false });
    const lens = privyClientConfig(SEPOLIA, { theme: "dark", lang: "ru", lens: true });
    const { showWalletUIs: off, ...calmWallets } = calm.embeddedWallets ?? {};
    const { showWalletUIs: on, ...lensWallets } = lens.embeddedWallets ?? {};
    expect([off, on]).toEqual([false, true]);
    expect(lensWallets).toEqual(calmWallets);
    // The lockup (a React element) and the chain (viem's, with its own `extend` function) are made afresh each time: compared by what they are.
    const rest = (config: typeof calm) => ({
      ...config,
      embeddedWallets: undefined,
      defaultChain: config.defaultChain?.id,
      supportedChains: config.supportedChains?.map((chain) => chain.id),
      appearance: { ...config.appearance, logo: (config.appearance?.logo as { props: unknown }).props },
    });
    expect(rest(lens)).toEqual(rest(calm));
    expect(lens.externalWallets).toBeUndefined();
  });

  test("a flip of the lens reaches Privy: Host's watcher hears it, the look's key changes, and the settings made from the look now show or hide Privy's windows", () => {
    const before = i18n.locale;
    i18n.activate("en");
    initLens(false);
    const heard: string[] = [];
    const stop = watchLook(() => heard.push(lookKey()));
    try {
      const calmKey = lookKey();
      expect(lookNow().lens).toBe(false);
      expect(privyClientConfig(SEPOLIA, lookNow()).embeddedWallets?.showWalletUIs).toBe(false);

      initLens(true);
      const lensKey = lookKey();
      expect(lensKey).not.toBe(calmKey);
      expect(lookNow().lens).toBe(true);
      expect(privyClientConfig(SEPOLIA, lookNow()).embeddedWallets?.showWalletUIs).toBe(true);

      initLens(false);
      expect(lookKey()).toBe(calmKey);
      expect(privyClientConfig(SEPOLIA, lookNow()).embeddedWallets?.showWalletUIs).toBe(false);
      expect(heard).toEqual([lensKey, calmKey]);
    } finally {
      stop();
      initLens(false);
    }
    // Stopped, the watcher hears no more.
    initLens(true);
    expect(heard).toHaveLength(2);
    initLens(false);
    if (before) i18n.activate(before);
  });

  test("the window follows the page: theme, amber accent, the lockup, and the language where Privy lets it", () => {
    const en = privyClientConfig(SEPOLIA, { theme: "light", lang: "en", lens: false });
    expect(en.appearance?.theme).toBe("light");
    expect(en.appearance?.accentColor).toBe(AMBER_HEX);
    expect((en.appearance?.logo as { type: string; props: { src: string } }).props.src).toBe("/ahand-logo-light.svg");
    expect((privyClientConfig(SEPOLIA, { theme: "dark", lang: "en", lens: false }).appearance?.logo as { props: { src: string } }).props.src).toBe("/ahand-logo-dark.svg");
    expect(en.appearance?.landingHeader).toBe(PRIVY_WORDS.en.landingHeader);
    expect(en.intl).toBeUndefined();
    const ru = privyClientConfig(SEPOLIA, { theme: "dark", lang: "ru", lens: false });
    expect(ru.appearance?.theme).toBe(SURFACE_DARK_HEX);
    expect(ru.appearance?.accentColor).toBe(AMBER_HEX);
    expect(ru.appearance?.landingHeader).toBe("Войти или создать аккаунт");
    expect(ru.intl?.textLocalization).toBe(PRIVY_RU);
    // Privy keeps its title short (35 characters) and its line under the logo under 100.
    for (const lang of ["en", "ru"] as const) {
      expect(PRIVY_WORDS[lang].landingHeader.length).toBeLessThanOrEqual(35);
      expect(PRIVY_WORDS[lang].loginMessage.length).toBeLessThanOrEqual(100);
    }
  });

  test("the Russian wallet screens keep each of Privy's {placeholders}", () => {
    const english: Record<string, string> = {
      "connectionStatus.successfullyConnected": "{walletName}",
      "connectionStatus.errorTitle": "{errorMessage}",
      "connectWallet.waitingForWallet": "{walletName}",
      "connectWallet.connectToAccount": "{appName}",
      "connectWallet.installAndConnect": "{walletName}",
      "connectWallet.searchPlaceholder": "{count}",
      "connectWallet.goToWallet": "{walletName}",
      "connectWallet.scanToConnect": "{walletName}",
      "connectWallet.openOrInstall": "{walletName}",
    };
    for (const [key, placeholder] of Object.entries(english)) expect(PRIVY_RU[key as keyof typeof PRIVY_RU]).toContain(placeholder);
    for (const value of Object.values(PRIVY_RU)) expect(/[а-яё]/i.test(value!) || value === "{errorMessage}").toBe(true);
  });
});

describe("the wallet a person is in with", () => {
  const wallet = (address: string, walletClientType: string) => ({ address, walletClientType }) as unknown as ConnectedWallet;
  const kept = wallet("0x00000000000000000000000000000000000000Aa", "privy");
  const metamask = wallet("0x00000000000000000000000000000000000000bB", "metamask");
  const userWith = (address: string | undefined, walletClientType = "privy") => ({ wallet: address ? { address, walletClientType } : undefined }) as unknown as User;

  test("the one the Privy account names: the crypto wallet logged in with, or the wallet Privy keeps", () => {
    expect(accountWallet({ walletsReady: true, wallets: [kept, metamask], user: userWith(metamask.address.toLowerCase(), "metamask") })).toBe(metamask);
    expect(accountWallet({ walletsReady: true, wallets: [metamask, kept], user: userWith(kept.address) })).toBe(kept);
  });

  test("none until Privy's wallets are ready, the account names one, and that one is connected here", () => {
    expect(accountWallet({ walletsReady: false, wallets: [kept], user: userWith(kept.address) })).toBeUndefined();
    expect(accountWallet({ walletsReady: true, wallets: [kept], user: userWith(undefined) })).toBeUndefined();
    expect(accountWallet({ walletsReady: true, wallets: [kept], user: null })).toBeUndefined();
    expect(accountWallet({ walletsReady: true, wallets: [kept], user: userWith(metamask.address, "metamask") })).toBeUndefined();
  });
});

describe("a wallet Privy keeps", () => {
  test("is \"privy\" or \"privy-v2\", as Privy's own code reads them; a crypto wallet's type is neither", () => {
    expect(privyKept("privy")).toBe(true);
    expect(privyKept("privy-v2")).toBe(true);
    for (const other of ["metamask", "wallet_connect", "coinbase_wallet", "", undefined]) expect(privyKept(other)).toBe(false);
  });
});
