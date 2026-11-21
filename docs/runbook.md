# Runbook

```sh
$ bun infra/stand/stand.ts stop --slot 3 relay        # the relay is down
$ bun infra/stand/drill.ts --slot 3 --reuse            # …and money still moves
  [2] ok  ahand.sh thank (sent by the raiser with cast): Hand 24 closedAt 1798609251, thanks() = the give hash
drill passed
```

What to do when a part is down. Core has no pause and no rescue function, because Core has neither an owner nor a switch: nothing on this page can stop, undo or move money other than by Core's own rules. Each entry says what still works, what to tell people, and which test shows it.

## The relay is down

Answers are not delivered in the app. Raise, open, pass, give, thank from a pasted link, refund and withdraw all still work.

- The helper's screen says: "We couldn't reach them directly. Send this back to whoever sent you the link." The give link holds no secret; anyone can carry it. The asker pastes it into `/thank`; Core's `checkGive` is the judge.
- The helper's outbox keeps the answer and its chat key on the device and retries every 30 seconds (`packages/deliver/src/outbox.ts`); nothing is lost by waiting.
- Shown by: `tests/e2e/drill.spec.ts` step 2 and `drill.ts` stage 2 (relay off, the answer pasted, thanked).
- On the stand: `bun infra/stand/stand.ts start --slot N relay`.

## Face is down

Everything works; only link previews are lost. Any static host with an "all paths → `index.html`" rule serves the app; a bare `/#link` needs not even that. On the stand: `bun infra/stand/stand.ts start --slot N static` serves the same folder with `infra/stand/static.ts`, with the same headers. Shown by `drill.ts` stage 1.

## The whole site is down

Money moves with [`exit.html`](without-the-site.md) from any copy or local server, with `contracts/exit/ahand.sh`, or with a block explorer. A link can be passed with any copy of the app (the build is a folder of files) or with `bun tools/ahand.ts pass`. Shown by `drill.ts` stage 3 and `tests/e2e/drill.spec.ts` step 3.

## The RPC is down

Every chain read and write stops; reading a link's route and words offline still works (`/check` runs its offline half). The screens say "Can't reach the network right now. Nothing was sent." and claim nothing that depends on "now". Fix: set another RPC in the build configuration (`rpcUrls` in the stand's `config.json`; see `apps/hand/src/config/`); `exit.html` and `ahand.sh` take any RPC address. A send that was already broadcast is not resent automatically: the app stores the intent and hash before waiting and resumes from them.

## The sequencer stops near an expiry

On Base a sequencer outage can stop blocks. A thank sent in the last minutes may then land after the expiry, where Core refuses it (`Expired`), and after that only a refund is possible. There is no grace period in Core.

- Prevention is the only remedy: extend **well before** the end. `extend` works until the expiry second and keeps every route collected so far. `/care/<chain>/<hand>` warns when under ten minutes remain (by the network's clock; the warning is the app's own) and makes a calendar reminder.
- If a thank was missed: after the expiry anyone can `refund`; the asker can raise a new Hand, but every link of the old one opens as closed.

## A token turns hostile

If the reward's token stops moving or changes its rules after rewards are locked, everything held in that token is stuck in Core: rewards, waiting money and the way back to the asker. USDC's issuer can freeze any address, Core's own included, or the whole token.

- A frozen or refusing **payee**: that payout becomes `Pending` and the rest of the receipt is paid; the payee takes it out later to another address with `withdraw` (only the payee may choose another address). `/waiting` and `ahand.sh pending|withdraw` do it. Shown by the `pending` part of `bun infra/stand/loop.ts` and the `blocked` fixture.
- A frozen **Core** or a stopped token: nothing in Core can move it. Say so; do not promise a date.
- A token that takes a cut on its own: `Paid` means it left Core; the payee may get less. Never show `Paid` as the amount received.
- The app offers only the chain's dollar token (D-27), and `/raise` says the issuer line under the reward.

## A lost link

- **The asker on the same device**: `/my` rebuilds the root link after one keys confirmation (the device keeps the book and `n`). From a clone: `bun tools/ahand.ts recover --book <16 hex> --rpc $RPC <handId>`, with the keys signature on standard input. The description does not come back (it is never on chain); the saved link in the asker's own messages is the full copy.
- **The asker on another device**: needs the first device's 16-character book code, which is not a secret.
- **Nobody can rebuild it**: nobody can be thanked; after the end anyone can `refund` and the reward goes back to the asker.
- **A holder** who lost a link asks whoever sent it for it again; the passes it made still count.

## Tell people

The footer no longer says `UNAUDITED · CORE 0x… · NO OWNER · NO FEE`: removed by the owner's decision of 2026-11-21 ([app](app.md)). The footer is the three links and the lens and theme switches; under the lens only, `CORE 0x…` links to /core. "Unaudited" is said in full at the end of /limits (`limits.unaudited.say`) and on /core; `exit.html` dropped it too, the same day. [limits](limits.md) is the list to link to.
