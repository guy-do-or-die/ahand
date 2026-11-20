# evidence: the last run, the screenshots and the report

Wave 7, 2026-11-20, 10:22–10:52 (Yerevan). Slots 0 and 9; package test ports 20000–20049. No code
of earlier waves was changed.

## What I built

- `docs/evidence.md`: every command of the brief, run once from a clean state (stands down,
  `infra/stand/.run` and `apps/hand/dist` deleted), with seconds and last lines; then the
  property table (brief 05 §2 translated to core-v3) with the seven named rows and the rows that
  were not shown and why.
- `tests/e2e/shots.spec.ts`: 29 tests. 25 screens (the a11y guard's route list plus `/dev/wallet`
  and `exit.html`) in light/dark × en-US/ru-RU × 390/1280, each in a fresh context with the
  device's colour scheme and locale; the flip's back on a two-pass Hand with Core's `ok`; the
  sweep's end state after a real thanks by dev account 1 on a fresh `give` fixture (two
  variants); face's 1200×630 preview card (en/ru × light/dark) and the generic card, fetched as
  PNG from face. Output `tests/e2e/shots/<screen>/<lang>-<theme>-<width>.png`.
- 24 chosen screenshots in the knowledge folder's `shots/`, numbered; the ones I looked at in
  `shots/build/evidence/`.
- `REPORT.md` in the knowledge folder.

## Choices the design did not make

- The sweep's end state is taken after a real thanks on /thank, not from the gallery: the gallery
  replays a sample. Only two of the eight variants (each costs a seeded Give and ~20 s).
- Screens are judged only for having rendered (`shell-main`, or the page's own marker); the guards
  judge content. Pictures use `reducedMotion: reduce` and `animations: "disabled"`, so the flip is
  at its end state.
- The exit selftest and the first-loop spec were run although the brief did not list them; they
  are cheap and they are evidence for "exit without the site" and the screen loop.

## Ran

See `docs/evidence.md`: 30 steps, every exit code 0. Shots: `29 passed (8.5m)`, 215 PNGs, 62 MB.
I looked at: landing RU 390, Hand view EN dark 1280, the sweep's end EN 390, the flip's back RU
dark 390, the preview card RU dark, the passport EN 1280, exit.html RU 390, /raise RU dark 1280.

## Seen in the screenshots (not fixed: this package changes no code)

- The fixtures' titles and descriptions are English, so the Russian screenshots show English
  user text inside Russian chrome (the seed's data, not the catalogues).
- On the flip's back at 390 px, 42-character addresses break with the last character alone on the
  next line ("…4293B" / "C").
- The thanks rail in the sweep picture stops at "Recorded on Ethereum" (LOCAL STAND-IN): the
  picture was taken as soon as every receipt row landed, before "Final".

## Not verified

The screenshots were not compared to UX-SPEC by a person; WebKit, real phones and real wallets
were not used. `tests/e2e/shots/` (62 MB) is not git-ignored; see Needs in the report.
