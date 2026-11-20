# Build note: app-shell (wave 2)

The frame every screen is mounted in: router, route table, link intake, i18n, device store, test ids, shell, guards. No screen directory was touched; the wave 1 stubs render inside the new shell.

## What exists

| Path | What it does |
|---|---|
| `apps/hand/src/main.tsx` | Boot order: link intake first, then prefs from IndexedDB (1.5 s cap; none where storage is refused), then render. React's `onCaughtError`, `onUncaughtError` and `onRecoverableError` are no-ops, so an error carrying link text never reaches the console. |
| `apps/hand/src/app.tsx` | `resolve(usePlace())` → screen inside the shell; one error boundary per place; `useLang()` at the root re-renders every screen on a language switch without remounting it (forms keep their contents); plain `<a href="/…">` moves without a page load. |
| `apps/hand/src/router.ts` | `navigate(to, {replace, state})` over pushState (scroll reset on push; throws on `#` or a non-site path), `refresh()`, `matchPath(pattern, path, rules)`, `usePlace()`, `interceptLinks(root)`. |
| `apps/hand/src/routes.ts` | `ROUTES`, one table (ARCHITECTURE §7), each a `lazy(() => import("./screens/<name>/index.tsx"))`; `ScreenProps = { params }`; `resolve(place)`. `/` with `history.state.view === "hand"` is the Hand view. Params are checked: chain and hand are digits, core is `0x` + 40 hex. |
| `apps/hand/src/link-intake.ts` | `intake()` reads everything after the first `#` with the address before it into memory, `replaceState`s the address without it, marks `/` as the Hand view; `startIntake()` also runs on `hashchange`. |
| `apps/hand/src/store/memory.ts` | `remember`, `rememberText(text, via)` (split at the first `#`; no `#` = a bare link or QR digits), `openedLink()`, `addressOf()` (for Copy and Share), `forget()`, `useOpened()`. Memory only. |
| `apps/hand/src/store/db.ts` | IndexedDB `ahand` v1 with the eight stores of §11; `put/get/remove/all/forHand/handsOf`; `outboxStore()` (the shape of `packages/deliver`'s `OutboxStore`); `loadPrefs/setPref`; `reserveNumber(raiser)`, `bookOf`, `setRepeats`; `vaultKey`, `lockSeed(intent, seed)`, `openSeed(intent)`, `dropSeed(intent)`, `lockedIntents()`; `handKey(chainId, core, handId)`; `deviceClock()` (the one device-clock read, for labelled first-seen times). |
| `apps/hand/src/i18n/{index,catalogue,lang-en,lang-ru}.ts` | `lang-en.ts` / `lang-ru.ts` each merge `common` + `screens/*/<lang>.ts` (a key defined twice refuses to load; the dev wallet's catalogue only when `__AHAND_LOCAL__`) and are imported on demand, one chunk per language; `index.ts` compiles each with `compileMessage` when it arrives; `t`, `useLang`, `setLang` (awaits the words, then switches; kept in prefs), `initLang` (async, awaited at boot), `preloadLang`, `currentLang`, `intlLocale`. `catalogue.ts` is the glob-free half the guards import. |
| `apps/hand/src/i18n/common/{en,ru}.ts` | Shell words, the vocabulary of UX-SPEC §5, the three marks, the four TxRail states and the stand-in tag, hand states, §15 time lines, shared error lines, all 10 `link.*` ids and all 26 `core.*` ids that `messageIdOf` returns. |
| `apps/hand/src/shell/` | `Shell` (skip button, header with the local ribbon inside it, main, footer), `ErrorBoundary`, `NotFound`, `GalleryRedirect`, `lens.ts` (`useLens`, `setLens`, `toggleLens`, `?` key, `data-lens="on"` on `<html>`), `theme.ts` (`applyTheme`, `rememberTheme`, `watchTheme`). |
| `apps/hand/src/testids.ts` | `TID`, about 250 ids grouped by screen (`TID.raise.swipe` = `"raise-swipe"`), plus `TID.kit` for the shared components. Repeated elements keep one id and carry `data-value` / `data-index`. |
| `apps/hand/tests/guards/` | `secrets`, `clock`, `colour`, `words` (banned words, key parity, ICU, placeholders, key prefixes, «ты»), `store` (fake-indexeddb), `intake` (happy-dom); `files.ts` is the shared scanner. |

## Choices the design left open

1. **Hand view of a bare link = `history.state.view === "hand"` on `/`.** The fragment is never routed, so the flag rides in history state (not a secret). Back returns to it; the logo goes to the landing. After a reload memory is empty and the hand screen must say "a reload forgets it" (feat-hand).
2. **The fragment is kept exactly as written** (after the first `#`, percent-encoding untouched); the SDK judges it.
3. **`/gallery`** routes to a one-line redirect to `/gallery.html` (the kit's own entry). Vite's dev server already answers `/gallery` with `gallery.html`; the redirect matters on a static host with an index fallback. `/<chain>/<core>/<hand>/proof` was added beside `/<chain>/<hand>/proof` for non-canonical Cores.
4. **Local-only routes** are filtered by `config.chain.local` at run time, or by a build constant `__AHAND_LOCAL__` once vite defines it (see "needs"). Without it, a public build still emits the dev-wallet chunk (never routed).
5. **Theme.** Prefs hold `theme`; `watchTheme()` stores whatever sets `data-theme` on `<html>`, so the kit's `ThemeToggle` keeps working unchanged. The secrets guard tolerates `localStorage` only for the literal theme key (`THEME_KEY` / `"ahand-theme"`), which ThemeToggle still writes.
6. **Banned words**: UX-SPEC §5's list, plus "safe" (PLAN allows it only on /waiting), plus Russian stems (кошел…, газ, транзакц…, подпи[сш]…, эскроу, кастоди…, донат/пожертвовани…, баунти, комисси…, безопасн…). Exempt: keys with a `lens` segment and the dev-wallet page. Allowed phrases: "Connect a wallet"/«Подключить кошелёк» anywhere, "No fee"/«Без комиссии» in `common.footer`, "safe"/«в безопасности» under `waiting.`. **Screens: put mono specialist lines under `<screen>.lens.*` keys.**
7. **Key prefixes**: a screen's keys start with its folder name (`dev-wallet.`, `without-us.`); common holds `common.`, `link.`, `core.`. The screen `core` uses lower-case keys (`core.title`), Core's errors are `core.<ErrorName>`; a duplicate key fails both the loader and the guard.
8. **The clock guard** covers `screens/ ui/ chain/` and also `shell/`; it catches `Date.now()`, `new Date()`, `new Date`, `Date()` and `performance.now()`.
9. **The secrets guard closes sinks, not data flow**: `location.hash/href`, `document.URL` only in `link-intake.ts`; no `console` anywhere in `src`; no `sessionStorage`/cookies; `indexedDB` only in `store/db.ts`; `fetch` only of a literal same-site path; no XHR, beacon, `new WebSocket`, `EventSource`; no `searchParams.set/append`, no `URLSearchParams` built from anything but `location.search`; `pushState/replaceState` only in `router.ts` and `link-intake.ts`; no `window.open`, `location.assign` or `location =`. `gallery/` is exempt from the query and history rules only (its view switches live in its own query string; it never holds a link). The escrow check is at run time (`store.test.ts`).
10. **The locked copy** binds the intent as AES-GCM associated data and uses a fresh 12-byte IV per copy; `openSeed` returns `undefined` for a missing, moved or altered copy. A second tab racing to make the vault key adopts the first one's (`add`, then re-read).
11. **No colour functions** with raw numbers either (`rgb(…)`, `hsl(…)`, `oklch(…)`) outside the token files.
12. **Russian marks**: «Проверено здесь», «В сети», «Ждёт»; TxRail «Отправлено · В блоке · Записано в Ethereum · Окончательно». The footer line keeps the Core address in its own case and keeps each "·" part on one line.

## What I ran

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p apps/hand` | no error in my paths; the only errors are in `src/ui/qr.ts`, `src/ui/qr.test.ts` (app-design, mid-edit) |
| `cd apps/hand && bun test tests/guards` | 118 pass, 0 fail (6 files) |
| store: two concurrent `reserveNumber` → 0 and 1, same book; twenty concurrent → twenty distinct, next is 20 | pass |
| store: `lockSeed` → `openSeed` returns the seed; a dump of every store holds it in no form (hex either case, base64url, decimal, raw bytes); the vault key is a stored `CryptoKey`, `extractable: false`, `exportKey` raw and jwk reject; the key read back after reopening decrypts; a copy moved to another intent does not open; `dropSeed` leaves the store empty | pass. **fake-indexeddb under Bun 1.4.4 does hold a CryptoKey** (structured clone works), so the stored key itself was used, not a key in memory |
| intake (happy-dom): `/#<text>` → `location.href` without `#`, memory holds the text, state `view: "hand"`; numbered with `?d=` keeps path and query; empty `#` stripped; no console line, no storage entry | pass |
| Vite dev, `AHAND_CONFIG=…/config.example.json bunx vite --port 18311`, Playwright (Chromium 1255) script | 56/56: 19 paths covering every pattern but the Core-named proof render their screen; `/nope`, `/31337/abc`, `/raise/extra`, `/my/x/1` show not-found; `/#text` → href `http://127.0.0.1:18311/`, Hand view, memory holds the text; logo → landing, Back → Hand view; `/31337/12?d=AAEC#x` keeps `?d=`; `location.hash = …` in an open tab → Hand view, fragment gone; RU switch changes the footer (`БЕЗ АУДИТА …`) and sets `<html lang="ru">`, kept after reload; `?` and the 🔍 button flip the lens; footer links move without a page load; no link text in localStorage, sessionStorage, cookies, IndexedDB, console or any request URL; no horizontal overflow at 390 px in EN and RU |
| The same script against a production build (`vite build` into the scratchpad, `vite preview --port 15150`) | 55/55 (the in-page memory import is a dev-only check) |
| Error boundary, live in Chromium: a component throwing `Error("SECRET-LINK-TEXT…")` inside `ErrorBoundary` | shows "This screen stopped. / Something broke while drawing it. Nothing was sent. / Try again"; the text is nowhere in the page; nothing on the console but React's dev banner |
| Screenshots, looked at | `knowledge/plan/research/2026-11-20-experiment/shots/build/app-shell/`: landing EN/RU at 390 and 1280, not-found EN 390 and RU 1280, `/raise` RU desk, `/limits` dark with the lens on at 390 |

Both servers I started (18311, 15150) were stopped by their process ids.

## Not verified

- That a browser drops the original `/#link` entry from its history list (D-39 says so too).
- The 1.5 s prefs cap with a really blocked IndexedDB; a private window that refuses IndexedDB (code path: `loadPrefs` rejects → defaults).
- `__AHAND_LOCAL__` folding: the define does not exist yet, so the run-time branch is what ran.
- Screen readers: the skip button, focus moving to `<main>` after a route change, `aria-pressed` on the switches were not tried with a reader; axe was not run (wave 5 runs it per screen).

## Applied by the wave 2 integrator

- `vite.config.ts` defines `__AHAND_LOCAL__` from the configuration's `chain.local` (`isLocalChain()` in `vite.shared.ts`). A build with `local: false` no longer emits the dev-wallet or gallery-redirect chunks (checked by listing `dist/assets`); with the example configuration they are emitted as before.
- `ThemeToggle` and `Disclose` needed no change: the kit sets `data-theme` (the shell's `watchTheme` keeps it) and reads `data-lens` itself.
- The footer's short Core address uses the kit's `shortAddress` (same output); the unused `lib/format.ts`, `lib/ens.ts` and `hooks/useEnsIdentity.ts` of the old app were removed.

## Review round 1 fixes

### 1. Every catalogue in the entry chunk (minor) — fixed

Reproduced: a public build (`chain.local: false`) put every screen's words in both languages into `index-*.js`, the dev wallet's sentences included. The new guard `tests/guards/catalogues.test.ts` (runs two real `vite build`s, about 2 s each) failed 5 of 7 before the fix.

- `src/i18n/lang-en.ts` and `lang-ru.ts`: one module per language, each an eager glob of that language only (`screens/*/<lang>.ts` minus `dev-wallet`, plus `dev-wallet` behind `__AHAND_LOCAL__`, so a public build drops it as dead code). Imported with `import()` from `index.ts`: one chunk per language, none in the entry.
- `initLang(saved)` is async and awaited in `main.tsx` before the first render. `preloadLang()` starts fetching the device language's chunk before boot reads IndexedDB, so the extra round trip overlaps the prefs read. If the wanted language's chunk cannot be fetched the other one is tried; if neither, the ids show (the existing fallback).
- `setLang(lang)` awaits the words, then calls `i18n.activate`; a later click overtakes an earlier one still loading; a failed fetch keeps the current language and is retried on the next click. Loaded languages are cached; switching back fetches nothing.
- The common catalogue is in the language chunk too; `ui/Flip.tsx` (not mine) still imports `common/en` and `common/ru` directly, so those two small modules (6.5 kB and 9.7 kB minified) stay in the shared graph. The finding was about the screens' 216 kB, which is gone from the entry.
- The words guard (key parity, ICU, banned words) still reads the source files and passes unchanged.

Measured after the fix (public build): `lang-en-*.js` 68.6 kB, `lang-ru-*.js` 106.6 kB, neither in the entry; the dev wallet's sentences are in no emitted file. The entry chunk's total size also moved for reasons outside this fix (the gallery entry left public builds in a parallel fix, which merged a shared chunk into the entry), so compare the guard's assertions, not the entry's byte count.

### 2. The ribbon outside every landmark (polish) — fixed

`Header` now renders `<header>` containing the ribbon and then the row (lockup, EN · RU, lens); `Shell` no longer renders the ribbon on its own. Same look (checked by screenshot). Guard: `tests/guards/landmarks.test.tsx` renders the shell with the example (local) configuration and checks the ribbon sits inside the header and the frame's children are the skip button, header, main and footer; it failed on the old `Shell.tsx` and passes now.

### Also

- `tests/guards/secrets.test.ts`: the fetch rule flagged `async fetch(request) {` in `src/wallet/dev.test.ts` (another package's new test: a `Bun.serve` handler, a definition, not a request). The rule now skips method definitions named `fetch`; real calls are still held to a literal same-site path.

### What I ran (round 1)

| Check | Result |
|---|---|
| `bun test tests/guards` | 128 pass, 0 fail (9 files) |
| `bun test` (whole app) | 374 pass, 5 fail; the 5 are in `screens/thank` and `screens/check`, files other fixers are editing right now, none imports `i18n/index.ts` |
| `bunx tsc --noEmit -p apps/hand` | no error in my paths (errors remain in `screens/waiting/logic.test.ts`, another package mid-edit) |
| Playwright Chromium against `vite preview` of a local build (port 24951) and a public build (24952), no chain running | EN device: only `lang-en` fetched at start, `/raise` in English; RU click fetches `lang-ru`, then `<html lang="ru">` and Russian text; back to EN fetches nothing; RU kept after reload; RU device: only `lang-ru` fetched at start; `/dev/wallet` on the local build renders its Russian words; no page error except refused RPC connections (no chain was started); axe `region` and landmark rules: 0 violations on both builds; the ribbon is inside `<header>` on the local build and absent on the public one |
| Screenshots, looked at | `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-app-shell/`: local landing EN 1280, `/raise` EN and RU 390, `/dev/wallet` RU 390, public landing RU 390 |

Both preview servers were stopped by their process ids.
