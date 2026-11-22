# The view server

`apps/view` (`@ahand/view`) is the preview server: when a messenger's preview robot fetches the address of a Hand, it answers with the page's Open Graph and Twitter tags and a 1200×630 PNG card, so the link unfurls with the Hand's terms and, where the raiser made it public, its title. Run on its own, it can also be the site's front: it serves the built app's files with the security headers and compression.

It is optional. It holds no key, writes nothing to the chain and keeps no database. Without it every money action still works and links unfurl as the site's name only.

The card itself (its words, its model and its drawing) is `@ahand/card` (`packages/card`), shared with the app's /raise, which shows the same preview before a Hand is raised. The view server reads the chain and the address, and hands what it found to the card.

## What it answers

| Request | Answer |
|---|---|
| `GET /<chain>/<hand>[?d=…]`, `GET /<chain>/<core>/<hand>[?d=…]` | the app's `index.html` with the preview tags added before `</head>`; when `d` matched, the Hand's title as `<title>` too. `Cache-Control: no-cache`, `Vary: Accept-Language` |
| `GET /og/<chain>[/<core>]/<hand>.png[?d=…&th=d&l=ru]` | the card as a PNG; `th=d` for dark, `l=ru` or `Accept-Language` for Russian. `public, max-age=300`, or `no-store` when the reading failed or took too long |
| `GET /og/generic.png` | the generic card ("Someone raised a hand. Open to see.") |
| `GET /healthz` (standalone only) | `ok` |
| anything else | standalone: the built file when it exists, else `index.html`; as a function: `index.html` as built |

Only `GET` and `HEAD` are accepted (`405` otherwise); no request body is read. A `d` that does not match, an unknown chain, Core or Hand, a reading that failed or took too long: each gives the generic card with `200`, never an error page. A bare address gets the generic card's tags from the standalone server; as a function it is the host's static `index.html`, untouched.

## What it reads

The address before `#`, and nothing after it: a browser never sends the fragment, so the link itself never reaches the server. From the address it reads the chain, the Hand's number, the Core when one is named, and `d`, the public part of the description (see [links](links.md)).

From the chain, for one Hand: `hands(id)` and the latest block, sent together as one JSON-RPC batch to `VIEW_RPC` (a closed Hand adds `thanks(id)`). The reading has one deadline of 2.5 seconds, after which the answer is the generic card. CCIP-Read is off, so no contract can send the server to a URL of its choosing. Every state (open, time's up, thanked, refunded) is judged by the latest block's timestamp, never by the server's clock. The title and details are shown only after the SDK's `viewOf` matched `d` against the `dataHash` Core keeps; only Cores listed in `VIEW_CORES` on `VIEW_CHAIN` are read at all.

It never calls a token. An amount is written only in a token listed in `VIEW_TOKENS`, with the decimals and symbol written there, and in dollars ("$40") only for a token marked as a dollar there. A reward in any other token reads "A reward in a token aHand does not list", with no amount: anyone can deploy a token whose `symbol()` says "USDC".

## What it keeps and logs

- **Memory.** One reading of a Hand answers for five seconds for the same path and `d` (at most 1 024 addresses, least recently used out first); no other query parameter is part of the key, so none can force a new chain read, and none is part of the address the reading checks either, so none can turn a Hand's preview into the generic card. Drawn cards are kept by what they show (at most 2 048 cards or 32 MiB, least recently used out first). Nothing is written to disk.
- **Log.** The standalone server writes one line when it starts, with the address and port it listens on, and then one line per request: method, path without the query, status. The query (and so `d`) is never logged, nor is anything about a failure, which could carry what the address held. The function form logs nothing itself; its host may log more (see below).

What it sees, and so what any host in front of it sees too: the chain, Core and Hand number of a numbered or described address, `d` (an unlisted Hand's title, a public Hand's title and details), and the robot's or visitor's IP address and user agent.

## Configuration

Every setting is public; nothing here is a secret.

| Variable | Meaning |
|---|---|
| `VIEW_PORT` | the port to listen on (default 8080) |
| `VIEW_HOST` | the address to listen on (default `127.0.0.1`) |
| `VIEW_DIST` | the built app's folder: `index.html`, `exit.html`, `build.json`, `assets/` |
| `VIEW_RPC` | one JSON-RPC address of the chain to read |
| `VIEW_CHAIN` | that chain's id |
| `VIEW_CORES` | the Cores to trust on that chain, comma-separated |
| `VIEW_CANONICAL` | the Core an address names by leaving its address out; must be among `VIEW_CORES`. May be empty: then no Core is canonical, and an address that leaves Core's address out gets the generic card (the SDK's own default, `CANONICAL_CORE`, is not assumed) |
| `VIEW_SITE` | the site's own origin, for absolute `og:url` and `og:image` |
| `VIEW_RELAYS` | optional: the relay URLs the app talks to (`ws:` or `wss:`), comma-separated, for the CSP's `connect-src` |
| `VIEW_PRIVY` | optional: `1` when the app logs in through Privy; the CSP then names Privy's and WalletConnect's sources |
| `VIEW_TOKENS` | optional: the tokens the app lists, comma-separated, each `<address>:<decimals>:<symbol>`, with `:$` after a dollar token; `viewTokensOf` writes it from the app's token list. Left out, no token is listed and every reward reads "A reward in a token aHand does not list" |

Every variable but `VIEW_HOST` and `VIEW_DIST` is checked at start: a value that is missing where it is needed, or that cannot be read, stops the standalone server with one sentence naming the variable. `VIEW_HOST` is checked only when the server listens on it, and `VIEW_DIST` is not checked at all: a folder without the build answers `404` for the app's pages.

## Two ways to run it

**Standalone** (`src/server.ts`): the whole front of the site on any machine or container, behind a reverse proxy or CDN that ends TLS.

```sh
VIEW_DIST=… VIEW_RPC=… VIEW_CHAIN=… VIEW_CORES=… VIEW_CANONICAL=… VIEW_SITE=… VIEW_TOKENS=… \
  bun apps/view/src/server.ts
```

It serves every built file exactly as built (so `build.json`'s hashes match what is served), with the app's Content-Security-Policy (plus the hash of each inline script of the very file served), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`, a `Permissions-Policy` and, when `VIEW_SITE` is https, `Strict-Transport-Security`. Text is sent in brotli or gzip by `Accept-Encoding`. Cards are drawn by two worker threads with a queue of 16; beyond that a card request is answered at once with the generic card (`no-store`) or `503` with `Retry-After: 5`, so pages, files and `/healthz` never wait on the renderers.

For the proxy in front: `/assets/*` may be kept a year, a card five minutes, everything else revalidated each time; the server has no rate limit per client, so the proxy should have one, and every uncached Hand address costs reads at `VIEW_RPC`.

**As a function** (`src/function.ts`, entry `src/function-entry.ts`): one web-standard handler, `(request: Request) => Promise<Response>`, for a host that serves the app's files and headers itself and sends only a Hand's address and `/og/…` to the function. Cards are drawn on the request's thread; nothing is compressed and no `Strict-Transport-Security` is sent, since the host does both. `og:url` and `og:image` name `VIEW_SITE`; a caller of `viewFunction` that gives no `site` gets the request's own origin instead (`X-Forwarded-Host` when it is a plain host, so only behind a proxy that overwrites that header). Beside the bundle the deploy build puts `view.json` (the `VIEW_*` settings above), the app's `index.html`, and the fonts and lockup the card reads.

## The app's index.html

The view server adds its tags to the app's built `index.html` and serves it; it does not build the app. That file comes from `apps/web`'s build (`bun run --cwd apps/web build`, see [app.md](app.md)): in the folder `VIEW_DIST` names for the standalone server (the stand passes its own build), and beside the bundle for the function. The server never imports anything from an app, and its own tests use a stand-in, `apps/view/tests/fixtures/index.html`, so they need no built app.

## Tests

`bun run test:view` (or `bun test` in `apps/view`): the words, tags, card, configuration and caches on their own; the reader's own client against a scripted JSON-RPC node (one batch, CCIP-Read off, the deadline, the bounded memory); the server and the function against a local chain with Hands raised through the SDK, including a reward in an unlisted token that names itself like a listed dollar; the function bundled from `src/function-entry.ts` and loaded with `view.json`, `index.html`, the fonts and the lockup beside it; and the server started as its own program. Everything runs on `127.0.0.1`. The card's own words, model and drawing are tested in `packages/card` by `bun run test:card` (or `bun test` in `packages/card`).

## Licence

`@ahand/view` is AGPL-3.0-only (`apps/view/LICENSE`): whoever runs a changed copy for others to reach over a network offers them its source. So is `@ahand/card` (`packages/card/LICENSE`), the card it draws. The fonts in `apps/view/src/fonts` are OFL-1.1 (`apps/view/src/fonts/OFL.txt`).
