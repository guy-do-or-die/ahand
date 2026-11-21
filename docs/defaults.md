# About these defaults

```
D-26  Defaults at raise    helper's minimum 70% · 30 days · payoutGasK 250
      Chosen for this experiment, not by the project's owner.
```

Every fork the overnight build decided, one row each, copied from the design's `DECISIONS.md` (in the knowledge vault, `plan/research/2026-11-20-experiment/design/`). **Not one of these rows is the owner's decision**, except the part of D-21 that its last column marks (2026-11-21). The owner asked for no questions overnight, so each fork was decided by the experiment's chief designer (an AI assistant) and written down with what was rejected and how to undo it. Where a row departs from a duty in the owner's record it says **Deviation**. The owner's recorded decisions (R-N in `CORE-DECISIONS.md`) were built on and not reopened.

The settings a person feels are also on the `/defaults` screen (`apps/hand/src/screens/defaults/`), fifteen rows, each marked "Chosen for this experiment, not by the project's owner." The values in effect on a stand are in its `config.json` (`defaults: {minClaimBps, payoutGasK, expiryDays}`, `apps/hand/src/config/schema.ts`).


## A. The shape of the system

| # | Fork | Chosen | Rejected | Owner's? |
|---|---|---|---|---|
| D-1 | Which proposal is the spine | "Link first": static app, the chain as the only database, three exits. Grafted: the Deal card and honest line (layman), the passport, bundle and Core page (evidence) | Evidence-first or layman-delight as the base | no |
| D-2 | New app or evolve `apps/web` | New `apps/hand`; the design layer copied over file by file | Migrating `apps/web` in place | no |
| D-3 | Routing | A 60-line router over `pathname`; one route table | TanStack Router 1.170; TanStack Start | no |
| D-4 | Server side | None required. `face` is an optional front that serves the same files and adds preview tags | A required edge server; SSR | no |
| D-5 | History and lists | No indexer. State from views; logs in windows bounded by `findBlockAt(openedAt)`; "My hands" from the device's list; cross-time search is a bounded CLI job | A subgraph; scanning `Raised` from the deployment block in the browser | no |
| D-6 | Old packages in the install | The root `workspaces` become an explicit list of the new packages. `apps/web`, `infra/anvil`, `infra/seed`, `packages/subgraph` stay on disk but are not installed from the root on this branch | Keeping the globs | no |
| D-7 | Toolchain bumps | None: vitest 1.6.1, zod 3, TypeScript 5.9.3 and **viem 2.52.0 exactly, in every manifest and in the root overrides**. New packages test with `bun test` | Bumping vitest to 5 and zod to 4; trying viem 2.58.2 in wave 1 | no |
| D-8 | Calling Foundry | Every script calls `$FOUNDRY_BIN/forge`, `cast`, `anvil` (default `~/.foundry/bin`) | Bare `forge` | no |

## B. Contracts and deployment

| # | Fork | Chosen | Rejected | Owner's? |
|---|---|---|---|---|
| D-9 | Deployment | CREATE2 through the deterministic deployer, salt `keccak256("aHand.core/1")`, no constructor arguments (IN-25) | Salt 0; a plain `CREATE` | no |
| D-10 | What proves "this is that Core" | The initcode hash, reproducible from the commit, plus the CREATE2 derivation of the address | Comparing `eth_getCode` with a manifest served by the same site; comparing with `type(AHandCore).runtimeCode` | no |
| D-11 | Canonical Core in links | The CREATE2 address is set as `canonicalCore` in the build configuration, so links omit Core's 20 bytes as they will once a canonical Core exists | Always writing Core's address | no |
| D-12 | A link naming another Core | Refused, with the plain reason | "Opens with a warning" | no |
| D-13 | Other contracts | None: no board, no Signals, no EAS mark | An annotation contract for a board; EAS first-seen marks | no |
| D-14 | Pending demo | `BlacklistToken` (exists in `test/mocks`): a blocked payee waits, is unblocked, and is delivered | `payoutGasK = 0` offered in the product | no |

## C. Keys, signing and money

| # | Fork | Chosen | Rejected | Owner's? |
|---|---|---|---|---|
| D-15 | Where the root key comes from | Derived from one wallet signature over a fixed EIP-712 message, by HKDF with separate infos for the link seed and the inbox key (IN-27's first variant; R-30 note) | A random seed stored in the browser; the raiser's wallet as the root key (R-19 allows it, at the cost of a wallet prompt for the first pass) | no |
| D-16 | The index in the derivation | `n` = the raiser's own Hand number **in this device's book**; the book is 8 random bytes per device and raiser; `n` is taken before signing and never reused (R-31: own number, not the global counter) | `n` alone, shared across devices; `n` from the account's transaction count; a random nonce per Hand | no |
| D-17 | What recovery promises | Same device: the link is rebuilt after one confirmation. Another device: needs the first device's code, and the description still has to come from the saved link | "The same wallet restores everything anywhere" | no |
| D-18 | Signers that do not repeat signatures | Detected by asking twice, once per account and device; then a random seed, saving the link is required, the inbox key stays on the device, and a locked copy covers the minutes between sending and saving (D-63) | Detecting by "address has code" | no |
| D-19 | Protecting the keys message | The warning is the message's own text; the card and `/limits` say what a copy-cat site would gain (links and replies, never the reward) | Binding the site's origin into the message | no |
| D-20 | A giver without a wallet | Two ways, neither a default over a connected wallet: a one-time key that signs and is thrown away, with a pasted payee; or a new address made on the spot (12 words shown once, signer = payee). No signing key is ever stored | A persistent browser key in IndexedDB; a key derived from the link seed; requiring a wallet | no |
| D-21 | **Deviation: a Give without the wallet's own confirmation** | Allowed on the two wallet-less paths only, behind an in-app card with the real numbers and a deliberate swipe. **For an account Privy keeps (logged in by email, a social account or a passkey), the owner's (2026-11-21):** Privy's own confirmation windows show with the lens on and not with it off (his words in question 10 below), so with the lens off such an account is a third such path; the in-app card then keeps the contract and the hand's number in the calm view too. A crypto wallet logged in through Privy shows its own window either way | Following R-29's duty to the letter ("no Give without confirmation in the wallet"); Privy's windows always on, or always off | no; the Privy part, yes (2026-11-21) |
| D-22 | Signer identity on the pasted-address path | Optional "Keep this answer's key" download | Always discarding; always storing | no |
| D-23 | Where a share or a payout lands by default | A connected wallet if there is one; otherwise the person chooses between pasting and making an address. Zero and Core's address refused; the raiser's and the token's flagged | "This browser" as the default | no |
| D-24 | Judging a re-signed Give | By Hand and route: a later route that rejoins an earlier one after skipping holders, or the same payee or signer on a route that drops paid holders. Refused by default; override by ticking each dropped holder | Comparing by signer; refusing any differing route; typing names to override | no |
| D-25 | **Deviation: when a Give was first seen** | Stored on the raiser's device and labelled "seen on this device" | An EAS attestation (named in R-29) | no |
| D-26 | Defaults at raise | Helper's minimum 70%, 30 days, a pass keeps 0% unless chosen (D10's recorded defaults, which are themselves defaults and not the owner's decisions); `payoutGasK` **250** | `payoutGasK` 200 (the value the measurements used) | no |
| D-27 | Tokens offered | The chain's dollar token only (USDC on Base; `MockUSD` as "test dollars" locally). Core and the SDK take any ERC-20 | A token address field | no |
| D-28 | Who pays the cost, and how | ETH only, end to end. No sponsorship. A paymaster is not wired and not shown as a disabled control | A disabled "pay in USDC" option; a local EntryPoint and paymaster | no |
| D-29 | Wallets | Injected wallets by EIP-6963; a dev wallet in local builds only; since 2026-11-21 also logging in through Privy where the configuration has `privy` (the owner: «без прайви тоже мы нормисов не вовлечём никак... надо делать»), and the same day as Privy's one window with email, social accounts and wallets, WalletConnect among them (the owner: «зачем нам тридцать три модалки? нам нужно давать возможность войти сразу и через почту, и через социалки, и через кошельки через Privy»; see [app](app.md#logging-in-through-privy)) | `baseAccount`; WalletConnect outside Privy's window | no |
| D-30 | Extending near the end | Allowed until the expiry second, as Core allows (R-98). Under ten minutes the app warns, and says the warning is its own | Refusing in the last hour | no |
| D-31 | Sharing before finality | The link is shown at "In a block". The pin in a link with no Shakes binds it to these exact terms, so after a reorg it is refused, not misused | Waiting for a finalized block (about 20 minutes on Base) | no |

## D. Links, visibility, delivery

| # | Fork | Chosen | Rejected | Owner's? |
|---|---|---|---|---|
| D-32 | Default visibility | Unlisted (title in previews, the rest inside the link) | Dark; public | no |
| D-33 | Russian names of the modes | открытая / по ссылке / тёмная | приватная | no |
| D-34 | Public without a board | The whole list and both texts travel in `d` | The record's shape: a numbered address with texts "where the board is" | no |
| D-35 | A lost description (3.1 detail, not decided by the owner) | Warn and still allow passing | Blocking the pass | no |
| D-36 | **Open fork 3.3**: holders' own statements | The most reversible answer: carried as the SDK carries them, shown only in the lens as "added by a holder, not the asker"; the app never authors them; the Give's `dataHash` is 0; the giver's words go by chat | Showing holders' names on the rail; the giver's note in the Give's `dataHash` | no |
| D-37 | Who the asker is called | Always "Someone" / «Кто-то»; no name statement; no kin words | "Ana is looking for"; "a friend of a friend" | no |
| D-38 | Re-shaping an address | Keep the shape, or make it darker; never lighter | Free re-shaping in the app | no |
| D-39 | The fragment in the address bar | Read once, then removed with `replaceState`; a reload forgets the link, and the screen says so | Leaving it in the address bar; keeping it in `sessionStorage` | no |
| D-40 | How a Give reaches the raiser | NIP-17 to a per-Hand inbox on a **local relay only**; then back along the chain; then paste. This is D5's recorded default, logged as a default | XMTP (shuts down 2027-02-01); public relays tonight; an aHand mailbox (owner rejected it, 22.10); on-chain events (F04) | no |
| D-41 | Where the inbox key is committed | An `inbox.n1` statement in the Hand's own list (R-105) | A field in Core; a separate registry | no |
| D-42 | The chat key | Random per Give, stored in the giver's outbox | Memory only | no |
| D-43 | Text normalisation | Normalise on input (NFC, LF), hash exactly what is attached | Hashing as typed; normalising when reading | no |
| D-44 | QR | Always the bare address with everything inside, as digits, drawn by `qrcode` 1.5.4 with explicit segments; printing is offered by the code's real version | Quoting "a dark Hand at 0 Shakes fits version 13" | no |
| D-45 | Links to a personal wallet (`addressed`) | Not built tonight | Building the wallet-signed Shake | no |

## E. Words, proof, the look

| # | Fork | Chosen | Rejected | Owner's? |
|---|---|---|---|---|
| D-46 | The word for the money | reward / награда | pot / копилка (still in brief 06's sample lines); pocket | no |
| D-47 | The human verb for a Shake | "pass it on" / «передать дальше»; `SHAKE` in mono in the lens | "shake it on" on buttons | no |
| D-48 | The word for cost | "costs about $…" | "network cost", "fee", "gas" on the human layer | no |
| D-49 | Prices | A dated snapshot (the 2026-11-10 fee study), the OP Stack `GasPriceOracle` for the L1 part where present | A Chainlink read on Base | no |
| D-50 | Proof of a thanked Hand | Events and views first (`giveHash` rebuilt and compared with `thanks()`); signatures recovered from the transaction input as an extra, found by a selector search with a hash check | Requiring `thank` to be the top-level call | no |
| D-51 | Checking without the site | `bun tools/ahand.ts verify` from a clone; a JSON bundle that re-checks offline | Printing `npx ahand verify` | no |
| D-52 | Four states of a sent action | Sent → In a block → Recorded on Ethereum → Final; on a chain with no L1 behind it, states 3 and 4 are tagged `LOCAL STAND-IN` | Mocking the block tags; showing them as facts on anvil | no |
| D-53 | Message ids | Dotted keys, one `en.ts` and `ru.ts` per screen | The old app's "id is the English sentence" in one catalogue | no |
| D-54 | The twist | "Every hand turns over" (flip), with the marker sweep, the receipt that checks itself and "Do it without us" | The Trail with kin names; a "Check it yourself" button as the headline | no |
| D-55 | Theme | Follows the device; a switch remembers an override on the device | Nothing stored at all (the handoff's "stateless" rule) | no |
| D-56 | Names of people | Addresses first; ENS only when an L1 RPC is configured; no local nicknames tonight | Petnames | no |
| D-57 | Browsers under test | Chromium, with a 390×844 touch viewport | WebKit | no |
| D-58 | What the run proves | Recorded as a rehearsal on a local chain | Calling it M4 gate evidence | no |
| D-59 | Old documentation | Moved to `docs/archive/core-v2/` under a banner; new pages written after the code they describe | Editing in place; writing docs in an early wave | no |
| D-60 | Licence text | The README states "MIT by the plan's default D8, not yet the owner's decision"; no `LICENSE` file is added | Adding the file | no |

## F. Added after the two reviews

| # | Fork | Chosen | Rejected | Owner's? |
|---|---|---|---|---|
| D-61 | Which clock is "now" | The chain's: the latest block's timestamp, in the SDK, the app, `exit.html`, the tools and the tests. Expiry choices are `block time + days`, capped at Core's cap less 10 minutes. Every send is simulated first. Every stand's chain runs 40 days ahead of the machine | The device's `Date.now()`; a mixed rule (device clock with a tolerance) | no |
| D-62 | **A giver whose account is not deployed (R-28)** | The Give carries the ERC-6492 wrapper. At the thank the app sends the account's setup call first, in the same batch, **through a forwarder that holds nothing** (Multicall3's `aggregate3` on real networks; a test contract on the stand). Without a forwarder in the configuration, the giver is pointed to R-28's third way (a key signs, the account is the payee) | Stopping the flow (the first design: a misreading of R-28); calling the wrapper's factory directly from the raiser's account; a fixed list of allowed factories | no |
| D-63 | **Deviation: a locked copy of the seed** for signers that do not repeat | Written to IndexedDB before `raise` is sent, AES-GCM under a non-extractable device key; deleted when the raiser ticks "I saved the link" or the raise is found reverted | Memory only (a reload between sending and the receipt would leave a live Hand with no link and the reward locked until its end); a recovery code to write down before raising; a lasting encrypted backup | no |
| D-64 | A closed Hand and its author's newer one (R-27) | **Revised 2026-11-21: by Hand numbers, not logs.** The screen reads Core's `handsCount` (one call), says how many Hands were raised after this one and in how many requests, and a quiet button then reads `hands(id).raiser` for those numbers, newest first, 200 per `eth_call` through the forwarder (Multicall3's `aggregate3`), at most the newest 20 000. Any later Hand by the same address counts, even one raised while this one was open. The read can be stopped and what was found stays; plus the line "ask whoever sent you the link". Why: the first build read `Raised` logs by raiser for a day after the Hand ended (216 windows of 2 000 blocks). On Base Sepolia's public RPC, which takes at most 200 blocks per `eth_getLogs` (HTTP 413, -32614), every window was refused and the look said "Can't reach the network"; a day of logs at 200 blocks would be 2 160 requests (432 000 blocks), and a Hand that ended more than a day ago was never looked past. Numbers cost one request per 200 Hands, however long ago the Hand ended | No search at all; an unbounded scan; an indexer; `Raised` logs in shrinking windows (2 160 requests for one day at 200 blocks) | no |
| D-65 | Telling "untrusted contract" from "newer format" | `getHandFor` throws its own class, `UntrustedCore`; `unsupported` keeps the meaning "newer"; a missing canonical Core has its own sentence | Reusing `LinkError("unsupported")` | no |
| D-66 | A reward of zero | Allowed through "your call"; no approve; its own Deal card wording; a zero-reward cycle and a cycle in a second token run in `loop.ts` | Refusing zero in the app | no |
| D-67 | The token's risks | Two `/limits` entries (a token that turns hostile freezes everything held in it, the way back included; USDC's issuer can freeze) and one line under the reward on `/raise` | Leaving them to the operators' runbook | no |
| D-68 | The shape of the plan | Seven waves: ground; libraries; then the stand, fixtures, wallet layer, face and proof on finished libraries; then screens; the whole life and polish; hardening and documents; evidence. About 340 minutes | Six waves with nine packages in wave 2 importing each other's unfinished work; "build against stubs and be judged at the gate" | no |
| D-69 | Where the test tools live | Playwright, axe, TypeScript and the `@ahand/*` packages are the root package's own dependencies; one Playwright config at the root; `tests/e2e` is a folder, not a workspace | A config inside `tests/e2e` re-exported from the root | no |
| D-70 | Stands side by side | One folder, one deployment file, one Vite cache and one test-results folder per slot; a lock around `forge script`; each service stoppable alone; `stand.json` tells tests where the site is | Shared files; the reviewer's separate broadcast folder (not needed once the lock exists, and nothing reads those files) | no |

## Left for the owner

The design lists these as the questions the owner should rule on:

1. D-21: may a Give be signed without a wallet's own confirmation when the key is never kept?
2. D-16 and D-17: is a per-device book acceptable, given that it trades "any device restores the key" for "no two Hands can ever share a root key"?
3. D-34: public Hands without a board.
4. D-26: `payoutGasK` 250.
5. Fork 3.3 itself: untouched.
6. D-19: nothing stops another site from asking for the same keys confirmation.
7. D-62: setting up a giver's account through a forwarder at the thank, and which forwarder on real networks.
8. D-63: a short-lived encrypted copy of the seed on the device, and whether smart-account raisers should get a lasting one.
9. D-66: whether the app should offer a Hand with no reward at all.
10. D-21 and D-29 for accounts Privy keeps (email, social accounts, passkeys): Privy's own confirmation windows on or off. **Decided by the owner on 2026-11-21:** «в режиме лупы можно демонстрировать» ("in the lens they can be shown"). Built as: with the lens on (the footer's magnifier switch, or `?`), such an account shows Privy's own window for a Give, a shake, the keys message and every money action, after the app's own review step, so a person who checks sees what is signed in Privy's words; with the lens off it shows none, and the app's review step and progress rail are the confirmation, as before (`apps/hand/src/wallet/privy-host.tsx` sets Privy's `embeddedWallets.showWalletUIs` to the lens, and its `Host` gives Privy the settings again on every flip without mounting it again; Privy reads that setting as each request comes, including requests through the wallet's EIP-1193 provider, which take no per-request `uiOptions`; tests "Privy's own confirmation windows follow the lens", "the lens moves nothing else" and "a flip of the lens reaches Privy" in `privy-host.test.ts`). A crypto wallet logged in through Privy shows its own window either way. What stays open: Privy's window shows the raw fields, which a newcomer cannot read, but it comes only to someone who turned the lens on; for a transaction it also waits for the receipt and hands the hash back only at its "All Done", so the app's rail stays on "asking" until then (docs/app.md); an account short of gas gets Privy's "missing funds" view, and closing it reads as "no"; a window asked for from inside one of the app's sheets could not be clicked until the sheet stepped aside, and today none is (the keys sheet closes before the wallet is asked); and any page on a domain Privy's dashboard allows could still have a person log in and sign without a window, because that page sets its own `showWalletUIs`: on 2026-11-21 the allowed domains were not only `ahand.in` and `*.ahand.in` but also `*.ahand.social`, `ahand.social`, an old Vercel preview, an old ngrok tunnel and several localhost ports ([public-test-deployment.md](public-test-deployment.md#privys-dashboard), step 7). Narrowing Privy's allowed domains to the exact deploy hosts limits that, and the old preview and tunnel should go now. Not yet seen: Privy's signing and transaction windows themselves, since no real login has been done (docs/app.md, "Logging in through Privy").
11. Google, Apple and X through Privy leave the page and come back by a fresh load (Privy 3.51.3 has no pop-up for them). The owner asked for email, social accounts and wallets in one window (2026-11-21), so as built all three are offered on every screen. The raise form is kept across that trip (in `prefs`, at most 30 minutes, the asker's own words only; no seed, no link). An opened link is not (D-39 stands): a helper on a link who picks Google comes back logged in to "open the one you were sent once more", and a second tap on the link finds them logged in. The alternatives:
    - (a) As built. Security: the link's secret never touches storage. Redundancy: the link is still in the helper's messenger. Spirit: the owner's one window everywhere. Cost: one more tap for a helper who logs in with Google, Apple or X from a link. Reversible by a line.
    - (b) Carry the opened link across that one trip too (IndexedDB or the tab's `sessionStorage`, cleared on return; D-39 widened). Security: the link's secret is on disk for the length of a redirect, and a crash leaves it there until the next visit. Spirit: no extra tap. Reversible, but a written secret cannot be unwritten from devices it reached.
    - (c) Leave Google, Apple and X out wherever a link is open (the first build did this, also on the raise swipe). Security as (a). Spirit: against the owner's words on exactly the newcomer's path, where the only social left is Farcaster.
