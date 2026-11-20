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
| `apps/face/src/og.tsx` | the PNG: satori 0.63.2 + `@resvg/resvg-js` 2.6.2, ported from `apps/web/app/server/og/render.ts`; `cardCache`, an LRU of drawn cards keyed by the card's model (2 048 cards, 32 MiB) |
| `apps/face/src/render-pool.ts`, `render-worker.ts` | two worker threads that draw cards, with a queue of 16 in front; beyond that a card request is refused at once (round 1) |
| `apps/face/src/compress.ts` | Accept-Encoding: brotli, else gzip, else the bytes as they are; the build's files compressed once in memory, a page with tags per response (round 1) |
| `apps/face/src/lru.ts` | the least-recently-used memory both caches use |
| `apps/face/src/words.ts` | every word in English and Russian; money and dates |
| `apps/face/src/headers.ts` | the CSP, `Referrer-Policy: no-referrer` and nosniff of ARCHITECTURE §11, plus `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` and, when `FACE_SITE` is https, `Strict-Transport-Security: max-age=31536000`, on every response |
| `apps/face/src/static.ts` | files of `FACE_DIST`, confined to that folder |
| `apps/face/src/fonts/` | Schibsted Grotesk 400/700/900 and Noto Sans 400/700 (TTF, copied from `apps/web`), IBM Plex Mono 500 latin (WOFF, from `@fontsource/ibm-plex-mono` 5.3.0). All SIL OFL 1.1 |
| `apps/face/src/og/` | the canonical lockup, `ahand-mark-{light,dark}.svg`, copied from `apps/hand/public` |
| `apps/face/tests/units.test.ts` | words, tags and escaping, CSP, file confinement, configuration; Accept-Encoding, LRU, preview memory, card cache, render pool (21 tests) |
| `apps/face/tests/face.test.ts` | live, on the wave 1 helper chain, Hands raised with the SDK; index.html as built, compression, headers, a burst of cold cards (16 tests). Ports 25100–25105 |

Routes:

```
GET /healthz                                  200 "ok"
GET /<chain>/<hand>[?d=…]                     index.html + tags
GET /<chain>/<core>/<hand>[?d=…]              the same, for a Core named in the path
GET /og/<chain>[/<core>]/<hand>.png[?d=…]     the card; th=d dark; l=ru Russian
GET /og/generic.png                           the generic card
GET anything else                             the file if it exists (exit.html, build.json, assets…, and /index.html byte for byte), else index.html + tags
other methods                                 405
```

What a card says:

- **Matched `d`** (unlisted or public): the Hand's title; a public Hand's details go into
  og:description too. An unlisted Hand's details are inside the link and never reach face.
- **Numbered address** (no `d`): the generic title, with the reward and "open until" from `hands()`.
- **Bare path, a mismatched `d`, an untrusted chain or Core, a Hand never raised, a refused
  address, an unreachable RPC**: the generic card ("Someone raised a hand. Open to see." /
  «Кто-то поднял руку. Открой и посмотри.»), status 200.
- Terms, said as the chain's (early review E-8): `$40 reward on chain · open until 29 Jan`; at a
  reward of zero `No reward on chain: a thank-you only · open until 29 Jan` and no amount anywhere; `time's up on …` when
  the latest block's timestamp is at or past the expiry; `Thanked on …`; `The $40 reward went back
  on …`. Russian forms in `words.ts`. Closed Hands get the band "this hand is closed" and no pill.
- The asker's words are set apart from the terms. og:description, twitter:description and
  description are the terms, then `. The asker wrote: “…”` / `. Слова автора: «…»`. On the card a
  small "in the asker's words" / «словами автора» line sits over the title, which is in quotes and
  cut to 110 characters; the title is still the largest type.
- The asker's title goes inside FSI…PDI in `<title>`, og:title, twitter:title and the image alt, and
  the details inside the description, so a direction control in them cannot reverse ` · aHand`
  (H-2). On the card every format, line or paragraph separator character is drawn as a token
  (`‹RLO›`, `‹ZWSP›`, `‹U+XXXX›`; names in `bidi.ts`, the same as the app's).
- The card's top right carries `HAND 12 · CHAIN 31337` in mono: exact, checkable data for the
  initiated, nothing for anyone else to decode.

## Verified by running

| Check | Result |
|---|---|
| `cd apps/face && bun test` | 24 pass, 0 fail (two files; the live file starts its own anvil with `startChain()` and stops it) |
| `bunx tsc --noEmit -p apps/face` | 0 errors (the TS18003 "no sources" of waves 1–2 is gone) |
| Unlisted Hand, $40: faced address | og:title and twitter:title = the title; og:description `$40 reward on chain · open until …` (before the early-review fix round: `$40 reward · open until …`); the hidden details absent; og:image = `/og/31337/<n>.png?d=…`; `<title>` = FSI title PDI · aHand; the app's script tag kept |
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

## Review round 1 (fixes)

Four findings, all reproduced first: the seven new tests in `face.test.ts` were run against the
code as committed (a temporary copy of the old `src/`) and all seven failed (no COOP, no HSTS,
`/index.html` with tags, no `Content-Encoding` twice, `/healthz` probed only twice in 13 s of a
burst, 20 RPC calls where 5 were expected); with the fixes all 37 tests pass.

**1. A burst of cold cards froze face.** A card costs about 0.4 s of satori + resvg CPU, and it ran
on the request thread. Now:

- Cards are drawn by two worker threads (`render-pool.ts`; Bun runs resvg's native module in a
  worker). The request thread only posts the model and receives the PNG.
- At most 16 cards wait. Past that a request is refused at once: the generic card in the reader's
  language and theme with `Cache-Control: no-store` (true of every Hand, but not this Hand's, so
  nobody may keep it), or `503` with `Retry-After: 5` in the second or so after a start before the
  four generic cards are drawn. The generic cards are drawn at start and never forgotten.
- `cardCache` is an LRU (2 048 cards, 32 MiB; a card is 25–40 kB) keyed by the card's model. I kept
  the model as the key on purpose: it is exactly what the picture depends on (words, terms, theme,
  language), so two spellings of one address share an entry, and a Hand whose state changed gets a
  new model, never a stale picture. A key built from the request would need the chain's state
  beside it anyway.
- `readerFor` remembers a reading per address for 5 s (`previewKey`: the path and the query
  without face's own `l` and `th`), at most 1 024 addresses, and shares a reading in progress. A
  page, its card and the card in other languages and themes cost one set of chain reads (the test
  counts RPC calls: one reading, then five more requests, zero more calls). A card already says
  `max-age=300`, so 5 s more is invisible.

Live, `bun src/server.ts` as its own program on a real built app over anvil, 20 unlisted Hands, the
reviewer's 68 concurrent cold card requests: `/healthz` probed every 20 ms throughout, median 4 ms,
maximum 0.23 s, 0.45 s, 0.71 s, 0.76 s and once 1.35 s in five runs, all on a machine at load
average 21 to 35 on 14 cores (other agents' builds and browsers). The reviewer measured 17.1 s with
the old code. 14 to 18 cards were drawn and cached, the rest answered at once with the generic card.

**2. No compression.** `compress.ts` reads Accept-Encoding (q-values, `*`, q=0 refusals) and sends
brotli, else gzip, for text of 1 kB or more (`text/*`, JSON, JS, SVG, manifest, wasm), with
`Vary: Accept-Encoding` whenever the answer could have been coded and `Content-Length` of the coded
bytes. The build's files are compressed once (brotli 11, gzip 9) on the libuv pool, warmed one by
one in the background at start, held in memory and redone if a file's size or mtime changes;
nothing is written into `FACE_DIST`, so `build.json` and the published hash do not move. The page
with a Hand's tags is compressed per response (brotli 5, gzip 6; it is under 1 kB coded). Chromium
against face: `/` 358 701 bytes on the wire for 1 069 384 decoded (was 1 165 245 for 1 165 245);
`/raise` after it 33 525. A PNG, a font and a small file are sent as they are.

**3. `/index.html` was not the built file.** Any path that names a file of the build is now served
byte for byte, `/index.html` included; only `/` and the app's other paths (a Hand's address) carry
the tags. Live: all 84 files of a real build fetched through face with `Accept-Encoding: identity`
hash, with the manifest command of `tools/manifest.ts`, to the same value as on disk.

**4. Headers.** COOP `same-origin` (the app opens no pop-up that would need `window.opener`; checked
by grep), `Permissions-Policy` for camera, microphone, geolocation (the app uses none; it uses the
clipboard, which is not restricted), and HSTS `max-age=31536000` only when `FACE_SITE` is https,
without `includeSubDomains` (that would bind every other host of the owner's domain) and without
`preload` (a list entry is hard to undo). In Chromium the app at a Hand's address ran with no
console error under these headers (screenshot below).

Screenshots, looked at: `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-face/`:
`app-hand-390-compressed.png` (the real app, its bundle sent as brotli, at an unlisted Hand's
address, phone width), `card-after-burst-ru.png` (a Russian card drawn by a worker during the burst).

Not done here, because the files are not face's: the sentence on `/core` about pages opened by
address carrying preview tags (`apps/hand/src/screens/core/en.ts`, `ru.ts`), the same COOP and
Permissions-Policy in `apps/hand/csp.ts appHeaders` (vite preview and `infra/stand/static.ts`), and
the line in `docs/deploy.md` that a public face sits behind a cache honouring `max-age=300`.
