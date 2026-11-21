# The app

```
/31337/14?d=AgFP…#<link>   →   the fragment is read once into memory, then removed from the address bar
                               the Deal card: "Someone raised a hand:" over the title "a sublet in Yerevan, June."
                               [🤝 Pass it on]   [🙌 I can help]
```

`apps/hand`: React 19, Vite 8, wagmi 3 (EIP-6963 injected wallets, and email through Privy when the configuration has `privy`; see "Email through Privy" below), a 60-line router over `pathname` (`src/router.ts`, one table in `src/routes.ts`). The build is a folder of static files plus a self-contained `exit.html`. English and Russian; Russian speaks as «ты». Built with `bun run --cwd apps/hand build`; unit tests `cd apps/hand && bun test`; browser smokes `tests/e2e/smoke/*.spec.ts`.

## Screens

| Route | Screen (`src/screens/…`) | What it does |
|---|---|---|
| `/` | `landing` | the hero, a box to paste an address, bare link or QR digits, three gesture cards that turn over to Core's calls. With a fragment it is the Hand view |
| `/<chain>/<hand>`, `/<chain>/<core>/<hand>` (`?d=` optional) | `hand` | the Deal card, the route as a rail of cards that turn over (the twist), "Pass it on", "I can help"; after the end "Send it back"; on a closed Hand a bounded look for the asker's newer Hand, by Hand numbers (D-64) |
| `/pass` | `pass` | signs a Shake with the link key (no wallet), keeps the shape or makes it darker, reads the new link back and shows its payee and share, *checked here* |
| `/give` | `give` | the helper's answer: a connected account, a one-time key with a pasted payee, or a new address whose twelve words are shown once; Core's `checkGive` before it is called an answer; delivery to the asker's inbox, with "Send this back to whoever sent you the link" as the fallback |
| `/raise` | `raise` | words, mode, reward (zero allowed), days; keys confirmation; simulate, then send; the first link at "In a block" |
| `/my`, `/my/<chain>/<hand>` | `my` | this device's Hands, answers received, replies; rebuilds a link after one confirmation |
| `/thank` | `thank` | paste or receive a give link; Core's `checkGive`; re-signed routes refused by default; payee warnings; worst gas; the account setup first when needed; the receipt from events |
| `/waiting` | `waiting` | money waiting for a payee: take it out, or deliver it to the payee |
| `/care/<chain>/<hand>` | `care` | add to the reward, extend (warning under ten minutes, by the network's clock), a calendar reminder |
| `/print` | `print` | an A6 card or a tag, only when the real QR version stays readable; a receipt |
| `/<chain>/<hand>/proof` | `proof` | the passport: every fact rebuilt from events and views, a bundle to download, the command to check it without the site |
| `/check` | `check` | any link: a byte ruler and Core's checks offline, then Core's own answer side by side |
| `/core` | `core` | the CREATE2 derivation, the domain, the cap, the served build hash, the reproduce command, the twelve limits |
| `/limits`, `/defaults`, `/without-us` | `limits`, `defaults`, `without-us` | what it can't promise (16 entries); every default of this build; doing it with `exit.html`, a command or an explorer |
| `/gallery`, `/dev/wallet` | local builds only | the UI kit; the dev wallet with anvil's public test accounts |

The shell (`src/shell/`) holds the header (language switch, the lens `🔍` or `?`), the footer `UNAUDITED · CORE 0x65ac…2309 · NO OWNER · NO FEE`, and on a local build the ribbon `LOCAL TEST NETWORK · TEST DOLLARS`. Every sent action shows four states: Sent → In a block → Recorded on Ethereum → Final; on a chain with no L1 behind it the last two carry `LOCAL STAND-IN`.

## Time

Every "now" on screen comes from the latest block (`src/chain/`, `useNow`). Before a block arrives, dates are shown and nothing that depends on "now" is claimed. Guard: `apps/hand/tests/guards/clock.test.ts`; browser test with the device clock moved: `tests/e2e/guards/wallclock.spec.ts`; a 40-day jump: `tests/e2e/clock.spec.ts`.

## What the device stores

The link's 16-byte seed lives in the address its holder was sent and in the memory of the tab that opened it (`src/store/memory.ts`); a reload forgets it, and the screen says so. IndexedDB database `ahand` (`src/store/db.ts`):

| Store | Holds | A secret? |
|---|---|---|
| `books` | the 8-byte book per asker; whether the account repeats its signatures | no |
| `hands` | my Hands: chain, Core, number, `n`, the raise intent and hash, mode, the words and salt | the asker's own words; no key |
| `inbox` | answers received or pasted, as give links (no secret by format), first-seen time on this device, routes seen | no |
| `outbox` | the helper's give links, delivery status, the per-answer chat key | a chat key only |
| `passed` | Hands passed from this device: chain, number, position, payee | no |
| `prefs` | language, lens, theme | no |
| `vault` | one AES-GCM key per device, created non-extractable | cannot be read out |
| `escrow` | **the locked copy**: for an account whose signatures do not repeat, the new Hand's seed encrypted under the vault key, written before `raise` is sent, deleted when the asker ticks "I saved the link" or the raise is found reverted, and by the sweep on every start (below) | yes, encrypted, at most one day after the link is shown |

The locked copy (`lockSeed`, `openSeed`, `dropSeed`) binds the raise intent as AES-GCM associated data with a fresh IV. It protects against a storage dump and a crash, not against this site's own code. It is a recorded deviation (D-63). Each copy carries two chain times (`stampSeed`): when the raise read the chain, and when the "up" screen first showed the link. On every start the app sweeps them (`apps/hand/src/screens/raise/sweep.ts`, by the chain's clock, never the device's): a copy is deleted once its Hand is closed or past its end, one day (`SHOWN_BOUND`, 24 h) after its link was first shown, when its raise reverted, or when no raise on the device names it; a copy whose raise is still on its way, or whose Hand cannot be read now, is kept. Until then `/my` says the link is kept locked on this device. Tests: `apps/hand/src/screens/raise/sweep.test.ts` and `apps/hand/tests/guards/store.test.ts` (no seed in any store in any form; the vault key not exportable). The theme toggle also writes one `localStorage` key, `ahand-theme`.

Clearing the storage loses only "My hands on this device", answers seen and the outbox; every flow still works from a link.

## What is logged

- **The app**: nothing leaves the device. No `console` call in `src`, no `sessionStorage`, no cookies, no analytics, no service worker. React's error hooks are no-ops so an error carrying link text never reaches the console. Guards: `apps/hand/tests/guards/secrets.test.ts`; `tests/e2e/guards/hygiene.spec.ts` searches every request, console line and storage entry of a run for the seed as hex, base64url and decimal digits.
- **Face** (`apps/face`) and **`infra/stand/static.ts`**: method, path without the query, status. Never a fragment, never `d`.
- **The stand's relay** (`infra/relay/relay.ts`): counts only (stored, accepted, rejected, clients).

## Headers

Face and `static.ts` send `Content-Security-Policy: default-src 'self'; script-src 'self'; … connect-src 'self' <rpc> <relay>; frame-ancestors 'none'` and `Referrer-Policy: no-referrer` (`apps/face/src/headers.ts`). `exit.html` alone also allows any RPC the reader types, and the hash of its one inline script. No third-party script from another origin.

A build whose configuration has `privy` adds Privy's sources and nothing else (`apps/hand/csp.ts` `PRIVY_CSP`, the same in face's `PRIVY_SOURCES`, `FACE_PRIVY=1`): `https://auth.privy.io` and `https://*.rpc.privy.systems` in `connect-src`, and `frame-src` / `child-src https://auth.privy.io` for Privy's sign-in and key frame. `exit.html` never gets them.

## Email through Privy

A person without a crypto app picks "Continue with email" («Продолжить с почтой») at the top of the connect sheet; where the configuration has `privy`, the control that opens it says "Log in" («Войти») instead of "Connect a wallet", and the helper's "Where should the money land?" offers "Get paid to an email account" first: Privy's own window asks for the address and the emailed code, makes a wallet for a newcomer (`createOnLogin: users-without-wallets`) and keeps its key inside its frame on `auth.privy.io`. In the app it is one more wagmi connector (`apps/hand/src/wallet/privy.ts`) over the EIP-1193 provider of that wallet, so raise (approve, then raise, as two steps: Privy's wallet has no EIP-5792 batch), give and shake signatures (`eth_signTypedData_v4`), thanks, refunds and withdrawals take the same path as a browser wallet. No `@privy-io/wagmi`: the wallet layer has no React providers to adapt.

- Configuration: `"privy": { "appId": "…", "origins": ["https://ahand.in", "https://*.ahand.in"] }` (public; it ships in every page). `origins` copies the Privy dashboard's allowed domains: on any other site address the sheet says at once that email can't be reached, because Privy would still open its email window there and fail only after the person typed their email (its key frame is refused by its `frame-ancestors`). `base-sepolia.json` has it; the local stand's configurations do not (Privy's wallets cannot reach a local chain, and `parseConfig` refuses the pair). The build defines `__AHAND_PRIVY__` from it: without `privy` no Privy code is emitted.
- Loading: Privy's SDK (`@privy-io/react-auth`, about 270 chunks) loads only when email is picked; a page's first load carries none of it (`tests/vercel.test.ts`, `tests/bundle/build.test.ts`). The bundle audit lists the chunks only `privy-host-*.js` reaches as Privy's (`tests/bundle/audit.ts privySdkFiles`).
- Choices: email only (Privy's Google login leaves the page and comes back, and a Hand's link keeps its secret only in the page's memory); Privy's own confirmation windows off (`showWalletUIs: false`): the app's review step and progress rail are the confirmation, and a Privy window opened from inside one of the app's sheets (a modal `<dialog>`) could not be clicked. This is a proposed deviation, not an owner decision: it departs from R-23 and R-29's "the wallet shows every field" and widens D-21 to email accounts (`docs/defaults.md`, question 10). So that an email account still sees what it confirms, the give screen's agreement keeps the contract and the hand's number in the calm view when the connected account is an email account. A browser wallet still shows its own confirmation. Privy's window takes the app's theme and the landing title in the app's language; the rest of it is Privy's English.
- viem: the root `overrides` pin viem 2.52.0 for the whole tree, while `@privy-io/react-auth` 3.51.3 pins 2.57.8 and its subpackages ask for `^2.57.8`, so Privy's code runs on the older viem. The build and the email window work; Privy's own signing and sending (`eth_signTypedData_v4`, `eth_sendTransaction`, `wallet_switchEthereumChain` inside its provider) have not run against it, since no real email round has been done. Run one before relying on it.
- Privy unreachable: offline, at once; blocked or not answering, after 15 s; a site address outside `privy.origins`, at once. The sheet says "Email can't be reached right now…" and the browser's wallets work as before. Closing Privy's window reads as "You said no". After the code, the sheet comes back with "Opening the email step…" while Privy makes or fetches the wallet.
- "Disconnect" ends the Privy session on the device; a session still open after a reload lets "Continue with email" through without a new code.

## Not built

Links to a personal wallet (`addressed`, D-45), WalletConnect and Coinbase's `baseAccount` (D-29), Google and other social logins through Privy, a paymaster (D-28), ENS names without an L1 RPC, local nicknames (D-56), WebKit tests (D-57).
