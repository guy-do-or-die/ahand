# drill: the survival drill (wave 5)

**This is a rehearsal on a local chain (D-58), not the plan's M4 gate evidence.** Everything ran
against anvil (chain 31337) on stand slot 7, with anvil's public test keys. A real browser wallet
was not part of it: the app used its dev wallet (local builds only), and `exit.html` used the
test-injected EIP-1193 provider of `tests/e2e/lib/exit-page/provider.ts`, which forwards to anvil.
No public network, public relay, paymaster, camera or second device took part.

## What exists

- `infra/stand/drill.ts`: `bun infra/stand/drill.ts --slot N [--reuse]`. By default it refuses a
  slot in use, brings up a fresh built stand (`stand.ts up`), runs three stages and brings the
  stand down whatever happened, then checks every slot port refuses connections. `--reuse` drills
  a built stand already up and starts again what it switched off (relay; the site as face or
  static.ts, as it was). Each step prints one `[stage] ok` line; the first mismatch prints
  `drill MISMATCH: …` and exits 1 (2 for a usage or setup failure).
  1. `stand.ts stop site`, port refused; `stand.ts start static`, stand.json says `static`. The
     dark fixture's page fetched (everything before `#`): 200, byte-identical to `dist/index.html`,
     CSP and `Referrer-Policy: no-referrer`. The SDK opens the address (Hand id, live, 0 passes).
     `tools/ahand.ts pass` prints one new address; it reads back as one pass at 0%, its page is
     served; Core's row and Core's token balance unchanged.
  2. `stand.ts stop relay`, port refused. `tools/ahand.ts thank-calldata --out` on the give
     fixture (Core's checkGive answers with the fixture's give hash); `ahand.sh thank FILE --
     --gas-limit <its worst gas> --private-key <account 1>`. Asserted: `closedAt > 0`, `thanks()`
     is the give hash, holder +5%, giver +95%, Core −reward, exactly.
  3. `stand.ts stop site`; connection attempts to the site and relay ports both refused.
     `ahand.sh refund` on a Hand raised for 3 600 s is refused ("too early") and the Hand stays
     open; `time.ts` jumps to its end; `ahand.sh refund` from a stranger: closed, no give hash,
     raiser +reward, Core −reward. `ahand.sh pending` shows Core's `pending`; the token unblocks the
     payee; `ahand.sh withdraw` from a stranger: pending → 0, payee and Core move by that amount.
     `ahand.sh status` on four Hands (open, thanked ×2, refunded) agrees with `hands()`/`thanks()`
     on state, raiser, reward, expiry and give hash.
- `tests/e2e/drill.spec.ts` (needs a built stand): (1) face off, static.ts on: a holder with no
  wallet opens the dark link and passes it at 0% on `/pass`; Core unchanged; the craft tool reads
  the new address as one 0% pass. (2) relay off: the helper (dev account 4) answers the passed
  address on `/give`, sees the fallback sentence word for word, takes the give address; the asker
  pastes it on `/thank` and thanks; Core closed, the helper's balance +the whole reward.
  (3) site off too (site, relay ports refused; chain up): `dist/exit.html` from `file://` refunds
  the expired fixture and, after the token unblocks the payee, withdraws; Core and balances
  checked; no request but the file and the RPC. `afterAll` restores relay and the original site
  server. Screenshots (390 px, EN, and RU for the fallback and exit.html) in
  `knowledge/plan/research/2026-11-20-experiment/shots/build/drill/`.
- `tests/e2e/lib/drill/ports.ts` (the spec's connection attempt), `tests/e2e/lib/drill/drill.test.ts`
  (bun test of the drill's parsing and the connection attempt, no chain).

## Choices the design did not make

- Fixtures in `drill.ts` come from the seed's library in-process (`seed(world, ["dark","give","blocked"])`
  plus one Hand raised with a one-hour expiry), under the seed's chain lock. The refund uses this
  own Hand, not the seed's `expired`, so that the drill itself shows the refusal before the end and
  the jump of the chain's clock.
- The drill's checks read Core and tokens with ABIs written in `drill.ts` (plain `eth_call`
  through viem), not through the SDK, so the SDK does not confirm itself.
- Default is a fresh stand that refuses a busy slot; `--reuse` exists for the later gates, where
  a stand is already up (wave 6/7 run `drill.ts --slot 0` with slot 0 up: they need `--reuse`, or
  must bring slot 0 down first).
- The spec chains its steps (the address passed in step 1 is answered in step 2), so it runs
  serially and a failure in step 1 fails step 2.

## Runs (2026-11-20, slot 7)

- `bun infra/stand/drill.ts --slot 7` (fresh stand, face healthy at start): exit 0, 13 `ok` lines
  over three stages, "stand down: slot 7 has nothing running"; `stand.ts status --slot 7` then
  shows chain, relay, site and dev all down. The first fresh attempt failed at `stand.ts up`
  because another package's screen was half-written (`Could not resolve './proof.css'` in
  `src/screens/proof/index.tsx`); the drill exited 2 and left nothing running; the retry a few
  minutes later passed.
- `bun infra/stand/drill.ts --slot 7 --reuse` on a running stand: exit 0, face and relay running
  again afterwards. (An earlier run stopped at `tools/ahand.ts pass` while cli-verify was mid-edit
  on `tools/ahand.ts`; it also showed that `--reuse` left static.ts in place of face, which is
  fixed: the original server is restored.)
- `STAND_SLOT=7 bunx playwright test tests/e2e/drill.spec.ts` on a freshly started built stand:
  3 passed (18.7 s); face and relay running again afterwards.
- `bun test tests/e2e/lib/drill/drill.test.ts`: 5 pass.
- `git status`: only this package's four paths are new; `stand.ts`, `static.ts`, `time.ts`
  untouched. Core sha256 118f4d37… unchanged.

## What was not verified

- A real browser wallet, a real device, public relays, a paymaster being off, Base/Sepolia.
- `exit.html` served over http with a browser-extension wallet (only `file://` with the injected provider).
- The undeployed-account thank without the site (covered by `smoke/exit.spec.ts`, not by the drill).
