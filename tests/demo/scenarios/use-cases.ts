/**
 * The use cases the catalogue tracks: what the protocol is for (ids "uc:…") and the app's screen
 * flows (ids "flow:…"), each named here, so this list is their definition. A scenario
 * names the ids it covers; catalogue.ts prints which are covered, which are planned, and which
 * are out of the browser's reach (Core-only or not built).
 */
export interface UseCase {
  id: string;
  name: string;
  /** "browser": a scenario can show it; "core": Core/SDK tests only; "not-built": no screen yet. */
  reach: "browser" | "core" | "not-built";
}

export const USE_CASES: UseCase[] = [
  { id: "uc:chain", name: "Human seeks human through a chain (flagship)", reach: "browser" },
  { id: "uc:hiring", name: "Hiring / recruiting", reach: "browser" },
  { id: "uc:lost-and-found", name: "Lost-and-found: a QR tag as a bearer link, dark, zero reward", reach: "browser" },
  { id: "uc:household", name: "Household services: $8–150, short expiry", reach: "browser" },
  { id: "uc:agents", name: "Agents as hops, raisers, givers (ERC-1271)", reach: "core" },
  { id: "uc:app-hop", name: "Apps as hops with a disclosed margin", reach: "browser" },
  { id: "uc:contract-raisers", name: "Contract raisers, pools, DAOs", reach: "core" },
  { id: "uc:zero-reward", name: "Zero-reward asks", reach: "browser" },
  { id: "uc:any-token", name: "Any ERC-20 token", reach: "not-built" },
  { id: "uc:long-route", name: "Long routes", reach: "browser" },
  { id: "uc:one-give", name: "Exactly one Give: several winners means several Hands", reach: "browser" },
  { id: "uc:no-disputes", name: "No disputes: the raiser decides; anyone refunds after expiry", reach: "browser" },
  { id: "uc:dark", name: "Private / dark asks, anonymous hops", reach: "browser" },
  { id: "uc:boards", name: "Public boards and catalogues", reach: "not-built" },
  { id: "uc:smart-wallets", name: "Smart-contract wallets (Safe, Privy, 7702)", reach: "browser" },
  { id: "uc:blocking-token", name: "Hostile or pausing tokens: a blocked payee waits", reach: "browser" },
  { id: "uc:permissionless", name: "Permissionless finalization: strangers refund and deliver", reach: "browser" },
  { id: "uc:exit", name: "Exit / recovery with the site, relay or indexer down", reach: "browser" },
  { id: "uc:signals", name: "Signals, badges, voting interpreters", reach: "not-built" },
  { id: "uc:negative", name: "Down / negative statement", reach: "not-built" },
  { id: "uc:eas", name: "EAS-timestamped Give", reach: "not-built" },
  { id: "uc:relayed-thank", name: "Relayed thank / auto-reclaim", reach: "not-built" },
  { id: "uc:paymaster", name: "Paymaster / self-paid gas", reach: "not-built" },
  { id: "uc:charity", name: "Curated charity allowlist", reach: "not-built" },
  { id: "uc:replay", name: "Chain fork / cross-core replay", reach: "core" },
  { id: "uc:branching", name: "Leaked capability key, truncated route: branching", reach: "browser" },
  { id: "uc:cross-language", name: "Cross-language SDK signing", reach: "core" },
  { id: "uc:walletless-pass", name: "Walletless paid pass", reach: "browser" },
  { id: "flow:raise", name: "Raise: compose, steps, keys card, share", reach: "browser" },
  { id: "flow:my-hands", name: "My hands: unlock, answers, rebuild on another device", reach: "browser" },
  { id: "flow:care", name: "Care: add to the reward, extend", reach: "browser" },
  { id: "flow:thank", name: "Thank: verdict, re-signed route, predicted receipt", reach: "browser" },
  { id: "flow:hand-view", name: "Hand view: time's up, send back", reach: "browser" },
  { id: "flow:pass-on", name: "Pass on: share, payee, darker", reach: "browser" },
  { id: "flow:give", name: "Give: payee choices, delivery, thread", reach: "browser" },
  { id: "flow:waiting", name: "Waiting: take out, deliver for someone else", reach: "browser" },
  { id: "flow:proof", name: "Proof passport and check any link", reach: "browser" },
  { id: "flow:about-pages", name: "Print, limits, defaults, without us", reach: "browser" },
];

/** Scenarios to write next: the catalogue lists them as planned, so the gap is visible. */
export const PLANNED: { id: string; title: string; covers: string[]; waitsFor?: string }[] = [
  { id: "answers-on-a-new-device", title: "On a fresh browser the asker adds her Hand by number: the page says this device holds no reply key, and the device code brings the answers back", covers: ["flow:my-hands"], waitsFor: "a verb for My hands' add-by-number. The reply key comes from the raiser's master with this device's book (IndexedDB, screens/my/session.ts), so a Hand added by number on a fresh browser cannot read its answers and says so; rebuild-other-device shows the way back through the device code" },
  { id: "give-words-survive-social-login", title: "A helper types the answer, then logs in with a social account from Give; back on Give, the words are still there", covers: ["uc:smart-wallets", "flow:pass-on"], waitsFor: "a social login the engine can drive (Privy's test accounts sign in by email only; a social account needs a real one)" },
  { id: "privy-passkey", title: "A helper signs in to Privy with a passkey from a virtual authenticator (CDP WebAuthn) on Base Sepolia", covers: ["uc:smart-wallets"], waitsFor: "privy-email's wallet kind (privy-test) with a passkey instead of the email, and whether Privy's window accepts a CDP virtual authenticator" },
];
