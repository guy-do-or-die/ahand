# The demo engine

Real user scenarios played in the browser by several people at once. The same scenario is a
Playwright test in CI, a live show on a running app, a recorded video, and an entry of the
use-case catalogue ([CATALOGUE.md](CATALOGUE.md)).

## A show in one command

On any branch, from the root: a fresh stand on a free slot (up in about 3 s), the scenario live in
windows side by side with the director, the stand down again:

```bash
bun run show first-thanks                     # live, English
bun run show first-thanks --ru                # live, in Russian: the app, captions, names, the checks
bun run show first-thanks --record --ru       # no windows: tests/demo/videos/first-thanks.ru.mp4
bun run show model-give-fund-thank            # a path of the Hand model
bun run show --list
```

`--speed N`, `--paused` (wait for Step or Play), `--slot N`, `--keep` (leave the stand up).

The gallery: every stand scenario recorded and one static page with its video, story, people,
steps and checks, in `tests/demo/.gallery/` (`index.html`, `ru.html`, `videos/`); the `gallery`
workflow builds it for pushes to next, main and exp/** that touch the app, Core, the stand or the
engine (a newer push replaces a run still going) and keeps it as the run's artifact; the run fails
when a scenario or a video failed:

```bash
bun tests/demo/gallery.ts --ru        # about 25 minutes for every scenario; --only a,b for some
```

Russian (`DEMO_LANG=ru`, which `--ru` sets): every browser opens the app in Russian (its locale),
the checks read the app's Russian dictionaries, the captions, names, roles and the director are
Russian. A step's own caption is English; `captionRu` gives its Russian (else the verb's Russian
caption stands in), `titleRu`/`storyRu` the scenario's, `titleRu`/`detailsRu` what a raise types.

## The atlas: every screen in every state

`bun tests/demo/atlas.ts` brings a fresh stand up, seeds every fixture of `infra/stand/seed.ts`
(open by link, public, dark, a lost-and-found tag, two passes, an answer, a re-signed route, a
helper not set up yet, no reward, thanked, time's up, sent back, a share waiting for a blocked
payee) and takes a picture of each screen in each of those states, in Russian and English, light
and dark, the lens off and on, phone (390) and desktop (1280): 41 states, 656 pictures, about
35 minutes. The page
`tests/demo/.atlas/index.html` shows them with the three switches, each with a link that opens the
same screen live on the stand, which stays up for that (`--down` takes it down). Nothing in it is
mocked: Core made every state. `--only thank,hand` shoots those screens again and keeps the rest;
`--langs`, `--themes`, `--lens`, `--widths` narrow the matrix. It stays whole as the app grows:
`bun run check` and the check workflow run `atlas.ts --check-routes` (no stand), which fails when
a route of the app has no card and no reason (NOT_IN_ATLAS), or a card shows a screen that is no
longer a route; a run fails when a picture could not be taken; the `atlas` workflow rebuilds it
like the gallery, as an artifact. Serve the folder to look at it (the pictures are relative): `python3 -m http.server -d tests/demo/.atlas`.

## Run

Bring a stand up on a free slot (slot 9 is left for a long-lived local stand, and the engine never takes it):

```bash
STAND_PORT_BASE=47000 bun infra/stand/stand.ts up --slot 5
```

Every scenario, headless (25 scenarios, about 6 minutes):

```bash
STAND_PORT_BASE=47000 STAND_SLOT=5 bunx playwright test -c playwright.demo.config.ts
```

As CI runs it (`.github/workflows/check.yml`: the catalogue and atlas-route checks in job
`typecheck`, no stand; job `scenarios`): the scenarios split by count into four shards
(`--fully-parallel --shard N/4`), each shard on a runner of its own with a fresh stand, its
scenarios one after another, with `CI=1` (a trace only for a failed scenario, and a shard stops
after three failures) and `DEMO_VIDEO=on-failure` (every persona's video kept only for a failed
scenario), then the stand down; on failure the shard uploads the HTML report, which holds the
traces, screenshots and videos. One shard by hand:

```bash
bun tests/demo/catalogue.ts --check
STAND_PORT_BASE=47000 bun infra/stand/stand.ts up --slot 6
CI=1 DEMO_VIDEO=on-failure STAND_PORT_BASE=47000 STAND_SLOT=6 bunx playwright test -c playwright.demo.config.ts --fully-parallel --shard 1/4
STAND_PORT_BASE=47000 bun infra/stand/stand.ts down --slot 6
```

A live show: windows tiled side by side, a director window with Pause, Step, Play and speed
(keys: space, →, +, −), a badge and captions on every phone, Playwright's own cursor and
highlight on every press:

```bash
DEMO=1 DEMO_ONLY=first-thanks STAND_PORT_BASE=47000 STAND_SLOT=5 bunx playwright test -c playwright.demo.config.ts
```

A recording without windows, then one video with the phones side by side:

```bash
DEMO=1 DEMO_HEADLESS=1 DEMO_VIDEO=1 DEMO_ONLY=first-thanks STAND_PORT_BASE=47000 STAND_SLOT=5 bunx playwright test -c playwright.demo.config.ts
bun tests/demo/stitch.ts tests/demo/test-results/slot-5/<the test's folder>
```

| Variable | Meaning |
|---|---|
| `DEMO=1` | the director on: headed, captions, pace, tiling |
| `DEMO_SPEED` | pace, 1 by default; 2 is twice as fast |
| `DEMO_PAUSED=1` | start paused: press Step or Play in the director window |
| `DEMO_HEADLESS=1` | the director without windows (recordings in CI) |
| `DEMO_VIDEO=1` | a video per persona, and `director.png` |
| `DEMO_VIDEO=on-failure` | videos recorded, kept only for a scenario that failed |
| `DEMO_ONLY=a,b` | only these scenario ids |
| `DEMO_LANG=ru` | the show in Russian |
| `DEMO_TARGET` | `stand` (default), `fork` or `site` (see Targets) |
| `DEMO_SITE` | with `site`: the branch site's origin, e.g. `https://exp-e2e.ahand.in` |
| `DEMO_WALLETS=burner` | with `fork`: burners instead of anvil's keys, to rehearse a site run (scenarios whose SDK or seed steps act as anvil's account 1 are skipped, with the reason) |
| `DEMO_PRIVY_FILE` | another file of Privy test accounts |
| `DEMO_ACTION_TITLES=1` | show Playwright's action titles ("Click getByTestId(…)") |
| `DEMO_TRACE=0` | no trace (on by default) |

Other commands: `bun tests/demo/catalogue.ts` writes CATALOGUE.md (`--check` fails when it is
stale; `bun run check` runs it); `bun tests/demo/engine/director.check.ts` checks the director's
controls without a stand.

## Targets

A scenario says which targets it can run on; the same steps play on each. Its personas name
"test account n" (`wallet: { kind: "dev", account: n }`), and each target supplies its own:

| Target | What it is | Test account n is | Faults, clock, second token |
|---|---|---|---|
| `stand` | `infra/stand`, a slot of this checkout | the app's dev wallet | all |
| `fork` | Base Sepolia copied into anvil at its head, with the real Core and test USDC, the public build (no dev wallet), a local relay: `bun tests/demo/fork.ts up` / `down` | anvil's key n, injected through EIP-6963 (or burner n with `DEMO_WALLETS=burner`) | the clock only |
| `site` | a branch site on Base Sepolia (`DEMO_SITE`), real network, public relays | burner n | none |

Privy: the public build logs in through Privy, which answers only the origins its dashboard
allows. The fork leaves Privy out by default (people come with a crypto wallet through the app's
own sheet). `bun tests/demo/fork.ts up --privy-port 3411` keeps it and serves the site on
`http://localhost:3411` (one of `privy.origins`), for scenarios whose people sign in through Privy
(`wallet: { kind: "privy-test", account: n }`, `privy-email`): Privy's test accounts, with a fixed
code, kept outside Git in `~/.config/ahand-demo/privy-test.json` (0600) with the wallet Privy made
on the first sign-in; the fork gives that wallet test money. On such a fork the other scenarios
cannot connect their injected wallets (Privy's window has them, not the app's sheet): run
`DEMO_ONLY=privy-email` there, or bring the fork up without the flag. The stand serves the same
CSP as the build and face, Privy's sources included when its configuration has `privy`.

```bash
bun tests/demo/fork.ts up                                      # ports 47100–47102; --port-base moves them
DEMO_TARGET=fork bunx playwright test -c playwright.demo.config.ts
DEMO_TARGET=fork DEMO_WALLETS=burner bunx playwright test -c playwright.demo.config.ts   # a site run, rehearsed
bun tests/demo/fork.ts down
```

A branch site needs burners with test money, once:

```bash
bun tests/demo/burners.ts new 5        # keys in ~/.config/ahand-demo/burners.json (0600), never printed
bun tests/demo/burners.ts need         # what each burner needs for every site scenario
bun tests/demo/burners.ts status       # what they hold on Base Sepolia
DEMO_TARGET=site DEMO_SITE=https://exp-e2e.ahand.in bunx playwright test -c playwright.demo.config.ts
```

Before a scenario on a site (or with burners on a fork), a preflight checks that every burner
persona holds what its steps spend and stops the run before any browser opens if not; it also says
when the site runs another commit than this checkout. anvil's public keys never sign on a public
network, the dev wallet exists in local builds only, and the burner wallet signs for chain 84532
only. `public-pages` needs no money and runs on a site as it is.

## The Hand model

`model/hand.ts` is one Hand's life as an xstate machine whose guards are Core's rules: thank,
top up and extend only before the end and only by the raiser, send back only after it, a Hand
closes once; a link is passed on and answered while the Hand is open. Its context is kept small
(two passes, one answer, one top-up, one extension), so `xstate/graph` can walk every path:

- `model/paths.ts` lists the paths (one shortest path to each of the 36 ends, or all 153 simple
  paths), and reads every written scenario back as a path (a step the model forbids is an error,
  so the model and the scenarios cannot drift apart);
- `model/generate.ts` turns a path into a scenario: Nina raises 5 for 7 days; Alex and Bea pass
  it on keeping 10%; Gina answers; Nina tops up 5 or extends 30 days; the clock runs a day past
  the end; Nina thanks, or Vic sends it back. Its checks are the model's prediction: the Hand's
  state after each step on the chain, and who received what;
- CATALOGUE.md shows the machine as a diagram and which ends the written scenarios reach.

```bash
DEMO_MODEL=gaps STAND_PORT_BASE=47000 STAND_SLOT=5 bunx playwright test -c playwright.demo.config.ts tests/demo/model.spec.ts      # ends no scenario reaches
DEMO_MODEL=shortest …   # every end (36), what .github/workflows/model.yml runs nightly (from main only, as GitHub schedules)
DEMO_MODEL=simple DEMO_MODEL_K=6 …   # every path of at most 6 events, in every order
```

A new verb in the model is one event with its guard in `hand.ts`, its steps in `generate.ts`
and its reading in `traceOf` (`paths.ts`).

## A scenario

```ts
{
  who: "bob", do: "pass", keepBps: 1000, payee: { fresh: "bob-share" }, as: "ladder-via-bob",
  form:   [{ see: "pass.shareMoney", attr: { "data-value": "1000" } }],          // before the swipe
  expect: [
    { assert: "no-wallet-asked" },                                                 // named check (expect.ts)
    { route: "ladder-via-bob", is: [{ payee: null, keptBps: 0 }, { payee: "@bob-share", keptBps: 1000 }] },
    { balance: "@bob-share", is: "0" },
  ],
}
```

- **Verbs** (`do`):
  - a person on the screens: `raise`, `open`, `pass`, `give` (by relay or by hand), `read-answers`,
    `reply`, `thank` (from My hands, by a pasted give address, or `anyway` for a re-signed route),
    `review-thank`, `send-back`, `deliver`, `take-out`, `fund`, `extend`, `device-code`,
    `rebuild`, `check-link`, `print`, `goto`, `connect`, `reload`, `look`, `exit-thank` (exit.html
    from disk);
  - the world around them: `raise-sdk`, `pass-sdk`, `give-sdk` (a smart account not set up yet),
    `seed` (a stand fixture), `clock`, and the faults `block`, `service` (relay or site),
    `network` (one persona's RPC cut);
  - `say` only narrates.
- **Links travel like a person carries them**: a verb that makes an address stores it under `as`;
  a later verb opens it by that name.
- **Names in values**: `@name` is an address (a persona's wallet, else its fresh address, or a
  fresh address made by `payee: { fresh: "name" }`); amounts are test dollars ("45").
- **Screen checks** name a test id as `group.element` of `apps/web/src/testids.ts` and a
  sentence as a dictionary key (`raise.up`, `kit.deal.timeUp`, or `["give.delivered.one", { acks: "1" }]`
  for the whole sentence): both are typed, so a renamed id or a removed sentence does not compile.
- **Chain checks**: `hand` (Core's view), `route` and `give` (Core's own checkRoute and
  checkGive through the SDK), `balance` (`is` or `change` over the step), `pending`, `tx` (the
  step's transaction: events in order, payouts), `withdrawn`, `origins`, `link`.
- **Named checks** (`assert`) are code in `engine/expect.ts` for what does not fit one line: the
  raise's rail and terms, the receipt against the prediction and the chain, no wallet asked.
- **The lens** is on for every persona (the proof the checks read stands under it); a persona
  with `lens: false` keeps the calm view.
- **`watch`** on a scenario checks every persona's browser to the end: `local-only`, `no-errors`,
  `no-fragment-after-load`.
- **Faults** (`block`, `service`) are undone after the scenario whatever happens.

`scenarios/life.ts` and `scenarios/first-loop.ts` replaced the e2e suite's life and first-loop
specs with every check those made (and a few more); CATALOGUE.md lists each step with its checks
in plain words.

## Layout

| File | What it is |
|---|---|
| `engine/scenario.ts` | the format: personas, steps (one verb each), `form`/`expect`, end checks, `watch` |
| `engine/verbs.ts` | each verb once, with the app's own test ids and words |
| `engine/expect.ts` | the expectations and the named checks |
| `engine/words.ts` | the app's English dictionaries, by key |
| `engine/watch.ts` | a persona's requests, errors, address bar and wallet prompts |
| `engine/wallets.ts` | wallet kinds: `none`, `dev` (local builds), `injected` (EIP-6963, key in the test process), `burner`, `privy-test` |
| `engine/privy.ts` | Privy test accounts: the file, the sign-in through Privy's window |
| `engine/world.ts` | the target, its chain and tokens, the links and addresses the personas carry, faults |
| `engine/director.ts` | overlay, director window, tiling, pace, pause and step |
| `engine/play.ts` | plays one scenario as `test.step`s, then the checks; undoes faults |
| `scenarios/` | the scenarios, the tracked use cases and the planned ones |
| `scenarios.spec.ts` | one Playwright test per scenario |
| `show.ts` | a show in one command (`bun run show`) |
| `atlas.ts` | every screen in every seeded state, as pictures with live links |
| `gallery.ts` | the catalogue as a page with a video of every scenario |
| `engine/lang.ts` | the show's language: locale, Russian captions, names, the director's words |
| `model/` | the Hand model, its paths, a scenario per path |
| `model.spec.ts` | the model's paths as Playwright tests (`DEMO_MODEL`) |

## Add a scenario

Write a `defineScenario({...})` in `scenarios/`, add it to `scenarios/index.ts`, run
`bun tests/demo/catalogue.ts`. A new verb is one case in `engine/verbs.ts` and one member of
`Action`; a new check is one member of `Expectation` (or a named check); a new wallet kind is one
entry in `WALLETS`.

## Licence

The demo engine is under the GNU Affero General Public License, version 3 only (AGPL-3.0-only),
like the app and the stand it drives: see `LICENSE` here.
