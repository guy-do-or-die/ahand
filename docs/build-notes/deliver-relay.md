# deliver-relay: give delivery over NIP-17 and the stand's relay

Wave 2. Package `packages/deliver` (sources and tests) and `infra/relay/relay.ts` (with tests). No package.json was changed.

## What exists

`packages/deliver/src`

| File | What it does |
|---|---|
| `envelope.ts` | `Envelope`, `HandRef`, `ChatKey`; `checkEnvelope` (a clean copy of a well-formed envelope, or an error naming the field); `newChatKey`, `publicKeyOf`. Keys are 0x-prefixed 32-byte hex in the API and bare lowercase hex on the wire. |
| `wrap.ts` | `wrapEnvelope(to, envelope, secret, at?) → {wrap, id}`: kind 14 rumor (`p` tag = recipient, content = the envelope's JSON), sealed as kind 13 by the chat key, gift-wrapped as kind 1059 by a throwaway key, NIP-44 v2 at both layers (nostr-tools 2.26.1 `nip59`). `unwrapEnvelope(wrap, secret) → {envelope, from, id, at}` with every check written out (below). |
| `transport.ts` | `nostrTransport(relays, {timeoutMs = 3000, maxBackoffMs = 30000, WebSocket?})` → `GiveTransport`. Its own small NIP-01 client over the global `WebSocket` (works in Bun and in the browser); nostr-tools' pool is not used. |
| `outbox.ts` | `openOutbox(transport, store, {everyMs = 30000, need = 1, onChange?, now?})` → `{send, flush, list, forget, close}` over any `{get, set, delete, keys}` store (a `Map` satisfies it as is; values are plain data for IndexedDB). |
| `index.ts` | Exports only. |

`infra/relay/relay.ts`: `startRelay({port, hostname?, log?})` and, run as a program, `PORT=<n> [HOST=127.0.0.1] bun infra/relay/relay.ts` (exits 2 without PORT; stops on SIGINT/SIGTERM with exit 0). In memory, kind 1059 only, at most 10 000 events (oldest dropped), 1 MiB per message, 20 subscriptions per client. EVENT → `OK true` (stored), `OK true "duplicate:"`, or `OK false` (`blocked:` other kind, `invalid:` bad id/signature/shape). REQ with `kinds`, `ids`, `#p`, `since`, `until`, `limit` → stored matches, newest first, then `EOSE`; new events are pushed to open subscriptions; `CLOSE` ends one; an unsupported filter gets `CLOSED`, nonsense gets `NOTICE`. NIP-11 document on `Accept: application/nostr+json`. Every log line is counts only (stored, accepted, rejected, clients, subscriptions): no content, no event id, no key; a test checks it.

### Interface (the contract for waves 3–4)

```ts
send(to: Hex, envelope: Envelope | Omit<Envelope, "replyTo">, from?: Hex, at?: number): Promise<{acks, of, key, id}>
listen(secret: Hex, onEnvelope: (envelope, from: Hex, meta: {id, at}) => void, since?: number): () => void
```

- `from` is the chat key's secret. Without it a fresh random key is made and returned as `key`; the caller keeps it (D-42). The outbox does this for the app and stores the key in the entry.
- `id` is the rumor's id: one per message. The same `at` gives the same id on a retry, and a listener calls back once per id even when several wraps or relays bring it.
- `listen` reconnects with doubling pauses (0.5 s up to `maxBackoffMs`) until the returned function is called.

### Checks on the way in (`unwrapEnvelope`, in order)

Wrap kind 1059 and at most 1 MiB of content; NIP-44 decryption of the wrap (a third key fails here); seal kind 13; seal id and signature (`verifyEvent` on a fresh copy of its fields, so no cached flag is trusted); decryption of the seal; **rumor author = seal author**; rumor kind 14; rumor id = hash of its fields; the rumor's `p` tag names the reader; the content parses as an envelope of the documented shape (unknown fields dropped); `replyTo` = the sender's key. Anything that fails is ignored by `listen` (a stranger's bytes, not a message).

## Choices the design did not make

- **`replyTo` must equal the sender's key**, checked when wrapping, in the outbox before writing, and when unwrapping. In every flow of the design it is (the giver signs with the chat key, the raiser with the inbox key), and it stops a sender from steering answers to someone else's key. `send` fills it in when it is left out.
- **`send` keeps the wave 1 stub's third argument `from` (optional) and adds `at`**, and returns `key` and `id` besides `acks`/`of`. Compatible with the stub; the brief's two-argument form works.
- **`since` is honoured on the rumor's time.** NIP-59 back-dates the seal and wrap by up to two days, so the relay filter asks from `since − 2 days` and the listener drops rumors older than `since`.
- **Delivered means `acks ≥ need`, default 1**, matching "Delivered to 1 of 1 relay". The ADR's 3-of-5 rule is not applied (no public relays tonight); `need` is the knob.
- **The outbox never deletes on its own.** Delivered entries stay with their chat key (the thread needs it after a reload); `forget(key)` is the only exit. An attempt that throws (for example a relay limit) is recorded in `error` and retried. A malformed envelope is refused before it is written, so the outbox holds only sendable messages. An entry forgotten during an attempt is not written back.
- **No size cap of our own on the envelope.** nostr-tools 2.26.1's NIP-44 accepts up to 4 GiB (extended length prefix); the reader refuses wraps over 1 MiB and the stand relay messages over 1 MiB, both far above a give link (2 000 bytes → about 5 kB wrapped; 40 000 bytes tested).
- **Ports in tests**: relay tests 15100–15119, delivery tests 15120–15149, each picked by trying to bind.

## Run, with results (2026-11-20, this machine)

| Command | Result |
|---|---|
| `cd packages/deliver && bun test` | 34 pass, 0 fail (run five times, once in parallel with the relay suite) |
| `cd infra/relay && bun test` | 7 pass, 0 fail |
| `bunx tsc --noEmit -p packages/deliver`, `-p infra/relay` | 0 errors each |
| `grep -rn "wss://" packages/deliver infra/relay` | no output (exit 1) |
| `sha256sum contracts/src/AHandCore.sol` | `118f4d37…d738` |

What those tests run live (the relay as its own process from `infra/relay/relay.ts`, real WebSockets on 127.0.0.1):

- A give (600 bytes) and two notes between two transports: the raiser hears the give with the giver's fresh key as `replyTo`, answers to it with the inbox key, the giver answers again with the kept key; each side gets exactly the sent envelope, and nothing more.
- One live relay and one dead address → `{acks: 1, of: 2}`. A relay that never answers and one that answers `OK false` are not counted; the send takes 3 s (asserted 2.9–4.5 s). An `OK` for another event id is not counted.
- Relay down → `{acks: 0, of: 1}`, the entry is in the Map with its chat key and retried by the timer; the relay is started again on the same port → the timer delivers it, the listener hears it exactly once, further rounds send nothing.
- An outbox reopened over the same store delivers what an earlier one left. An async (IndexedDB-like, `structuredClone`) store works.
- A listener survives a relay restart and hears what arrives after it.
- Third key and the sender's own key cannot unwrap; a seal by another key than the rumor's author is rejected; wrong `replyTo`, wrong recipient, wrong kind, changed rumor id, non-JSON content are rejected.
- 2 000-byte give envelope round-trips unchanged, through the relay and in isolation; 40 kB with Cyrillic and emoji text too.
- Default retry period is 30 000 ms, and `close` clears the timer.

## Not verified

- Any public relay, `wss://`, or a browser's WebSocket (the code uses only the standard `WebSocket` API; the app's run in waves 3–4 will be the first browser use). Relay retention beyond the stand's memory.
- Nothing here is visible on screen, so no screenshots were taken for this package.
- The IndexedDB adapter itself: the outbox was run over a Map and over an async structured-cloning stand-in, not over real IndexedDB.

## For the integrator and later waves

- The stand (wave 3) starts the relay with `PORT=<18547 + 10·N> bun infra/relay/relay.ts` and waits for the line containing `listening` on stdout; SIGTERM stops it with exit 0.
- The app's device store passes its `outbox` object store to `openOutbox` as `{get, set, delete, keys}`; entries are keyed by `entry.key`.
- The CSP's `connect-src` must list the configured relay URLs (ARCHITECTURE §11), since the transport opens WebSockets to them directly.

## Checked by the wave 2 integrator

- `apps/hand/tests/integration/outbox.test.ts`: `openOutbox` over the app's own IndexedDB `outbox` store (`outboxStore()` in `store/db.ts`, fake-indexeddb under Bun) with `nostrTransport` to `infra/relay/relay.ts` run as a process on port 19060. The give arrives once at the inbox key with `replyTo` the chat key; after the database is closed and a new outbox opened, the entry is there with the same key, chat key, message id and `deliveredAt`. Still not run: a browser's WebSocket and a browser's IndexedDB.
