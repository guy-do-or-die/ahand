/**
 * The use cases the catalogue tracks: the protocol's use cases (U1–U28) and the app's screen
 * flows (UX §7–§11), each named here, so this list is their definition. A scenario
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
  { id: "U1", name: "Human seeks human through a chain (flagship)", reach: "browser" },
  { id: "U2", name: "Hiring / recruiting", reach: "browser" },
  { id: "U3", name: "Lost-and-found: a QR tag as a bearer link, dark, zero reward", reach: "browser" },
  { id: "U4", name: "Household services: $8–150, short expiry", reach: "browser" },
  { id: "U5", name: "Agents as hops, raisers, givers (ERC-1271)", reach: "core" },
  { id: "U6", name: "Apps as hops with a disclosed margin", reach: "browser" },
  { id: "U7", name: "Contract raisers, pools, DAOs", reach: "core" },
  { id: "U8", name: "Zero-reward asks", reach: "browser" },
  { id: "U9", name: "Any ERC-20 token", reach: "not-built" },
  { id: "U10", name: "Long routes", reach: "browser" },
  { id: "U11", name: "Exactly one Give: several winners means several Hands", reach: "browser" },
  { id: "U12", name: "No disputes: the raiser decides; anyone refunds after expiry", reach: "browser" },
  { id: "U13", name: "Private / dark asks, anonymous hops", reach: "browser" },
  { id: "U14", name: "Public boards and catalogues", reach: "not-built" },
  { id: "U15", name: "Smart-contract wallets (Safe, Privy, 7702)", reach: "browser" },
  { id: "U16", name: "Hostile or pausing tokens: a blocked payee waits", reach: "browser" },
  { id: "U17", name: "Permissionless finalization: strangers refund and deliver", reach: "browser" },
  { id: "U18", name: "Exit / recovery with the site, relay or indexer down", reach: "browser" },
  { id: "U19", name: "Signals, badges, voting interpreters", reach: "not-built" },
  { id: "U20", name: "Down / negative statement", reach: "not-built" },
  { id: "U21", name: "EAS-timestamped Give", reach: "not-built" },
  { id: "U22", name: "Relayed thank / auto-reclaim", reach: "not-built" },
  { id: "U23", name: "Paymaster / self-paid gas", reach: "not-built" },
  { id: "U24", name: "Curated charity allowlist", reach: "not-built" },
  { id: "U25", name: "Chain fork / cross-core replay", reach: "core" },
  { id: "U26", name: "Leaked capability key, truncated route: branching", reach: "browser" },
  { id: "U27", name: "Cross-language SDK signing", reach: "core" },
  { id: "U28", name: "Walletless paid pass", reach: "browser" },
  { id: "UX §7.2", name: "Raise: compose, steps, keys card, share", reach: "browser" },
  { id: "UX §7.3", name: "My hands: unlock, answers, rebuild on another device", reach: "browser" },
  { id: "UX §7.4", name: "Care: add to the reward, extend", reach: "browser" },
  { id: "UX §7.5", name: "Thank: verdict, re-signed route, predicted receipt", reach: "browser" },
  { id: "UX §8.2", name: "Hand view: time's up, send back", reach: "browser" },
  { id: "UX §8.4", name: "Pass on: share, payee, darker", reach: "browser" },
  { id: "UX §8.5", name: "Give: payee choices, delivery, thread", reach: "browser" },
  { id: "UX §9", name: "Waiting: take out, deliver for someone else", reach: "browser" },
  { id: "UX §10", name: "Proof passport and check any link", reach: "browser" },
  { id: "UX §11", name: "Print, limits, defaults, without us", reach: "browser" },
];

/** Scenarios to write next: the catalogue lists them as planned, so the gap is visible. */
export const PLANNED: { id: string; title: string; covers: string[]; waitsFor?: string }[] = [
  { id: "answers-on-a-new-device", title: "On a fresh browser the asker adds her Hand by number: the page says this device holds no reply key, and the device code brings the answers back", covers: ["UX §7.5"], waitsFor: "a verb for My hands' add-by-number. The reply key comes from the raiser's master with this device's book (IndexedDB, screens/my/session.ts), so a Hand added by number on a fresh browser cannot read its answers and says so; rebuild-other-device shows the way back through the device code" },
  { id: "give-words-survive-social-login", title: "A helper types the answer, then logs in with a social account from Give; back on Give, the words are still there", covers: ["U15", "UX §8.4"], waitsFor: "a social login the engine can drive (Privy's test accounts are email only; X needs a real account). On exp-e2e.ahand.in (21 Nov, X login from \"Log in to get paid\") the answer came back empty after the OAuth round trip while the Hand and the wallet were kept: today the scenario would fail, as the raise form is kept across a social login and the give words are not" },
  { id: "privy-passkey", title: "A helper signs in to Privy with a passkey from a virtual authenticator (CDP WebAuthn) on Base Sepolia", covers: ["U15"], waitsFor: "privy-email's wallet kind (privy-test) with a passkey instead of the email; passkeys are on in the dev Privy app since 21 Nov, but whether Privy's window accepts a CDP virtual authenticator is not checked yet. No Apple scenario: Apple sign-in needs the project's own Apple OAuth credentials" },
];
