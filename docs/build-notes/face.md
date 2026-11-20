# Build note: face (wave 3)

Face is the optional front of the site (ARCHITECTURE §9, §14; DECISIONS D-4). It serves the built
app's files and, for the part of an address before `#`, adds what a messenger's preview robot
reads: Open Graph and Twitter tags, and a 1200×630 card. It never receives a fragment, holds no
key, and logs one line per request: method, path without the query, status.

## What exists

| File | What it does |
|---|---|
| `apps/face/src/server.ts` | `node:http` server run by Bun (`bun apps/face/src/server.ts`); `createFace(config, {client?, log?})` for tests; `main()` reads the environment |
| `apps/face/src/config.ts` | `FACE_PORT`, `FACE_DIST`, `FACE_RPC`, `FACE_CHAIN`, `FACE_CORES`, `FACE_CANONICAL`, `FACE_SITE`; optional `FACE_RELAYS` and `FACE_HOST` (below) |
| `apps/face/src/preview.ts` | `readerFor(config)`: the SDK's `faceOf` with the SDK's `getHandFor` limited to `FACE_CORES` on `FACE_CHAIN`; terms from `readHand` (`hands()`), state by `stateAt(chainNow().timestamp)`; the token's symbol and decimals read from the token once |
| `apps/face/src/meta.ts` | the card's words, the tags, `withCard(index.html, card)` (old og/twitter tags removed, the page title set only when a title matched) |
| `apps/face/src/og.tsx` | the PNG: satori 0.63.2 + `@resvg/resvg-js` 2.6.2, ported from `apps/web/app/server/og/render.ts`; a small render cache keyed by the card's model |
| `apps/face/src/words.ts` | every word in English and Russian; money and dates |
| `apps/face/src/headers.ts` | the CSP and `Referrer-Policy: no-referrer` of ARCHITECTURE §11 on every response |
| `apps/face/src/static.ts` | files of `FACE_DIST`, confined to that folder |
| `apps/face/src/fonts/` | Schibsted Grotesk 400/700/900 and Noto Sans 400/700 (TTF, copied from `apps/web`), IBM Plex Mono 500 latin (WOFF, from `@fontsource/ibm-plex-mono` 5.3.0). All SIL OFL 1.1 |
| `apps/face/src/og/` | the canonical lockup, `ahand-mark-{light,dark}.svg`, copied from `apps/hand/public` |
| `apps/face/tests/units.test.ts` | words, tags and escaping, CSP, file confinement, configuration (14 tests) |
| `apps/face/tests/face.test.ts` | live, on the wave 1 helper chain, Hands raised with the SDK (10 tests) |

Routes:

```
GET /healthz                                  200 "ok"
GET /<chain>/<hand>[?d=…]                     index.html + tags
GET /<chain>/<core>/<hand>[?d=…]              the same, for a Core named in the path
GET /og/<chain>[/<core>]/<hand>.png[?d=…]     the card; th=d dark; l=ru Russian
GET /og/generic.png                           the generic card
GET anything else                             the file if it exists (exit.html, build.json, assets…), else index.html
other methods                                 405
```

What a card says:

- **Matched `d`** (unlisted or public): the Hand's title; a public Hand's details go into
  og:description too. An unlisted Hand's details are inside the link and never reach face.
- **Numbered address** (no `d`): the generic title, with the reward and "open until" from `hands()`.
- **Bare path, a mismatched `d`, an untrusted chain or Core, a Hand never raised, a refused
  address, an unreachable RPC**: the generic card ("Someone raised a hand. Open to see." /
  «Кто-то поднял руку. Открой и посмотри.»), status 200.
- Terms: `$40 reward · open until 29 Jan`; at a reward of zero
  `No reward: a thank-you only · open until 29 Jan` and no amount anywhere; `time's up on …` when
  the latest block's timestamp is at or past the expiry; `Thanked on …`; `The $40 reward went back
  on …`. Russian forms in `words.ts`. Closed Hands get the band "this hand is closed" and no pill.
- The card's top right carries `HAND 12 · CHAIN 31337` in mono: exact, checkable data for the
  initiated, nothing for anyone else to decode.

## Verified by running

| Check | Result |
|---|---|
| `cd apps/face && bun test` | 24 pass, 0 fail (two files; the live file starts its own anvil with `startChain()` and stops it) |
| `bunx tsc --noEmit -p apps/face` | 0 errors (the TS18003 "no sources" of waves 1–2 is gone) |
| Unlisted Hand, $40: faced address | og:title and twitter:title = the title; og:description `$40 reward · open until …`; the hidden details absent; og:image = `/og/31337/<n>.png?d=…`; `<title>` = title · aHand; the app's script tag kept |
| Last byte of `d` flipped; one base64 character changed | generic title, no title text, no `$40` |
| `/`, `/raise`, `/31337/999999`, `/31337/0x1111…/1` (untrusted Core), `/1/1` (untrusted chain), `/31337/1?d=AAAA`, `d` given twice, a dark Hand's bare `/` | 200, generic title and description, generic image |
| Clock | Hand with a one-hour expiry: "open until"; `evm_increaseTime 7200` + mine (the machine's clock is 40 days behind the chain and did not move): "time's up on"; after `refund`: "The $3 reward went back on …" |
| Zero reward, public | "No reward: a thank-you only · open until …", details in the description, no `$` in the page |
| PNG | `image/png`, IHDR 1200×630, two fetches byte-identical, `th=d` differs, `l=ru` differs; unknown Hand and untrusted Core give the same bytes as `/og/generic.png` |
| Headers | CSP with every directive of §11 and `connect-src 'self' <rpc> <relay>`, `Referrer-Policy: no-referrer` on HTML, PNG, `/healthz`, `exit.html`, `build.json`, assets and fallbacks |
| Log | `GET /31337/<n> 200` and `GET /og/31337/<n>.png 200`, no `?`, no `d=` — in process and from `bun src/server.ts` as its own program with the §14 environment (port 16151) |
| Files | `exit.html` byte-identical to the file in `FACE_DIST`; `build.json` as JSON; `/assets/…` immutable; `/../../etc/passwd`, `/assets`, `/31337/1/proof` give index.html |
| resvg under Bun | loads and renders under Bun 1.4.4; Node was not needed |
| Real app in Chromium (Playwright, 390×844) | `apps/hand/dist` served by face on 16161 over a helper chain on 16160, opened with real unlisted and public links: no console error, no CSP violation; the real `exit.html` (one inline module script) ran under face's CSP with no violation |

Screenshots, looked at: `knowledge/plan/research/2026-11-20-experiment/shots/build/face/`
(`card-*` in EN/RU × light/dark for an unlisted English title and a public Russian title;
`bubble-*-390.png`: the card in a phone-width chat bubble; `app-*-390.png`; `exit-390.png`). Two
defects found and fixed: the content overflowed the right edge and the band fell off the bottom
(padding moved from the frame to each row); Cyrillic set glyph by glyph in Noto next to Latin in
Schibsted changed weight mid-line (a line with any non-Latin letter is now set in Noto Sans
throughout).

## Not verified

- No real messenger or preview robot fetched a card (none reachable from here, and none may be
  contacted). Which Accept-Language real robots send is unknown, so most will get English.
- Not run under Node 24 (not needed: resvg loads under Bun).
- Not run behind the stand (`infra/stand/stand.ts` is being written in the same wave); the
  contract of §14 was exercised by spawning `bun apps/face/src/server.ts` with those variables.
- Scripts beyond Latin, Cyrillic, Greek and Vietnamese (CJK, Arabic, Hebrew, Indic) have no font
  on the card: they would draw as empty boxes. og:title carries them as text either way.

## Decisions (mine, not the owner's)

- **Two reads per Hand.** `faceOf` goes through `getHandFor` (the trust check, `NotRaised`), then
  `readHand` and `chainNow` run in parallel for the reward, expiry, state and closing time. One
  `hands()` read more than the minimum, in exchange for using the SDK's fail-closed adapter
  exactly as the design asks.
- **Dates in UTC.** A robot has no reader time zone; the day may differ by one from the
  reader's own near midnight. The app shows local time.
- **Money**: a token whose symbol contains "USD" reads as dollars, cents cut (as the app's
  `money()`); any other token as `1.5 WETH`. Symbol and decimals are read from the token, not
  from a list face would have to be given.
- **Language**: `l=ru|en` in the query first (addresses skip foreign parameters, so the app may
  add it), then Accept-Language, then English. og:image carries `l` so the picture matches.
- **Emoji are left out of the picture only.** The card has no emoji font and a missing glyph
  draws as a box. og:title keeps the words exactly; messengers draw emoji there.
- **The title weight is Schibsted 900** (the old renderer used 700): the poster voice of
  UX-SPEC §2. A Cyrillic title falls to Noto Sans 700, the heaviest Noto here.
- **CSP additions for pages with inline code.** `script-src` also names the sha256 of each
  inline script of the HTML file being served (computed from the file at request time), so the
  single-file `exit.html` runs and nothing injected does. For `exit.html` only, `connect-src`
  adds `https: http://127.0.0.1:* http://localhost:*`, because that page takes any RPC address
  its reader types (UX-SPEC §11). Everything else gets the §11 CSP unchanged.
- **`FACE_RELAYS`** (optional, comma-separated `ws://`/`wss://`): §11 puts relay URLs in
  `connect-src`, and §14 names no variable for them; without it the app's delivery over the
  relay would be blocked by face's own header.
- **`FACE_HOST`** (optional, default `127.0.0.1`): a local stand should not listen on every
  interface; a real deployment sets it.
- **Never an error page for a preview; 405 for other methods; 404 only when `FACE_DIST` has no
  `index.html`.** A thrown error inside a request gives a plain 500 with nothing about the cause
  written anywhere (it could carry what the address held).
- **Cache**: `/assets/…` immutable; HTML `no-cache`; the PNG `max-age=300`, because a card
  follows the chain (a reward that grew, a Hand that closed).
