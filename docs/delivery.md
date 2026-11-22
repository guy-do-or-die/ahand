# Delivery

How a helper's answer reaches the asker, and how the short thread after it travels. The package is `@ahand/deliver` (`packages/deliver`); the relay for local tests is `infra/relay`.

What travels here is a **give link** (the helper's signed Give, which carries no secret by format: see [links](links.md)) and short notes. Money never does: a give link pays out only when someone takes it to Core, and Core checks every signature. Delivery is a convenience on top: a give link can also be copied and sent by any other means.

## The carrier: Nostr NIP-17 on public relays

Messages are Nostr direct messages in the NIP-17 form, published to a configured list of public relays and read back from all of them. No relay is built into the package: the app's configuration names them, and [the recommended list](#recommended-relays) is where that configuration starts.

```
envelope (JSON)                     {v, kind: "give" | "note", hand, giveLink?, text?, replyTo}
 └ kind 14  rumor     unsigned      content = the envelope; tag p = recipient; created_at = the message's time
    └ kind 13  seal   signed by the sender's chat key; content = the rumor, NIP-44 v2 encrypted to the recipient
       └ kind 1059  gift wrap       signed by a throwaway key made for this wrap; content = the seal, NIP-44 v2
                                    encrypted to the recipient; tag p = recipient; created_at moved up to two days back
```

`wrapEnvelope` and `unwrapEnvelope` (`packages/deliver/src/wrap.ts`) are the layers alone. Opening a wrap checks, in order: its kind and size; its own id and signature (`verifiedWrap`); decryption of the wrap (a third key fails here); the seal's kind and signature; decryption of the seal; that the seal's author wrote the rumor; the rumor's kind, id and recipient tag; the envelope's shape (`checkEnvelope`, which drops unknown fields); and that `replyTo` is the sender's own key. Tests: `packages/deliver/tests/wrap.test.ts`.

## Keys

| Key | Whose | Where it comes from | Who learns its public half |
|---|---|---|---|
| inbox key | the asker, one per Hand | `inboxSecretOf` in the SDK, from the asker's signature over typed data naming the chain and Core ([links](links.md)) | whoever holds the description: the `inbox.n1` attachment, in `d` for a public Hand, inside the link for an unlisted or dark one |
| chat key | the helper, one per Give | `newChatKey()`, random; the outbox keeps it so the thread survives a reload | the asker, as the envelope's `replyTo` |
| throwaway key | nobody | made for each gift wrap and forgotten | every relay the wrap reaches |

Neither the inbox key nor a chat key can sign a Shake or a Give. The asker answers to `replyTo`, signing with the inbox key; the helper reads answers with the chat key.

## What a relay sees

| A relay sees | A relay does not see |
|---|---|
| the recipient's key in the `p` tag: the Hand's inbox key for a give, the helper's chat key for an answer | the envelope: the give link, the text, which Hand, the sender's chat key |
| the wrap's time, moved up to two days back, and the time it arrived | the message's real time (inside the rumor) |
| the wrap's size (no padding) | whether two wraps carry the same message |
| the IP address and connection times of whoever publishes and whoever reads | |
| a reader's filter, which names its key in `#p`; where a relay asks for NIP-42 authentication, the reader signs it with that same key | |

So a relay can count the wraps sent to one Hand's inbox key, see when they were read and from which address, and link the reader's address to that key. Where it asks for NIP-42 authentication it also gets a signed proof that the reader holds that key, which it could keep and show to others; none of the [recommended relays](#recommended-relays) asks for it. It cannot read the wraps. Who can tie the inbox key to a Hand depends on the mode ([links](links.md)): for a **public** Hand anyone who sees its address, since the key stands in `d`; for an **unlisted** or **dark** Hand only whoever holds the link, since the key travels inside it. The chain never sees any of this.

## Sending: the outbox and the "delivered" rule

`openOutbox(transport, store)` (`packages/deliver/src/outbox.ts`) writes every envelope down before sending it, in a small key-value store (IndexedDB in the app), and keeps it until the caller forgets it.

- The gift wrap is made once, on the first attempt, kept in the entry, and **republished unchanged** on every retry, so every relay holds the same event and a reader sees one message.
- Each relay's answer is kept with its reason (`publish` returns `{url, ok, reason}`: the relay's own message, or `timeout:`, `unreachable:`, `closed:`). An `OK` with `duplicate:` counts as acknowledged. A refusal that would repeat (`invalid:`, `blocked:`, `pow:`, `restricted:`, or `auth-required:` after authentication failed) stops retries to that relay for that entry; rate limits, errors, timeouts and lost connections are retried.
- **Retries** wait 10 s after the first attempt, then twice as long each time, up to 10 minutes, while the outbox is open.
- **Delivered** means acknowledged by `DELIVERED_ACKS` = **2** relays, or by every relay when fewer are configured. A reader asks every relay, so one copy is enough to read; the second copy, on another operator's relay, keeps the message if one operator loses what it kept (no public relay announces how long it keeps events, and a well-known one keeps them only in memory). With relays of three or more operators, one that is down does not hold "delivered" back. After that the outbox keeps publishing to the relays that have not acknowledged, for a day from the moment it counted as delivered (`deliveredAt`), so a message that waited offline still reaches them.
- When no relay is left to try and the entry is not delivered, it says so in `error` and stays: `refused by every relay: …`, or, when some relay did acknowledge, `acknowledged by 1 of 3, 2 needed; the others refused for good: …`. Only the refusals are listed.
- `flush()` tries every entry now. An entry whose attempt is still running (a publish waiting out its time limit while offline, say) gets one more attempt right after it, so a flush when the network comes back is a fresh try, not that older attempt's result.

Tests: `packages/deliver/tests/outbox.test.ts` (the same wrap byte for byte with pauses of 100, 200, 400 ms in a scaled-down run; 2 of 3 relays delivered and the third tried until it acknowledges; 1 of 2 not delivered; a final refusal not retried; one acknowledgement and two final refusals named as such; a flush during an attempt makes a fresh try; the remaining relays tried for a day after delivery, not after the message's time; the defaults; a round that listed an entry before it was delivered cannot show it undelivered again; a failing store reported to `onError`).

## Reading

`listen(secret, onEnvelope, since, { hand, onRelay })` subscribes on every relay for gift wraps to the key.

- **A copy counts only once it verifies and opens.** A relay can send anything under a real event id; a copy whose id is not the hash of its fields, or whose signature fails, is ignored without marking the id, so the genuine copy from another relay still gets through. Test: "forged copies … arrive first from one relay; the genuine copy from another is still heard, once" in `tests/relay-answers.test.ts`.
- **Clock margin.** `since` is lowered by `CLOCK_MARGIN` (15 minutes), so an answer from a phone whose clock is a few minutes slow is not skipped; the relay filter reaches a further two days back for the wraps' moved times. Each message is passed on once (by the rumor's id).
- **The Hand.** With `hand`, only envelopes about that Hand are passed on (`sameHand`: the same chain, Core in any letter case, the same Hand number). The sender writes that field, so a reader waiting on one Hand checks it.
- **Each relay's read** is reported through `onRelay`: `read` after the relay sent all it keeps (EOSE), `failed` with a reason when it cannot be reached, closes the subscription (`CLOSED`, with the relay's reason), does not finish within the time limit, or drops the connection first. The time limit (`timeoutMs`, 3 s) runs from the moment the socket is made, so a relay whose connection hangs is failed too. A relay that does not connect in time, or that closed the subscription and waits on an authentication that never completes, is closed and tried again; one that is connected and serving but slow is only reported, and a late EOSE reports it read.
- **Reconnection.** A failed or dropped relay is retried with growing pauses (0.5 s doubling to 30 s). The pause starts afresh only when a connection read in full and then stayed open for `stableMs` (30 s), so neither a relay that accepts connections and refuses subscriptions, nor one that answers and hangs up at once, is hammered. Each reconnection asks again from the listener's `since`: a wrap can reach a relay long after its own time (an outbox that was offline republishes it days later), so the filter is not narrowed to the last read.
- **NIP-42.** When a relay refuses with `auth-required:`, the reader authenticates once per connection, signing with the key it reads for (which its filter already names), and asks again; a publisher authenticates with a fresh throwaway key and sends the same event again. The challenge may come before or after the refusal. A challenge longer than 256 characters or with other than printable ASCII is never signed. A relay that refuses the authentication is reported as failed (for a publish, a final refusal); one that wants it and sends no challenge, or does not answer it, runs into the time limit (`timeout:`, tried again). Tests: the "AUTH" and challenge cases in `tests/relay-answers.test.ts`.

## Recommended relays

`RECOMMENDED_RELAYS` and `UNSUITABLE_RELAYS` in `packages/deliver/src/relays.ts`. Measured from one machine on 2026-11-22 with what delivery sends: one NIP-17 gift wrap (kind 1059, 4 605 bytes, back-dated up to two days as NIP-59 does, random payload, to a fresh recipient key) published anonymously to each of 34 relays, then read back on a new connection by `ids` and by `{kinds: [1059], "#p": [recipient]}` (the listener's own filter), opened with the recipient key and its payload compared. Operators are told apart by the operator key in each relay's NIP-11 document (and its address where they matched); hosting by the network of its address.

| Relay | Operator | Hosting | Software | NIP-11 message limit | Publish / read, ms |
|---|---|---|---|---|---|
| `wss://relay.primal.net` | Primal | Cloudflare | strfry 1.1.3 | 1 000 000 bytes | 185 / 102 |
| `wss://nos.lol` | nos.lol | Hetzner | strfry 1.1.3 | 131 072 bytes | 191 / 92 |
| `wss://relay.nos.social` | Nos | DigitalOcean | strfry 1.0.3 | 262 144 bytes | 191 / 191 |
| `wss://relay.ditto.pub` | Soapbox | Cloudflare | ditto-relay 2.5.1 | 4 000 000 bytes | 387 / 206 |
| `wss://relay.coinos.io` | Coinos | Cloudflare | strfry 1.1.0-beta5 | 2 097 152 bytes | 378 / 294 |

Each accepted the gift wrap from anyone, asked for no authentication, and gave it back intact by id and by `#p`, and again 5 minutes later. Five operators on three hosting networks, all keeping events on disk; one runs a different relay program, so one strfry fault cannot take out all five. Losing any two still leaves three operators. A relay may refuse an event well below its message limit (nos.lol refused an 87 769-byte test event); a 2 000-byte give link wraps to about 5 kB.

The list is provisional: the same probes are read again at one day and at one week, and a relay that loses one leaves the list. Spares that passed the same measurement: `wss://nostr.data.haus`, `wss://relay.angor.io`, `wss://nostr.azzamo.net`, `wss://relay.nostr.wirednet.jp`. `wss://nostr.mom` passed too, but it has the same operator key and address as nos.lol, so it adds no second operator.

Not suitable:

| Relay | Why |
|---|---|
| `wss://relay.damus.io` | HTTP 503 on every WebSocket upgrade from a non-browser client; from a browser it accepted the gift wrap, but reading it back by id or by `#p` needs NIP-42 authentication, which it refuses even when signed by the recipient key ("relay needs serviceUrl to be configured before AUTH can work"): it serves gift wraps to nobody |
| `wss://relay.nostr.net` | the same: accepts gift wraps, reading them needs authentication it refuses |
| `wss://relay.snort.social` | keeps events in memory: the gift wrap read back at once was gone 5 minutes later |
| `wss://relay.fountain.fm` | accepts gift wraps; a read of kind 1059 is answered "kinds not supported" |
| `wss://relay.noswhere.com` | accepts gift wraps and never serves them back |
| `wss://auth.nostr1.com` | takes and serves gift wraps only after NIP-42 authentication; this package would authenticate, but every read would prove possession of the inbox key to the relay |

Others refused the gift wrap outright (web-of-trust, paid or members-only relays, relays for other kinds only) or could not be reached.

An app's Content-Security-Policy must allow the same relays in `connect-src`, so the relay list and the CSP change together.

Not measured yet: retention after a day and after a week, daily limits per IP address. Two opt-in checks repeat the measurement from `packages/deliver`: `DELIVER_LIVE_RELAYS=1 bun test tests/live.test.ts` reads kind 1059 for a fresh key from every recommended relay and publishes nothing; `DELIVER_LIVE_PUBLISH=1 bun test tests/live.test.ts` publishes one gift wrap per relay, back-dated 47 hours, to a fresh key and reads it back by `#p`. `bun run check` contacts no host beyond 127.0.0.1.

## The local test relay

`infra/relay/relay.ts` is an in-memory NIP-01 relay for local stands and tests, never for real users.

```
PORT=18547 bun infra/relay/relay.ts        # listens on 127.0.0.1
```

- It keeps gift wraps (kind 1059) whose id and signature verify, and nothing else; other kinds get `OK false` with `blocked:`.
- Every filter must name the keys it reads for (`#p`) or the events it wants (`ids`); a filter that would list everything gets `CLOSED` with `restricted:`.
- Limits: 64 KiB per event, 64 MiB and 10 000 events in all (the oldest go first), 20 subscriptions per connection, 10 filters per `REQ`, 100 values per `ids`, `kinds` or `#p`, 256 connections (more get HTTP 503). One answer carries at most 8 MiB of stored events, newest first; when that cuts it short, a `NOTICE` starting `truncated:` says how many were sent and the `until` to ask again with, before `EOSE`.
- It listens on loopback only; `HOST` set to any other address is refused unless `RELAY_ALLOW_REMOTE=1`.
- A browser page may connect only from a loopback origin (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`) or one listed exactly in `RELAY_ALLOWED_ORIGINS` (comma-separated, for a phone on the LAN, say); any other gets HTTP 403, so a web site open in the same browser cannot fill or read the stand's relay. A client that sends no `Origin` (not a browser) is let in.
- It logs counts, never content, ids or keys.
- Tests: `infra/relay/tests/relay.test.ts`; ports 15100–15119 (`RELAY_TEST_PORTS`). The delivery package's tests start it as its own process on ports 15120–15149 (`DELIVER_TEST_PORTS`), next to scripted relays for the cases it never produces (forged copies, `CLOSED`, NIP-42, refusals).

Licences: `@ahand/deliver` is MIT; `infra/relay` is AGPL-3.0-only (`infra/relay/LICENSE`).
