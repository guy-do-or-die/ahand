# Build note: words (wave 6)

One hand audits both languages. Written 2026-11-20 by an AI assistant during the overnight experiment. Every wording choice below is the assistant's, not the owner's. The owner has not read the Russian.

## What changed

- **Files touched:** the catalogues (`apps/hand/src/i18n/common/{en,ru}.ts`, `apps/hand/src/screens/*/{en,ru}.ts`) and `docs/glossary.md` (new). No code changed.
- About 130 values were rewritten across 17 screens and common. One key was added: `thank.reverted.kept` (see Needs).
- **One concept, one word:**
  - A helper's Give is an **answer** everywhere. "Reply" now means only the asker's messages in the thread. Changed: `thank.checked`, `thank.branch`, `thank.done.before`, `thank.resumed`, `thank.error.*`, `check.kind.give`, `without-us.*`. `give.thread.reply` is now "Write to the asker".
  - A **route** is never a "path" or a "chain". Changed: `thank.branch`, `my.answers.noRelay`, RU `without-us.explorer.shakes`.
  - The Russian for relay is **реле**, as in UX-SPEC §8.5. «Ретранслятор» was removed from /my and /defaults.
  - **«Продлить»** is used for "Keep it open longer" on both /my and /care.
  - The Russian for **set up** an account is **настроить**, not «создать» (/defaults D-62).
  - The receipt is **квитанция** everywhere. /proof said «чек».
  - Waiting money **goes back**, not "comes back" (/landing).
  - Russian progress lines use the plural "we" throughout: Проверяем, Считаем, Читаем, Ждём. /thank and /waiting had used the first person singular (Проверяю, Считаю, Жду, Читаю).
- **Spec sentences restored word for word:** `thank.checking` is "Checking this answer with the contract…" / «Проверяем этот ответ у контракта…».
- **Honesty pass:**
  - `my.floor` promised "Whoever helps gets at least…". It now reads "If you thank a helper, they get at least…".
  - `check.core.accepted.route` promised "Whoever answers it gets…". It now names the condition: "If the asker thanks whoever answers it…".
  - `raise.error.copyLost` and `raise.error.otherTerms` said the reward "comes / goes back" after the end. Someone has to press Send it back, so they now say it "can be sent back".
  - `landing.lead` said "They are paid only if you thank them". Thanking pays everyone on the route, so it now says the helper and everyone who passed it on are paid only if you thank.
  - `defaults.d62.body` said the setup "can never spend the asker's money", but the asker pays its cost. It now says the go-between holds nothing, acts in no one's name, and the asker pays only what the setup costs.
  - `waiting.friend` said "a friend", which claims a relationship. It now says "anyone".
- **Thanking said to be voluntary:**
  - Hand view: `hand.helpNote` (the spec sentence).
  - /limits: the first entry.
  - Give screen: added "The asker decides whether to thank." / «Благодарить или нет — решает автор.» to `give.agree.intro`, the card shown just before the swipe. The Deal card above it still carries "If you help and they thank you".
- **"If they thank you" wherever an amount is promised to a helper:**
  - Deal card: `ui/words.ts deal.ifHelp`.
  - `give.words.ask`, `give.waiting`.
  - "if this route is thanked": `pass.share`, `pass.readBack.share`.
  - `my.floor` and `check.core.accepted.route` (both fixed above).
  - Justified exception: `give.agree.claimMoney` "{percent} of the reward — {amount} today", because UX-SPEC §8.5 gives it word for word on the same screen, under step 1, which says "If they thank you".
- **Russian:**
  - Removed «ничего себе» (it reads as "wow") from "kept nothing", and the calques «дать руке истечь», «путешествуют», «ездят», «Вернуть лицом», «Ждём часы сети», «Урезано».
  - Translated the print lens formulas, which were left in English.
  - Brought /my's «Передал дальше / Помог» in line with /thank's «Передали дальше / Помогли».
  - Made the /core and /limits copies of the unaudited sentence identical.
  - Kept the generic masculine of «ты» where the spec itself uses it («Ты отказался», «ты уже видел»). `print.tag.found` stays «Нашёл? Отсканируй.», which e2e `care.spec.ts` asserts.
- **USDC issuer line under the reward on /raise:** `raise.reward.issuer` (USDC) or `raise.reward.issuerStand` (stand), always rendered (`raise/index.tsx:325`, test id `raise.issuerLine`). Seen in the /raise screenshots.
- **/limits:** sixteen entries in both languages: voluntary, route, second, length, balances, blocked, forever, cap, lost, rescue, refund, token, usdc, code, keys, unaudited. Each was compared with the record's wording in `core.lens.limit.*`. None is softened, and the two token entries are the spec's words exactly.
- **The network's clock:** «по часам сети» / "the network's clock" is the only phrase for time (`core.ExpiryTooEarly`, `raise.expiry.until`, `pass.waiting`, `/defaults` D-61). Device time appears only on the dev-wallet page and in lens meta lines.
- **Three link errors:** `link.malformed` "This link is damaged…", `link.unsupported` "This link was made by a newer app.", `link.untrusted` "This link names a contract this site doesn't read…". These are three different sentences in both languages. `link.no-canonical` is a fourth.

## Checks run

| Command | Result |
|---|---|
| `cd apps/hand && bun test tests/guards` | words guard: 76 pass, 0 fail (key parity, ICU, placeholders, banned words, «ты»). Whole guard folder: 118 pass, 1 fail. The failure is `secrets.test.ts` "no navigation carries a fragment", on `screens/hand/index.tsx:43` (`replaceState`), a line the harden-app package added during this wave. It is not caused by any catalogue |
| `cd apps/hand && bun test` | 326 pass, 1 fail (the same `secrets` line) |
| `bun spec-quotes.ts apps/hand/src` (script below) | 186 quotes, 103 with Russian, 0 missing |
| identical-value check (`same.ts`) | 22 keys, all listed below as mono-only |
| banned-words grep (below) | only the justified hits |
| screenshots: Vite dev server on 127.0.0.1:19100 (no chain), Playwright Chromium 390×844, `locale` en-GB and ru-RU | 16 shots in `knowledge/plan/research/2026-11-20-experiment/shots/build/words/`. Checked by eye: landing, /raise and /limits in Russian. No horizontal scroll on any page (scrollWidth 390); `lang` attribute right. Without a chain, /raise shows its offline lines, which are catalogue sentences too. The server was stopped by its pid afterwards |

Not verified live: Hand, give, pass, thank, /my and /waiting with money on a chain. Those flows need the stand, whose ports (18xxx) are outside this package's range. The e2e specs that assert words were grepped for every replaced value. Only one of them would have broken: `care.spec.ts` asserts «Нашёл? Отсканируй.», so that change was reverted.

## Banned and doubtful words: hits and why they stay

`grep -niE "\bpot\b|pocket|копилк|комисси|\bhops?\b|escrow|gasless|guarantee|гарант"` over the catalogues:
- `common.footer` RU «Без комиссии»: the footer's "no fee" line.
- `core.lens.limit.11` RU «без комиссии»: the lens copy of the record's "no fee".
- `core.lens.limit.5.body` RU «с переключаемой комиссией»: the lens translation of the record's "fee-switching tokens". This is the specialist layer, and the term is the record's.

`grep -niE "guarantee|secure|\bsafe\b|instantly|received|trustless|\baudited|private|friend|every cent|\$0"`:
- `waiting.safe` (EN and RU): the one allowed sentence.
- `core.lens.limit.10.body` "Safe 1.4.1": a product name in the lens.
- `thank.withoutUs.lead` "--private-key": a cast flag.
- "Unaudited" / "Без аудита" lines: they deny an audit.
- The key name `waiting.friend`: its value no longer says "friend". Renaming the key needs a code change, which was not worth one.

## Keys whose two values are the same (mono-only)

| `common.language.en` | `English` |
| `common.language.ru` | `Русский` |
| `care.extend.lens.formula` | `extend(handId, min({from} + {days} d, now + cap − 600)) = {target}` |
| `care.extend.lens.max` | `extend(handId, now + cap − 600) = {target}` |
| `core.lens.domain` | `eip712Domain()` |
| `core.lens.cap` | `MAX_EXPIRY_PERIOD()` |
| `give.lens.giveHash` | `giveHash {hash}` |
| `give.lens.signer` | `Give.signer {address}` |
| `give.lens.payee` | `Give.payee {address}` |
| `give.lens.claim` | `Give.claimBps {bps} · routeHash {hash}` |
| `hand.lens.data` | `hands({id}).dataHash = {hash}` |
| `hand.lens.passes` | `passesLeft = {n} · payoutGasK {k}` |
| `hand.lens.terms` | `raiser {raiser} · token {token} · rootKey {root}` |
| `my.lens.giveHash` | `giveHash {hash}` |
| `my.lens.inbox` | `inbox.n1 {key}` |
| `raise.expiry.lens.formula` | `expiry = min(now + {days} d, now + MAX_EXPIRY_PERIOD − 600 s) = {expiry}` |
| `raise.fine.lens.terms` | `minClaimBps = {bps} · payoutGasK = {k}` |
| `thank.input.placeholder` | `https://…/#…` |
| `thank.lens.giveHash` | `giveHash {hash}` |
| `thank.lens.shakeFormula` | `{reward} × {bps} ÷ 10 000 = {amount}` |
| `thank.lens.giveFormula` | `{reward} − {paid} = {amount} · claim {bps} bps` |
| `waiting.lens.calldata` | `calldata` |

22 keys with the same value in both languages

These are the language names themselves, lens formulas built from Core's own names, and a URL placeholder.

## UX-SPEC quotes, and where each was found

Found by the script below. A Deal card or land-sheet sentence lives in the kit's own catalogue `ui/words.ts` (owned by harden-app), which the script also reads. Two kinds of quote are matched on their fixed part:
- `my.careBand` is an ICU plural, so "{n} days left." is matched on "Keep it open longer?".
- Spec examples with numbers in them ("2% — about $0.80…", "Delivered to 1 of 1 relay.") are matched against their templates.

One deliberate difference: §8.6 names the first choice "My wallet". The kit says "My connected account", because §5 bans "wallet" outside "Connect a wallet".

| § | EN quote | found (EN) | found (RU) |
|---|---|---|---|
| §4 | Someone is looking for (since review round 1: "Someone raised a hand:" / «Кто-то поднял руку:», see app-design.md) | ui/words.ts deal.intro | ui/words.ts deal.intro |
| §4 | If you help and they thank you | ui/words.ts deal.ifHelp | ui/words.ts deal.ifHelp |
| §4 | If you pass it on | ui/words.ts deal.ifPass | ui/words.ts deal.ifPass |
| §4 | keep a share you choose | ui/words.ts deal.keepShare | ui/words.ts deal.keepShare |
| §4 | If nobody is thanked by {date} | ui/words.ts deal.ifNobody | ui/words.ts deal.ifNobody |
| §4 | the whole reward goes back | ui/words.ts deal.goesBack | ui/words.ts deal.goesBack |
| §4 | {reward} reward · open until {date} | screens/raise/en.ts raise.who.money | screens/raise/ru.ts raise.who.money |
| §4 | Time's up | i18n/common/en.ts common.state.expired | (no RU in spec) |
| §4 | Thanked on {date} | i18n/common/en.ts common.state.thanked | (no RU in spec) |
| §4 | The reward went back on {date} | i18n/common/en.ts common.state.refunded | (no RU in spec) |
| §4 | No reward: a thank-you only · open until {date} | screens/raise/en.ts raise.who.moneyNone | screens/raise/ru.ts raise.who.moneyNone |
| §4 | it's free; there is no share to keep | ui/words.ts deal.passFree | ui/words.ts deal.passFree |
| §4 | the hand closes | ui/words.ts deal.closes | ui/words.ts deal.closes |
| §6 | Unaudited · Core {core} · No owner · No fee | i18n/common/en.ts common.footer | i18n/common/ru.ts common.footer |
| §6 | What it can't promise | i18n/common/en.ts common.footer.limits; screens/landing/en.ts landing.limits | i18n/common/ru.ts common.footer.limits; screens/landing/ru.ts landing.limits |
| §6 | Do it without us | i18n/common/en.ts common.footer.withoutUs; screens/care/en.ts care.lens.calls | i18n/common/ru.ts common.footer.withoutUs; screens/care/ru.ts care.lens.calls |
| §6 | About these defaults | i18n/common/en.ts common.footer.defaults; screens/limits/en.ts limits.next.defaults | i18n/common/ru.ts common.footer.defaults; screens/limits/ru.ts limits.next.defaults |
| §6 | Local test network · Test dollars | i18n/common/en.ts common.ribbon | i18n/common/ru.ts common.ribbon |
| §6 | Can't reach the network right now. Nothing was sent. | i18n/common/en.ts common.error.offline; screens/check/en.ts check.core.offline | i18n/common/ru.ts common.error.offline; screens/check/ru.ts check.core.offline |
| §7.1 | Raise a hand. Your people take it from there. | screens/landing/en.ts landing.title | screens/landing/ru.ts landing.title |
| §7.1 | Ask, and lock a reward. | screens/landing/en.ts landing.raise.say | screens/landing/ru.ts landing.raise.say |
| §7.1 | People pass it on; each may keep a share. | screens/landing/en.ts landing.pass.say | screens/landing/ru.ts landing.pass.say |
| §7.1 | Thank the one who helped — everyone on the way is paid. If nobody is thanked, the whole reward goes back. | screens/landing/en.ts landing.thank.say | screens/landing/ru.ts landing.thank.say |
| §7.1 | This address was made for {host}. The link opens anywhere; make sure you trust the site you're on. | screens/landing/en.ts landing.open.otherSite | screens/landing/ru.ts landing.open.otherSite |
| §7.1 | Raise a hand | i18n/common/en.ts common.word.raise; screens/landing/en.ts landing.raise | i18n/common/ru.ts common.word.raise; screens/landing/ru.ts landing.raise |
| §7.1 | My hands | i18n/common/en.ts common.word.myHands; screens/landing/en.ts landing.my | i18n/common/ru.ts common.word.myHands; screens/landing/ru.ts landing.my |
| §7.2 | What are you looking for? | screens/raise/en.ts raise.what | screens/raise/ru.ts raise.what |
| §7.2 | Add details | screens/raise/en.ts raise.details.add | (no RU in spec) |
| §7.2 | No reward: a thank-you only. | screens/raise/en.ts raise.reward.none | screens/raise/ru.ts raise.reward.none |
| §7.2 | Locked until you thank someone — or all of it back to you after {date}. | screens/raise/en.ts raise.reward.locked | screens/raise/ru.ts raise.reward.locked |
| §7.2 | Held in USDC. Its issuer can freeze addresses; then that money waits. | screens/raise/en.ts raise.reward.issuer | screens/raise/ru.ts raise.reward.issuer |
| §7.2 | test dollars, standing in for USDC | screens/raise/en.ts raise.reward.issuerStand | (no RU in spec) |
| §7.2 | Long hands need a nudge. You'll get a calendar reminder. | screens/raise/en.ts raise.expiry.nudge | screens/raise/ru.ts raise.expiry.nudge |
| §7.2 | The reward, the dates and your address are public in every mode. Dark is not secret writing. | screens/raise/en.ts raise.who.shared | screens/raise/ru.ts raise.who.shared |
| §7.2 | The helper gets at least {pct} | screens/raise/en.ts raise.fine.minClaim | (no RU in spec) |
| §7.2 | Room for each payout: {k} | screens/raise/en.ts raise.fine.room | (no RU in spec) |
| §7.2 | Raise your hand | screens/raise/en.ts raise.swipe | i18n/common/ru.ts common.word.raise; screens/landing/ru.ts landing.raise |
| §7.2 | Connect a wallet | i18n/common/en.ts common.word.connect; screens/raise/en.ts raise.steps.connect | i18n/common/ru.ts common.word.connect; screens/raise/ru.ts raise.steps.connect |
| §7.2 | One confirmation makes this hand's link from your account, so there is no key for you to keep. Confirm it only here: a site that gets the same confirmation could rebuild your links and read replies to you. It could not take the reward. | screens/raise/en.ts raise.keys.body | screens/raise/ru.ts raise.keys.body |
| §7.2 | Checking that your account answers the same way twice. | screens/raise/en.ts raise.keys.twice | (no RU in spec) |
| §7.2 | 1 of 2: allow | screens/raise/en.ts raise.steps.allow | (no RU in spec) |
| §7.2 | 2 of 2: raise | screens/raise/en.ts raise.steps.raise2 | (no RU in spec) |
| §7.2 | Your hand is up. | screens/raise/en.ts raise.up | screens/raise/ru.ts raise.up |
| §7.2 | Share | ui/words.ts copy.share | (no RU in spec) |
| §7.2 | Show QR | i18n/common/en.ts common.word.showQr; screens/raise/en.ts raise.share.qr | (no RU in spec) |
| §7.2 | Print a card | screens/raise/en.ts raise.share.print | (no RU in spec) |
| §7.2 | Add a reminder | screens/raise/en.ts raise.share.reminder | (no RU in spec) |
| §7.2 | Send it to people who might know someone. Passing it on is free for them. | screens/pass/en.ts pass.sendIt; screens/raise/en.ts raise.share.line | screens/pass/ru.ts pass.sendIt; screens/raise/ru.ts raise.share.line |
| §7.2 | You need {amount} and a little ETH for the cost. Nothing was sent. | screens/raise/en.ts raise.error.short | (no RU in spec) |
| §7.2 | You said no. Nothing was sent. | i18n/common/en.ts common.error.refused; screens/give/en.ts give.error.refused | i18n/common/ru.ts common.error.refused; screens/give/ru.ts give.error.refused |
| §7.2 | Your last raise is still on its way | screens/raise/en.ts raise.pending | (no RU in spec) |
| §7.2 | At most 180 days from now. | i18n/common/en.ts core.ExpiryTooLate | (no RU in spec) |
| §7.2 | That date has already passed on the network's clock. Nothing was sent. | i18n/common/en.ts core.ExpiryTooEarly | i18n/common/ru.ts core.ExpiryTooEarly |
| §7.2 | Your account can't rebuild this link later. Save it now. Until you do, this device keeps a locked copy. | screens/raise/en.ts raise.locked.band | screens/raise/ru.ts raise.locked.band |
| §7.2 | I saved the link | screens/raise/en.ts raise.locked.tick | (no RU in spec) |
| §7.2 | The copy on this device is gone. The link you saved is the only one. | screens/raise/en.ts raise.locked.gone | screens/raise/ru.ts raise.locked.gone |
| §7.3 | Hands raised on this device. | screens/my/en.ts my.title | screens/my/ru.ts my.title |
| §7.3 | Unlock links and replies | screens/my/en.ts my.unlock | (no RU in spec) |
| §7.3 | Keep it open longer? | screens/my/en.ts my.careBand | (no RU in spec) |
| §7.3 | Show the link again | screens/my/en.ts my.link.show | (no RU in spec) |
| §7.3 | Answers | screens/my/en.ts my.answers.title | (no RU in spec) |
| §7.3 | They see it in their tab. | screens/my/en.ts my.reply.hint | (no RU in spec) |
| §7.3 | Paste an answer | screens/my/en.ts my.paste | (no RU in spec) |
| §7.3 | Add to the reward | screens/care/en.ts care.fund.title; screens/care/en.ts care.fund.swipeEmpty | (no RU in spec) |
| §7.3 | Keep it open longer | screens/care/en.ts care.extend.title; screens/care/en.ts care.extend.swipeEmpty | (no RU in spec) |
| §7.3 | Print | i18n/common/en.ts common.word.print; screens/my/en.ts my.print | (no RU in spec) |
| §7.3 | Add a hand by its number | screens/my/en.ts my.add.title | (no RU in spec) |
| §7.3 | This device's code | screens/my/en.ts my.lens.code | (no RU in spec) |
| §7.3 | Rebuild a link from another device's code | screens/my/en.ts my.lens.rebuild | (no RU in spec) |
| §7.3 | No hands on this device yet. | screens/my/en.ts my.empty | (no RU in spec) |
| §7.3 | This list lives on this device only. Your own link still opens your hand. | screens/my/en.ts my.deviceOnly | (no RU in spec) |
| §7.4 | Every link already out there stays good. | screens/care/en.ts care.fund.stays | screens/care/ru.ts care.fund.stays |
| §7.4 | up to {n} days from today | screens/care/en.ts care.extend.max | (no RU in spec) |
| §7.4 | It can be moved later only, and only while it is open. | screens/care/en.ts care.extend.later | (no RU in spec) |
| §7.4 | This may not make it in time. At the last second neither more time nor thanks can pass. | screens/care/en.ts care.extend.lastMinutes | (no RU in spec) |
| §7.4 | Time's up. This hand can only be sent back now. | i18n/common/en.ts core.Expired | i18n/common/ru.ts core.Expired |
| §7.4 | Only the account that raised this hand can do that. | i18n/common/en.ts core.NotRaiser | (no RU in spec) |
| §7.5 | Checking this answer with the contract… | screens/my/en.ts my.answers.checking; screens/thank/en.ts thank.checking | (no RU in spec) |
| §7.5 | This answer came by a shorter route than one you already saw. It drops: {holders}. Thanking it pays them nothing. | screens/thank/en.ts thank.resigned | screens/thank/ru.ts thank.resigned |
| §7.5 | Thank this route anyway | screens/thank/en.ts thank.resigned.anyway | (no RU in spec) |
| §7.5 | First seen on this device | i18n/common/en.ts common.lens.deviceTime; screens/my/en.ts my.lens.firstSeen | (no RU in spec) |
| §7.5 | That address is the contract itself; money sent there waits forever. | screens/thank/en.ts thank.payee.core | (no RU in spec) |
| §7.5 | One share on this route lands at your own address. | screens/thank/en.ts thank.payee.raiser | (no RU in spec) |
| §7.5 | This route is too long to thank in one go. | screens/thank/en.ts thank.tooLong | (no RU in spec) |
| §7.5 | The helper's account isn't set up on this network yet. Saying thanks sets it up first. | screens/my/en.ts my.answer.setup; screens/thank/en.ts thank.setup | screens/my/ru.ts my.answer.setup; screens/thank/ru.ts thank.setup |
| §7.5 | Two steps: the first sets up the helper's account, the second says thanks. If you stop after the first, only its cost is spent. | screens/thank/en.ts thank.twoSteps | screens/thank/ru.ts thank.twoSteps |
| §7.5 | Setup runs through {forwarder} · not in your name | screens/thank/en.ts thank.lens.setupRuns | (no RU in spec) |
| §7.5 | Who gets what | screens/thank/en.ts thank.predicted.title | (no RU in spec) |
| §7.5 | Say thanks | i18n/common/en.ts common.word.sayThanks; screens/thank/en.ts thank.swipe | i18n/common/ru.ts common.word.sayThanks; screens/thank/ru.ts thank.swipe |
| §7.5 | Saying thanks pays everyone on this route. It can't be undone. | screens/thank/en.ts thank.warning | screens/thank/ru.ts thank.warning |
| §7.5 | Thanked. Here's who got what — straight from the chain. | screens/thank/en.ts thank.done | screens/thank/ru.ts thank.done |
| §7.5 | left the contract for {payee} | screens/proof/en.ts proof.payout.paid; screens/thank/en.ts thank.left | (no RU in spec) |
| §7.5 | waiting for {payee} | screens/thank/en.ts thank.waiting | (no RU in spec) |
| §7.5 | See the proof | screens/thank/en.ts thank.proof | (no RU in spec) |
| §7.5 | Nothing left your account. | i18n/common/en.ts common.error.nothingLeft | (no RU in spec) |
| §8.1 | This link lives in this tab only. Reloading forgets it — keep the message it came in. | i18n/common/en.ts common.tabOnly | i18n/common/ru.ts common.tabOnly |
| §8.1 | Checking the link… | i18n/common/en.ts common.state.checking; screens/give/en.ts give.opening | (no RU in spec) |
| §8.2 | Pass it on | i18n/common/en.ts common.word.passOn | i18n/common/ru.ts common.word.passOn |
| §8.2 | I can help | i18n/common/en.ts common.word.canHelp | i18n/common/ru.ts common.word.canHelp |
| §8.2 | The asker decides whether to thank. If they don't by {date}, the reward goes back to them. | screens/hand/en.ts hand.helpNote | screens/hand/ru.ts hand.helpNote |
| §8.2 | This route can't go further. You can still help. | screens/hand/en.ts hand.passesNone; screens/pass/en.ts pass.cannot | (no RU in spec) |
| §8.2 | The description didn't arrive with this link. Ask whoever sent it. | i18n/common/en.ts common.state.lost; ui/words.ts deal.lost | i18n/common/ru.ts common.state.lost; ui/words.ts deal.lost |
| §8.2 | To pass it on or help, open the link you were sent. | screens/hand/en.ts hand.noLink | (no RU in spec) |
| §8.2 | This hand is closed. | i18n/common/en.ts common.state.closed; screens/hand/en.ts hand.closed | (no RU in spec) |
| §8.2 | The reward went back. | i18n/common/en.ts common.state.wentBack; screens/hand/en.ts hand.sendBack.done | (no RU in spec) |
| §8.2 | Look for a newer hand by this asker | screens/hand/en.ts hand.newer.look | screens/hand/ru.ts hand.newer.look |
| §8.2 | The same address raised hand {number} later. | screens/hand/en.ts hand.newer.found | screens/hand/ru.ts hand.newer.found |
| §8.2 | It has its own link. Ask whoever sent you this one. | screens/hand/en.ts hand.newer.ownLink | screens/hand/ru.ts hand.newer.ownLink |
| §8.2 | Nothing newer in that stretch. | screens/hand/en.ts hand.newer.none | screens/hand/ru.ts hand.newer.none |
| §8.2 | Ask whoever sent you the link whether there is a newer one. | screens/hand/en.ts hand.askSender | screens/hand/ru.ts hand.askSender |
| §8.2 | Someone answered this hand. Pass it back to whoever sent you the link. | screens/hand/en.ts hand.give.holder | screens/hand/ru.ts hand.give.holder |
| §8.2 | This is an answer to your hand. | screens/hand/en.ts hand.give.raiser | (no RU in spec) |
| §8.3 | Time's up. Anyone can send the reward back to the asker now. | ui/words.ts deal.timeUp + deal.sendBack | ui/words.ts deal.timeUp + deal.sendBack |
| §8.3 | Send it back | i18n/common/en.ts common.word.sendBack | i18n/common/ru.ts common.word.sendBack |
| §8.4 | Keep a little for yourself, or pass it all on. | screens/pass/en.ts pass.lead | screens/pass/ru.ts pass.lead |
| §8.4 | {pct} — about {amount} if this route is thanked | screens/pass/en.ts pass.share | (no RU in spec) |
| §8.4 | This hand carries no reward, so there is no share to keep. | screens/pass/en.ts pass.noReward | screens/pass/ru.ts pass.noReward |
| §8.4 | Where should your share land? | ui/words.ts land.askShare | ui/words.ts land.askShare |
| §8.4 | Make the address show less | screens/pass/en.ts pass.darker | (no RU in spec) |
| §8.4 | Make my link | screens/pass/en.ts pass.make | (no RU in spec) |
| §8.4 | This link pays {payee} {pct} if its route is thanked. | screens/pass/en.ts pass.readBack.share | (no RU in spec) |
| §8.4 | Whoever had the old link can still pass it another way. | screens/pass/en.ts pass.oldLink | (no RU in spec) |
| §8.4 | Too long for a code. Send it as text. | ui/words.ts qr.tooDense | (no RU in spec) |
| §8.5 | Say what you can do. If they thank you, you get at least {amount}. | screens/give/en.ts give.words.ask | screens/give/ru.ts give.words.ask |
| §8.5 | Your words go to the asker by message, not onto the chain. | screens/give/en.ts give.words.meta | (no RU in spec) |
| §8.5 | Say what you can do. This hand carries no reward: a thank-you only. | screens/give/en.ts give.words.askNoReward | screens/give/ru.ts give.words.askNoReward |
| §8.5 | There is no reward now. If the asker adds one before thanking, it lands here. | screens/give/en.ts give.land.noReward | screens/give/ru.ts give.land.noReward |
| §8.5 | Where should the money land? | ui/words.ts land.askGive | ui/words.ts land.askGive |
| §8.5 | Before you agree | screens/give/en.ts give.step.agree | screens/give/ru.ts give.step.agree |
| §8.5 | Send my help | screens/give/en.ts give.swipe | screens/give/ru.ts give.swipe |
| §8.5 | Your account isn't set up on this network yet. That's fine: it gets set up when the asker thanks you. | screens/give/en.ts give.setup | screens/give/ru.ts give.setup |
| §8.5 | Your account isn't set up on this network yet, and this site can't set it up for you. Choose 'An address I have' and paste your account's address: the money lands there all the same. | screens/give/en.ts give.noForwarder | screens/give/ru.ts give.noForwarder |
| §8.5 | Delivered to {n} of 1 relay. | screens/give/en.ts give.delivered.one | screens/give/ru.ts give.delivered.one |
| §8.5 | We couldn't reach them directly. Send this back to whoever sent you the link — each person knows the one before. | screens/give/en.ts give.fallback | screens/give/ru.ts give.fallback |
| §8.5 | If they thank you, the money lands at {payee}. | screens/give/en.ts give.waiting | (no RU in spec) |
| §8.6 | An address I have | ui/words.ts land.address | ui/words.ts land.address |
| §8.6 | I have none — make one | ui/words.ts land.fresh | (no RU in spec) |
| §8.6 | We can't check who owns an address. Read it twice. | ui/words.ts address.ok | ui/words.ts address.ok |
| §8.6 | Keep this answer's key | ui/words.ts land.keepKey | (no RU in spec) |
| §8.6 | These 12 words are the only key to this address. Write them down before you go on; we don't keep them. They open it in any crypto app. Moving money out of it later costs a little ETH. | ui/words.ts land.freshWarn | ui/words.ts land.freshWarn |
| §8.6 | I wrote them down | ui/words.ts land.wrote | (no RU in spec) |
| §9 | Waiting for you | i18n/common/en.ts common.word.waitingForYou; screens/waiting/en.ts waiting.heading | i18n/common/ru.ts common.word.waitingForYou; screens/waiting/ru.ts waiting.heading |
| §9 | Take it out | i18n/common/en.ts common.word.takeOut; screens/waiting/en.ts waiting.takeOut | i18n/common/ru.ts common.word.takeOut; screens/waiting/ru.ts waiting.takeOut |
| §9 | Deliver | i18n/common/en.ts common.word.deliver; screens/waiting/en.ts waiting.deliver | i18n/common/ru.ts common.word.deliver; screens/waiting/ru.ts waiting.deliver |
| §9 | Your money is safe where it is. Anyone can press Deliver for you; it always lands at your address. | screens/waiting/en.ts waiting.safe | screens/waiting/ru.ts waiting.safe |
| §9 | Nothing is waiting for this address. | i18n/common/en.ts core.NothingPending; screens/waiting/en.ts waiting.nothing | i18n/common/ru.ts core.NothingPending; screens/waiting/ru.ts waiting.nothing |
| §10.1 | Paid means it left the contract; a token that takes its own cut may deliver less. | screens/proof/en.ts proof.payouts | (no RU in spec) |
| §10.1 | The reward went back | screens/proof/en.ts proof.section.back | (no RU in spec) |
| §10.1 | giveHash matches Core | screens/proof/en.ts proof.giveHashMatches | (no RU in spec) |
| §10.1 | Check it all again | screens/proof/en.ts proof.again | (no RU in spec) |
| §10.1 | Download the proof | screens/proof/en.ts proof.download | (no RU in spec) |
| §10.1 | Check it without this site | screens/proof/en.ts proof.withoutSite | (no RU in spec) |
| §10.1 | Print the receipt | screens/proof/en.ts proof.print | (no RU in spec) |
| §10.2 | Nothing you paste here is sent anywhere except the call to the contract. | screens/check/en.ts check.privacy | (no RU in spec) |
| §10.3 | Unaudited: seven AI reviews and one AI scan found no defect; no professional audit has been done. | screens/core/en.ts core.unaudited; screens/limits/en.ts limits.unaudited.say | (no RU in spec) |
| §10.3 | These numbers come with this site. The command above checks them without it. | screens/core/en.ts core.comesWith | (no RU in spec) |
| §10.3 | served by this site | screens/core/en.ts core.build.served | (no RU in spec) |
| §11 | Thanking is voluntary. The asker can get help and let the hand run out; the reward then goes back to them. | screens/limits/en.ts limits.voluntary.say | (no RU in spec) |
| §11 | If a token stops moving or changes its rules after a reward is locked, everything held in that token is stuck in the contract: rewards, waiting money and the way back to the asker. Nobody can rescue it. | screens/limits/en.ts limits.token.say | screens/limits/ru.ts limits.token.say |
| §11 | USDC has an issuer. It can freeze any address, the contract's own included, or the whole token. A frozen payee's money waits. If the contract itself is frozen, every hand in USDC is stuck, the way back included. | screens/limits/en.ts limits.usdc.say | screens/limits/ru.ts limits.usdc.say |
| §11 | chosen for this experiment, not by the project's owner | screens/defaults/en.ts defaults.chosen | (no RU in spec) |
| §11 | Scan to see how you can help. Passing it on is free. | screens/print/en.ts print.card.scan | (no RU in spec) |
| §11 | Found this? Scan it. | screens/print/en.ts print.tag.found | (no RU in spec) |
| §11 | Too dense to print small. Show it on a screen. | screens/print/en.ts print.tooDense | (no RU in spec) |
| §11 | Someone raised a hand. Open to see. | screens/raise/en.ts raise.who.generic | screens/raise/ru.ts raise.who.generic |
| §12 | This link is damaged. Ask for it again. | i18n/common/en.ts link.malformed | i18n/common/ru.ts link.malformed |
| §12 | This link was made by a newer app. | i18n/common/en.ts link.unsupported | i18n/common/ru.ts link.unsupported |
| §12 | This link names a contract this site doesn't read. Nothing was opened. | i18n/common/en.ts link.untrusted | i18n/common/ru.ts link.untrusted |
| §12 | This link names the main contract, and this site doesn't know one. Nothing was opened. | i18n/common/en.ts link.no-canonical | i18n/common/ru.ts link.no-canonical |
| §12 | The address shows one hand and the link is for another. | i18n/common/en.ts link.another-hand | i18n/common/ru.ts link.another-hand |
| §12 | This route doesn't add up: a share grows along the way. | i18n/common/en.ts link.invalid; i18n/common/en.ts core.InvalidClaim | i18n/common/ru.ts link.invalid; i18n/common/ru.ts core.InvalidClaim |
| §12 | This route leaves the helper less than the asker promised. It can't go further. | i18n/common/en.ts core.BelowMinClaim | i18n/common/ru.ts core.BelowMinClaim |
| §12 | This route is too long to ever be thanked. | i18n/common/en.ts link.too-long | i18n/common/ru.ts link.too-long |
| §12 | This answer was made for a different route. | i18n/common/en.ts core.InvalidRouteHash | i18n/common/ru.ts core.InvalidRouteHash |
| §12 | The helper's confirmation doesn't check out. | i18n/common/en.ts core.InvalidGiverSig | i18n/common/ru.ts core.InvalidGiverSig |
| §12 | You can't thank yourself. | i18n/common/en.ts core.GiverIsRaiser | i18n/common/ru.ts core.GiverIsRaiser |
| §12 | This hand is already closed. | i18n/common/en.ts core.NotOpen; screens/thank/en.ts thank.error.closed | i18n/common/ru.ts core.NotOpen; screens/thank/ru.ts thank.error.closed |
| §12 | Time's up. This hand can only be sent back now. | i18n/common/en.ts core.Expired | i18n/common/ru.ts core.Expired |
| §12 | Too early to send it back. The hand is still open. | i18n/common/en.ts core.NotExpired | i18n/common/ru.ts core.NotExpired |
| §12 | That date has already passed on the network's clock. Nothing was sent. | i18n/common/en.ts core.ExpiryTooEarly | i18n/common/ru.ts core.ExpiryTooEarly |
| §12 | At most 180 days from now. Nothing was sent. | i18n/common/en.ts core.ExpiryTooLate | i18n/common/ru.ts core.ExpiryTooLate |
| §12 | Nothing is waiting for this address. | i18n/common/en.ts core.NothingPending; screens/waiting/en.ts waiting.nothing | i18n/common/ru.ts core.NothingPending; screens/waiting/ru.ts waiting.nothing |
| §12 | You said no. Nothing was sent. | i18n/common/en.ts common.error.refused; screens/give/en.ts give.error.refused | i18n/common/ru.ts common.error.refused; screens/give/ru.ts give.error.refused |
| §15 | Can't reach the network right now. | i18n/common/en.ts common.time.offline; screens/core/en.ts core.offline | i18n/common/ru.ts common.time.offline; screens/core/ru.ts core.offline |
| §15 | Network time · Block {block} · {time} | i18n/common/en.ts common.lens.networkTime | (no RU in spec) |
| §15 | Cap 180 d · less 10 min, so it can't arrive too late | i18n/common/en.ts common.lens.cap | (no RU in spec) |

186 quotes, 103 with Russian; missing: 0

### The script

Run with `bun spec-quotes.ts <worktree>/apps/hand/src`. It exits with 1 if any quote is missing.

```ts
// Finds every sentence UX-SPEC quotes (§4, §6–§12, §15) in the app's catalogues, word for word.
// Placeholders are compared as one token: "{date}" in the spec matches any "{…}" in a catalogue.
// Mono lines are compared without case (the spec writes them in capitals; the catalogues in
// sentence case and the mono style sets them in capitals).
// Run: bun spec-quotes.ts <apps/hand/src>
import { readdirSync } from "node:fs";

const SRC = process.argv[2]!;
type Entry = { where: string; key: string; text: string };
const entries: Record<"en" | "ru", Entry[]> = { en: [], ru: [] };
for (const lang of ["en", "ru"] as const) {
  const common = (await import(`${SRC}/i18n/common/${lang}.ts`)).default as Record<string, string>;
  for (const [key, text] of Object.entries(common)) entries[lang].push({ where: `i18n/common/${lang}.ts`, key, text });
  for (const screen of readdirSync(`${SRC}/screens`).sort()) {
    const cat = (await import(`${SRC}/screens/${screen}/${lang}.ts`)).default as Record<string, string>;
    for (const [key, text] of Object.entries(cat)) entries[lang].push({ where: `screens/${screen}/${lang}.ts`, key, text });
  }
  // The kit's own sentences (ui/words.ts: the Deal card, the land sheet, the QR), with functions
  // called on placeholders.
  const { WORDS } = await import(`${SRC}/ui/words.ts`);
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") entries[lang].push({ where: "ui/words.ts", key: path, text: node });
    else if (typeof node === "function") entries[lang].push({ where: "ui/words.ts", key: path, text: String((node as (...a: string[]) => string)("{a}", "{b}")) });
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(WORDS[lang], "");
}

const norm = (s: string) => s.replace(/\{[^{}]*\}/g, "§").replace(/\s+/g, " ").toLowerCase().trim();

// [section, EN, RU or ""]
const QUOTES: [string, string, string][] = [
  ["§4", "Someone raised a hand:", "Кто-то поднял руку:"], // §4's "Someone is looking for", changed in review round 1 (app-design.md)
  ["§4", "If you help and they thank you", "Поможешь, и тебя поблагодарят"],
  ["§4", "If you pass it on", "Передашь дальше"],
  ["§4", "keep a share you choose", "оставь себе долю, сколько решишь"],
  ["§4", "If nobody is thanked by {date}", "Никого не поблагодарят до {date}"],
  ["§4", "the whole reward goes back", "вся награда вернётся автору"],
  ["§4", "{reward} reward · open until {date}", "Награда {reward} · открыта до {date}"],
  ["§4", "Time's up", ""],
  ["§4", "Thanked on {date}", ""],
  ["§4", "The reward went back on {date}", ""],
  ["§4", "No reward: a thank-you only · open until {date}", "Без награды: только спасибо · открыта до {date}"],
  ["§4", "it's free; there is no share to keep", "бесплатно; доли здесь нет"],
  ["§4", "the hand closes", "рука закроется"],
  ["§6", "Unaudited · Core {core} · No owner · No fee", "Без аудита · Core {core} · Без владельца · Без комиссии"],
  ["§6", "What it can't promise", "Чего она не обещает"],
  ["§6", "Do it without us", "Сделать без нас"],
  ["§6", "About these defaults", "Об этих настройках"],
  ["§6", "Local test network · Test dollars", "Локальная тестовая сеть · Тестовые доллары"],
  ["§6", "Can't reach the network right now. Nothing was sent.", "Сеть сейчас недоступна. Ничего не отправлено."],
  ["§7.1", "Raise a hand. Your people take it from there.", "Подними руку. Дальше — твои люди."],
  ["§7.1", "Ask, and lock a reward.", "Попроси и положи награду."],
  ["§7.1", "People pass it on; each may keep a share.", "Люди передают дальше; каждый может оставить себе долю."],
  ["§7.1", "Thank the one who helped — everyone on the way is paid. If nobody is thanked, the whole reward goes back.", "Скажи спасибо тому, кто помог, — и получат все на пути. Никого не поблагодарили — вся награда вернётся."],
  ["§7.1", "This address was made for {host}. The link opens anywhere; make sure you trust the site you're on.", "Этот адрес сделан для {host}. Ссылка открывается где угодно; убедись, что доверяешь сайту, на котором находишься."],
  ["§7.1", "Raise a hand", "Поднять руку"],
  ["§7.1", "My hands", "Мои руки"],
  ["§7.2", "What are you looking for?", "Кого или что ищешь?"],
  ["§7.2", "Add details", ""],
  ["§7.2", "No reward: a thank-you only.", "Без награды: только спасибо."],
  ["§7.2", "Locked until you thank someone — or all of it back to you after {date}.", "Лежит под замком, пока не скажешь спасибо. Не скажешь — после {date} всё вернётся тебе."],
  ["§7.2", "Held in USDC. Its issuer can freeze addresses; then that money waits.", "Хранится в USDC. Его эмитент может заморозить адрес — тогда эти деньги ждут."],
  ["§7.2", "test dollars, standing in for USDC", ""],
  ["§7.2", "Long hands need a nudge. You'll get a calendar reminder.", "Долгим рукам нужно напоминание. Добавим в календарь."],
  ["§7.2", "The reward, the dates and your address are public in every mode. Dark is not secret writing.", "Награда, сроки и твой адрес видны всем в любом режиме. Тёмная — не шифрование."],
  ["§7.2", "The helper gets at least {pct}", ""],
  ["§7.2", "Room for each payout: {k}", ""],
  ["§7.2", "Raise your hand", "Поднять руку"],
  ["§7.2", "Connect a wallet", "Подключить кошелёк"],
  ["§7.2", "One confirmation makes this hand's link from your account, so there is no key for you to keep. Confirm it only here: a site that gets the same confirmation could rebuild your links and read replies to you. It could not take the reward.", "Одно подтверждение — и ссылка этой руки собирается из твоего аккаунта: хранить ключ не нужно. Подтверждай только здесь: сайт, получивший такое же подтверждение, сможет собрать твои ссылки и читать ответы тебе. Забрать награду он не сможет."],
  ["§7.2", "Checking that your account answers the same way twice.", ""],
  ["§7.2", "1 of 2: allow", ""],
  ["§7.2", "2 of 2: raise", ""],
  ["§7.2", "Your hand is up.", "Рука поднята."],
  ["§7.2", "Share", ""],
  ["§7.2", "Show QR", ""],
  ["§7.2", "Print a card", ""],
  ["§7.2", "Add a reminder", ""],
  ["§7.2", "Send it to people who might know someone. Passing it on is free for them.", "Отправь тем, кто может знать нужного человека. Передать дальше — бесплатно."],
  ["§7.2", "You need {amount} and a little ETH for the cost. Nothing was sent.", ""],
  ["§7.2", "You said no. Nothing was sent.", "Ты отказался. Ничего не отправлено."],
  ["§7.2", "Your last raise is still on its way", ""],
  ["§7.2", "At most 180 days from now.", ""],
  ["§7.2", "That date has already passed on the network's clock. Nothing was sent.", "По часам сети эта дата уже прошла. Ничего не отправлено."],
  ["§7.2", "Your account can't rebuild this link later. Save it now. Until you do, this device keeps a locked copy.", "Твой аккаунт не сможет собрать эту ссылку заново. Сохрани её сейчас. Пока не сохранишь, на этом устройстве лежит запертая копия."],
  ["§7.2", "I saved the link", ""],
  ["§7.2", "The copy on this device is gone. The link you saved is the only one.", "Копия с устройства удалена. Сохранённая ссылка — единственная."],
  ["§7.3", "Hands raised on this device.", "Руки, поднятые на этом устройстве."],
  ["§7.3", "Unlock links and replies", ""],
  ["§7.3", "Keep it open longer?", ""],
  ["§7.3", "Show the link again", ""],
  ["§7.3", "Answers", ""],
  ["§7.3", "They see it in their tab.", ""],
  ["§7.3", "Paste an answer", ""],
  ["§7.3", "Add to the reward", ""],
  ["§7.3", "Keep it open longer", ""],
  ["§7.3", "Print", ""],
  ["§7.3", "Add a hand by its number", ""],
  ["§7.3", "This device's code", ""],
  ["§7.3", "Rebuild a link from another device's code", ""],
  ["§7.3", "No hands on this device yet.", ""],
  ["§7.3", "This list lives on this device only. Your own link still opens your hand.", ""],
  ["§7.4", "Every link already out there stays good.", "Все уже разосланные ссылки остаются в силе."],
  ["§7.4", "up to {n} days from today", ""],
  ["§7.4", "It can be moved later only, and only while it is open.", ""],
  ["§7.4", "This may not make it in time. At the last second neither more time nor thanks can pass.", ""],
  ["§7.4", "Time's up. This hand can only be sent back now.", "Срок вышел. Эту руку теперь можно только вернуть."],
  ["§7.4", "Only the account that raised this hand can do that.", ""],
  ["§7.5", "Checking this answer with the contract…", ""],
  ["§7.5", "This answer came by a shorter route than one you already saw. It drops: {holders}. Thanking it pays them nothing.", "Этот ответ пришёл более коротким путём, чем тот, что ты уже видел. Из него выпали: {holders}. Поблагодаришь — они ничего не получат."],
  ["§7.5", "Thank this route anyway", ""],
  ["§7.5", "First seen on this device", ""],
  ["§7.5", "That address is the contract itself; money sent there waits forever.", ""],
  ["§7.5", "One share on this route lands at your own address.", ""],
  ["§7.5", "This route is too long to thank in one go.", ""],
  ["§7.5", "The helper's account isn't set up on this network yet. Saying thanks sets it up first.", "Аккаунт помощника в этой сети ещё не настроен. Твоё спасибо сначала настроит его."],
  ["§7.5", "Two steps: the first sets up the helper's account, the second says thanks. If you stop after the first, only its cost is spent.", "Два шага: первый настраивает аккаунт помощника, второй говорит спасибо. Остановишься после первого — потратишь только его стоимость."],
  ["§7.5", "Setup runs through {forwarder} · not in your name", ""],
  ["§7.5", "Who gets what", ""],
  ["§7.5", "Say thanks", "Сказать спасибо"],
  ["§7.5", "Saying thanks pays everyone on this route. It can't be undone.", "Спасибо заплатит всем на этом пути. Отменить нельзя."],
  ["§7.5", "Thanked. Here's who got what — straight from the chain.", "Спасибо сказано. Кто сколько получил — прямо из сети."],
  ["§7.5", "left the contract for {payee}", ""],
  ["§7.5", "waiting for {payee}", ""],
  ["§7.5", "See the proof", ""],
  ["§7.5", "Nothing left your account.", ""],
  ["§8.1", "This link lives in this tab only. Reloading forgets it — keep the message it came in.", "Ссылка живёт только в этой вкладке. Обновишь страницу — она забудется; сохрани сообщение, в котором она пришла."],
  ["§8.1", "Checking the link…", ""],
  ["§8.2", "Pass it on", "Передать дальше"],
  ["§8.2", "I can help", "Могу помочь"],
  ["§8.2", "The asker decides whether to thank. If they don't by {date}, the reward goes back to them.", "Благодарить или нет — решает автор. Не поблагодарит до {date} — награда вернётся ему."],
  ["§8.2", "This route can't go further. You can still help.", ""],
  ["§8.2", "The description didn't arrive with this link. Ask whoever sent it.", "Описание не дошло вместе со ссылкой. Спроси у того, кто её прислал."],
  ["§8.2", "To pass it on or help, open the link you were sent.", ""],
  ["§8.2", "This hand is closed.", ""],
  ["§8.2", "The reward went back.", ""],
  ["§8.2", "Look for a newer hand by this asker", "Поискать новую руку этого автора"],
  ["§8.2", "The same address raised hand {number} later.", "С этого же адреса позже поднята рука {number}."],
  ["§8.2", "It has its own link. Ask whoever sent you this one.", "У неё своя ссылка. Спроси у того, кто прислал эту."],
  ["§8.2", "Nothing newer in that stretch.", "За это время новой нет."],
  ["§8.2", "Ask whoever sent you the link whether there is a newer one.", "Спроси у того, кто прислал ссылку, нет ли новой."],
  ["§8.2", "Someone answered this hand. Pass it back to whoever sent you the link.", "На эту руку ответили. Передай это тому, кто прислал тебе ссылку."],
  ["§8.2", "This is an answer to your hand.", ""],
  ["§8.3", "Time's up. Anyone can send the reward back to the asker now.", "Срок вышел. Теперь кто угодно может вернуть награду автору."],
  ["§8.3", "Send it back", "Вернуть"],
  ["§8.4", "Keep a little for yourself, or pass it all on.", "Оставь себе чуть-чуть — или передай всё дальше."],
  ["§8.4", "{pct} — about {amount} if this route is thanked", ""],
  ["§8.4", "This hand carries no reward, so there is no share to keep.", "У этой руки нет награды, так что и доли нет."],
  ["§8.4", "Where should your share land?", "Куда придёт твоя доля?"],
  ["§8.4", "Make the address show less", ""],
  ["§8.4", "Make my link", ""],
  ["§8.4", "This link pays {payee} {pct} if its route is thanked.", ""],
  ["§8.4", "Whoever had the old link can still pass it another way.", ""],
  ["§8.4", "Too long for a code. Send it as text.", ""],
  ["§8.5", "Say what you can do. If they thank you, you get at least {amount}.", "Напиши, чем поможешь. Если поблагодарят — тебе минимум {amount}."],
  ["§8.5", "Your words go to the asker by message, not onto the chain.", ""],
  ["§8.5", "Say what you can do. This hand carries no reward: a thank-you only.", "Напиши, чем поможешь. У этой руки нет награды: только спасибо."],
  ["§8.5", "There is no reward now. If the asker adds one before thanking, it lands here.", "Сейчас награды нет. Если автор добавит её до спасибо, она придёт сюда."],
  ["§8.5", "Where should the money land?", "Куда придут деньги?"],
  ["§8.5", "Before you agree", "Прежде чем согласиться"],
  ["§8.5", "Send my help", "Отправить помощь"],
  ["§8.5", "Your account isn't set up on this network yet. That's fine: it gets set up when the asker thanks you.", "Твой аккаунт в этой сети ещё не настроен. Это не страшно: его настроит спасибо автора."],
  ["§8.5", "Your account isn't set up on this network yet, and this site can't set it up for you. Choose 'An address I have' and paste your account's address: the money lands there all the same.", "Твой аккаунт в этой сети ещё не настроен, и этот сайт не умеет настроить его за тебя. Выбери «Адрес у меня есть» и вставь адрес аккаунта: деньги придут туда же."],
  ["§8.5", "Delivered to {n} of 1 relay.", "Доставлено на {n} из 1 реле."],
  ["§8.5", "We couldn't reach them directly. Send this back to whoever sent you the link — each person knows the one before.", "Напрямую достучаться не вышло. Отправь это тому, кто прислал тебе ссылку: каждый знает предыдущего."],
  ["§8.5", "If they thank you, the money lands at {payee}.", ""],
  ["§8.6", "An address I have", "Адрес у меня есть"],
  ["§8.6", "I have none — make one", ""],
  ["§8.6", "We can't check who owns an address. Read it twice.", "Мы не можем проверить, чей это адрес. Перечитай дважды."],
  ["§8.6", "Keep this answer's key", ""],
  ["§8.6", "These 12 words are the only key to this address. Write them down before you go on; we don't keep them. They open it in any crypto app. Moving money out of it later costs a little ETH.", "Эти 12 слов — единственный ключ к адресу. Запиши их, прежде чем идти дальше: мы их не храним. По ним адрес откроется в любом криптоприложении. Чтобы потом перевести деньги дальше, понадобится немного ETH."],
  ["§8.6", "I wrote them down", ""],
  ["§9", "Waiting for you", "Ждёт тебя"],
  ["§9", "Take it out", "Забрать"],
  ["§9", "Deliver", "Доставить"],
  ["§9", "Your money is safe where it is. Anyone can press Deliver for you; it always lands at your address.", "Твои деньги в безопасности там, где лежат. Нажать „Доставить“ за тебя может кто угодно — они придут только на твой адрес."],
  ["§9", "Nothing is waiting for this address.", "Для этого адреса ничего не ждёт."],
  ["§10.1", "Paid means it left the contract; a token that takes its own cut may deliver less.", ""],
  ["§10.1", "The reward went back", ""],
  ["§10.1", "giveHash matches Core", ""],
  ["§10.1", "Check it all again", ""],
  ["§10.1", "Download the proof", ""],
  ["§10.1", "Check it without this site", ""],
  ["§10.1", "Print the receipt", ""],
  ["§10.2", "Nothing you paste here is sent anywhere except the call to the contract.", ""],
  ["§10.3", "Unaudited: seven AI reviews and one AI scan found no defect; no professional audit has been done.", ""],
  ["§10.3", "These numbers come with this site. The command above checks them without it.", ""],
  ["§10.3", "served by this site", ""],
  ["§11", "Thanking is voluntary. The asker can get help and let the hand run out; the reward then goes back to them.", ""],
  ["§11", "If a token stops moving or changes its rules after a reward is locked, everything held in that token is stuck in the contract: rewards, waiting money and the way back to the asker. Nobody can rescue it.", "Если токен перестанет переводиться или сменит правила после того, как награда положена, в контракте застрянет всё, что в нём лежит: награды, ждущие деньги и возврат автору. Спасти их некому."],
  ["§11", "USDC has an issuer. It can freeze any address, the contract's own included, or the whole token. A frozen payee's money waits. If the contract itself is frozen, every hand in USDC is stuck, the way back included.", "У USDC есть эмитент. Он может заморозить любой адрес, в том числе сам контракт, или весь токен. Деньги замороженного получателя ждут. Если заморожен сам контракт, застрянут все руки в USDC, включая возврат."],
  ["§11", "chosen for this experiment, not by the project's owner", ""],
  ["§11", "Scan to see how you can help. Passing it on is free.", ""],
  ["§11", "Found this? Scan it.", ""],
  ["§11", "Too dense to print small. Show it on a screen.", ""],
  ["§11", "Someone raised a hand. Open to see.", "Кто-то поднял руку. Открой и посмотри."],
  ["§12", "This link is damaged. Ask for it again.", "Ссылка повреждена. Попроси прислать её ещё раз."],
  ["§12", "This link was made by a newer app.", "Эту ссылку сделало более новое приложение."],
  ["§12", "This link names a contract this site doesn't read. Nothing was opened.", "Ссылка называет контракт, который этот сайт не читает. Ничего не открыто."],
  ["§12", "This link names the main contract, and this site doesn't know one. Nothing was opened.", "Ссылка называет основной контракт, а этот сайт его не знает. Ничего не открыто."],
  ["§12", "The address shows one hand and the link is for another.", "Адрес показывает одну руку, а ссылка — от другой."],
  ["§12", "This route doesn't add up: a share grows along the way.", "Путь не сходится: чья-то доля по дороге растёт."],
  ["§12", "This route leaves the helper less than the asker promised. It can't go further.", "На этом пути помощнику остаётся меньше, чем обещал автор. Дальше он не пойдёт."],
  ["§12", "This route is too long to ever be thanked.", "Этот путь слишком длинный: за него уже не поблагодарить."],
  ["§12", "This answer was made for a different route.", "Этот ответ был дан для другого пути."],
  ["§12", "The helper's confirmation doesn't check out.", "Подтверждение помощника не сходится."],
  ["§12", "You can't thank yourself.", "Себя поблагодарить нельзя."],
  ["§12", "This hand is already closed.", "Эта рука уже закрыта."],
  ["§12", "Time's up. This hand can only be sent back now.", "Срок вышел. Эту руку теперь можно только вернуть."],
  ["§12", "Too early to send it back. The hand is still open.", "Возвращать рано: рука ещё открыта."],
  ["§12", "That date has already passed on the network's clock. Nothing was sent.", "По часам сети эта дата уже прошла. Ничего не отправлено."],
  ["§12", "At most 180 days from now. Nothing was sent.", "Максимум 180 дней с сегодняшнего дня. Ничего не отправлено."],
  ["§12", "Nothing is waiting for this address.", "Для этого адреса ничего не ждёт."],
  ["§12", "You said no. Nothing was sent.", "Ты отказался. Ничего не отправлено."],
  ["§15", "Can't reach the network right now.", "Сеть сейчас недоступна."],
  ["§15", "Network time · Block {block} · {time}", ""],
  ["§15", "Cap 180 d · less 10 min, so it can't arrive too late", ""],
];

let missing = 0;
const find = (lang: "en" | "ru", quote: string) => {
  const q = norm(quote);
  const exact = entries[lang].filter((e) => norm(e.text) === q);
  const hits = exact.length ? exact : entries[lang].filter((e) => norm(e.text).includes(q));
  return hits.slice(0, 2).map((e) => `${e.where} ${e.key}`).join("; ");
};
console.log("| § | EN quote | found (EN) | found (RU) |\n|---|---|---|---|");
for (const [section, en, ru] of QUOTES) {
  const fe = find("en", en);
  const fr = ru ? find("ru", ru) : "(no RU in spec)";
  if (!fe || !fr) missing++;
  console.log(`| ${section} | ${en.replace(/\|/g, "\\|")} | ${fe || "**MISSING**"} | ${fr || "**MISSING**"} |`);
}
console.log(`\n${QUOTES.length} quotes, ${QUOTES.filter((q) => q[2]).length} with Russian; missing: ${missing}`);
process.exitCode = missing ? 1 : 0;
```

## Needs (files this package does not own)

1. `apps/hand/src/screens/thank/Flow.tsx`, `failureOf`, the `"reverted"` case without a refusal and the `default` case. The current `kept` is `t("common.error.nothingLeft")`, "Nothing left your account.". That is not true after an on-chain revert, because the cost was spent. Change it to `firstLanded ? t("thank.firstStepOnly") : t("thank.reverted.kept")`. The key already exists in both languages: "The reward is still in the contract; only the cost of trying was spent."
2. `apps/hand/src/ui/words.ts` (harden-app):
   - `RU.tx.steps[3]`: «Навсегда» → «Окончательно», to match `common.tx.final`.
   - `RU.receipt.keptNothing`: «ничего себе не оставили» → «не оставили себе ничего». «Ничего себе» reads as "wow".
3. `apps/hand/src/ui/Flip.tsx` holds Russian and English sentences of its own (for example «оставил», «Куда придут»). They should move into `ui/words.ts` so that one catalogue holds every kit sentence. This package did not edit them.

## Decisions

- **The give screen's voluntary line went into an existing key** (`give.agree.intro`), so no code had to change. The alternative was a new key that the screen would render. That needed harden-app to change code in the same wave.
- **Reverted sends:** a new key, plus a request for the code change, instead of rewriting "Nothing left your account.". That sentence is UX-SPEC's for refusals caught before sending, and it is true there.
- **«Нашёл? Отсканируй.» was kept** because an e2e spec asserts it. The «ты» voice in the spec already uses the generic masculine.

## Review round 1 (fix-words)

Written 2026-11-20 by an AI assistant during the overnight experiment. Six findings of review round 1, all in the catalogues. Every wording below is the assistant's; the owner has not read it. Files touched: catalogues (`en.ts`, `ru.ts`), `apps/hand/src/i18n/common/chain.ts` (new), two test files beside it (new), `docs/glossary.md`, this note.

### What changed

| Finding | Key | Before | Now (EN / RU) |
|---|---|---|---|
| 1 | `thank.done` | Thanked. Here's who got what — straight from the chain. / «Спасибо сказано. Кто сколько получил — прямо из сети.» | Thanked. Here's every payout — straight from the chain. / «Спасибо сказано. Все выплаты — прямо из сети.» |
| 1 | `thank.done.before` | …Here's who got what… / …«Кто сколько получил»… | …Here's every payout — straight from the chain. / …«Все выплаты — прямо из сети.» |
| 1 | `proof.giverAmount` | The helper got {amount}: the reward minus the shares. / «Помощник получил {amount}…» | The helper's part is {amount}: the reward minus the shares. / «Часть помощника — {amount}: награда минус доли.» |
| 1 | `print.receipt.lead` (found by the new test, not by the reviewer) | Who got what, from the network's own records. / «Кто сколько получил — по записям самой сети.» | Every payout, from the network's own records. / «Все выплаты — по записям самой сети.» |
| 2 | `common.chain.31337` (new) | — | Local test network / «Локальная тестовая сеть», read through `chainName(config.chain)` |
| 2 | `waiting.safe` (RU) | Нажать „Доставить“ за тебя… | Нажать «Доставить» за тебя… |
| 3 | `thank.lens.fit` | Worst case {gas} gas · {bytes} bytes of calldata · limit 16 777 216 gas | the same line, then: "The worst case is used only to check that this route fits one transaction; your wallet's own estimate is what is sent." / «Худший случай нужен только для проверки, что этот путь помещается в одну транзакцию; отправляется оценка твоего кошелька.» |
| 4 | `raise.expiry.nudge` | Long hands need a nudge. You'll get a calendar reminder. / «…Добавим в календарь.» | Long hands need a nudge. After you raise it, you'll get a button to add a calendar reminder. / «Долгим рукам нужно напоминание. После подъёма появится кнопка — добавить его в календарь.» |
| 5 | `proof.route`, `proof.keys`, `proof.share` | Hand {n} continued… / Hand {n} passed it on with the very key… / Hand {n} kept {amount}… («Рука {n} …») | Pass {n} continued… / Pass {n} was made with the very key that held the link. / Pass {n} kept {amount}… («Передача {n} продолжила… / сделана… / оставила себе…») |
| 5 | `proof.route.to`, `proof.share.to` (new, waiting for code) | — | …said where its own part lands: {who}. / Pass {n} kept {amount} for {who}: … |
| 6 | `give.words.meta` (RU) | Твои слова уйдут автору сообщением, а не в сеть. | Твои слова придут автору сообщением. В записи сети они не попадут. |
| 6 | `give.agree.confirms` (RU) | Кто подтверждает | Подтверждает |
| 6 | `give.agree.byWords`, `give.agree.byOneTime` | The address made from your twelve words, here / «Адрес из твоих двенадцати слов, здесь»; A one-time key, here; … / «Одноразовый ключ, здесь; …» | The address made from your 12 words, on this page / «Адрес из твоих 12 слов, прямо на этой странице»; A one-time key, on this page; … / «Одноразовый ключ, прямо на этой странице; …» |
| 6 | `give.agree.tick` (new, waiting for code) | — | Tick that the 12 words are written down. / «Отметь, что 12 слов записаны.» |
| 6 | `pass.oldLink` (RU) | У кого была старая ссылка, тот всё ещё может передать её иначе. | Ссылка, которую тебе прислали, тоже продолжает работать: её могут передать дальше и другим путём. |
| 6 | `my.unlock.connect` | Connect the account that raised these hands… / «…который поднял эти руки…» | Connect the account you raise hands from to unlock links and replies. / «Подключи аккаунт, с которого поднимаешь руки, чтобы открыть ссылки и ответы.» |

### For the owner: the spec's headline and duty 19 disagree

- UX-SPEC §7.5.7 gives the headline after a thank as "Thanked. Here's who got what — straight from the chain." / «Спасибо сказано. Кто сколько получил — прямо из сети.» The same paragraph says the rows read "left the contract for {payee}", "never received".
- Brief 02, duty 19: "Never show `Paid` as the amount received." With a token that starts taking its own cut after the raise, `Paid` is what left Core and the payee gets less (R-2, R-101).
- **Settled for the duty.** The headline, the same sentence for a hand thanked before, the printed receipt's lead and the passport's line about the helper no longer say "got" / «получил».
- The reviewer proposed "Here's what was sent to whom" / «Кому сколько отправлено». This note chose **"Here's every payout" / «Все выплаты»** instead: when a payee is blocked, the row under the headline says "{amount} is waiting for {payee}", and that money was not sent. "Payout" / «выплата» is already the app's word for a `Paid` and a `Pending` alike ("If a payout can't move, it waits…", the passport's "Payouts").
- Left as they are, and yours to judge: the two headings **before** the thank, `thank.predicted.title` "Who gets what" / «Кто сколько получит» and `my.answer.split` "Who would get what if you thank it now". They are forecasts, not `Paid` amounts, and e2e specs assert them; the same token caveat applies to them in principle.
- UX-SPEC itself was not edited (the vault is read-only for this package). Its §7.5.7 headline, its §7.2 nudge and the „…“ in its §9 Russian sentence now differ from the catalogues on purpose; the spec-quotes script above reports those three.

### For the owner: an open choice — send the worst-case gas limit with a thank, or the wallet's estimate

What exists now (read in the code and on a local chain, 2026-11-20):

- The SDK counts a worst case (`estimateThankGas`, `packages/sdk/src/gas.ts`); its comment calls `gasLimit` "the gas to send the thank with: at worst all of it is used, and no payout gets less than its limit".
- The app sends a thank **without** a gas limit (`apps/hand/src/wallet/send.ts`), so the account's app estimates it. The "Do it without us" `cast send` line carries no `--gas-limit` either.
- Core (`AHandCore.sol`, the comment on `_pay`): "Sent with too little gas on purpose, a payout that itself needs a lot of gas can end up pending too; anyone can then withdraw it to the payee." A payout that runs out of gas does not undo the thank: it waits.
- Measured tonight on a private stand (anvil, the dev wallet), one pass and a helper, test dollars: worst case 679 983 gas; the thank went out with a limit of 155 503 and used 155 503, both payouts `Paid` (block 1 393, traced with `cast run`). The reviewer's route: worst case 973 882, sent 183 796, used 178 996. The dev wallet adds no head-room to its estimate; what MetaMask or a smart account adds was not measured.

What each option means. Dollars at the app's own snapshot (fee study of 2026-11-10: Base 0.006 gwei, Ethereum 0.3 gwei, ETH $2,400), for tonight's route. The limit is money the account must hold up front, not money spent: unused gas is never charged, so the cost of the thank is the same in both.

| | A. The wallet's estimate (now) | B. The SDK's worst case as the limit |
|---|---|---|
| Must be on the account before sending | 155 503 gas: about $0.0022 on Base, $0.11 on Ethereum | 679 983 gas: about $0.0098 on Base, $0.49 on Ethereum (4.4 times more; 5.3 times on the reviewer's route) |
| Security | A payout that needs more gas than the estimate left it goes to "waiting" instead of being paid; nothing is lost, one more step (`withdraw`, by anyone) delivers it | Every payout gets its whole allowance (`payoutGasK`), so none waits for lack of gas |
| What the reader sees | The wallet shows its usual small maximum | The wallet shows a maximum several times the real cost, on the screen where the asker decides |
| Fidelity to the SDK | The SDK's `gasLimit` is used only to say whether the route fits | The SDK's value is used as its comment says |
| Bytes, code | none | one argument in `send.ts`, one flag in the `cast` line |
| Reversible | yes | yes |

A third way would be the estimate with a margin, capped by the worst case. This package changed only the sentence: it now says what happens (the worst case is a fit check; the wallet's estimate is sent). The sending is yours to decide; `apps/hand/src/wallet/send.ts` belongs to app-wallet.

### Where this note went another way than the review proposed

- **Headline:** "every payout", not "what was sent to whom" (above).
- **`proof.giverAmount`:** "The helper's part is {amount}" / «Часть помощника — {amount}», not "The helper's amount is" / «Доля помощника». The line stands under the heading "The helper's amount" and would echo it; «доля» is the passers' word (a share), and the helper's is «часть» (`proof.giveClaim`, `give.agree.claim`).
- **`give.words.meta`:** not «получит только автор». The Share button on the done screen sends the helper's words together with the address (`shareText` in `give/index.tsx`), and when no relay answers the app asks to send it back through whoever sent the link. "Only the asker" would be a promise the app does not keep. The new sentence removes the confusion the reviewer saw («сеть» is the chain in this app): "В записи сети они не попадут."
- **`my.unlock.connect`:** one sentence that names no number of hands, right on the list and on a single hand's page, instead of «…который поднял эту руку», which would be wrong on the list. No code had to change.
- **`pass.oldLink`:** the Russian now says which link ("the one you were sent") and uses «путь», the app's word for a route. The English is UX-SPEC's own sentence and the command-line tool prints the same one, so it stayed.
- **The address beside "Pass {n}"** needs code: a pass that keeps nothing has the zero address as its payee, and "Pass 1 kept $0 for 0x0000…0000" would be worse than no address. The sentences are ready under `.to` keys (Needs, 5).
- **Step 3 of the give screen** cannot tell "nothing chosen" from "the tick is missing" without code (Needs, 4).

### Tests

- `apps/hand/src/i18n/common/review-1.test.ts`: ten tests, one per rule (no "got / received / получил" on screens that show paid amounts; the headline; «…» only; the network's name; the fit line; the nudge; "Pass", never "Hand {n}"; the tick key; the unlock line; the Russian sentences that went). All ten failed before the catalogues changed.
- `apps/hand/src/i18n/common/chain.test.ts`: `chainName` in both languages, a chain the catalogue does not know, and that the ribbon and the name are the same words.

### Checks run (2026-11-20)

| Command | Result |
|---|---|
| `cd apps/hand && bun test src/i18n/common` before the fixes | 0 pass, 11 fail (ten rules, and `chain.ts` missing) |
| `cd apps/hand && bun test` after | 460 pass, 0 fail, 45 files (other packages were editing the tree at the same time) |
| `cd apps/hand && bun run typecheck` | clean |
| A private stand on ports 25350–25352 (`tests/e2e/lib/feat-my/own-stand.ts`: anvil, the relay, the built app), Playwright Chromium 390×844, ru-RU and en-GB: raise for 90 days, pass keeping 10%, help from twelve words, thank with the lens on, the passport, the printed receipt, /my before connecting, /waiting with a blocked payout | 4 tests pass; each asserts the new sentence on the screen and that none of the old ones is there; 24 screenshots in `knowledge/plan/research/2026-11-20-experiment/shots/round-1/fix-words/` |
| The chain afterwards (`cast`) | five thanks in test dollars went through the app: the passer's address holds $10 (5 × $2). The two receipts read (blocks 1 365 and 1 393) have seven logs each; the one traced has `Thanked`, `Shaken`, `Paid`, `Given`, `Paid` and the token's two `Transfer`s |

Not verified live, because the code that shows it belongs to other packages: the Russian network name on /give, /core and /without-us (Needs, 2), «У меня нет — создать адрес» (Needs, 3), the tick sentence (Needs, 4), the address beside "Pass {n}" (Needs, 5). `tests/e2e/guards/russian.spec.ts` was run unchanged against the same stand and stopped earlier than the headline, at its line 112 («Кто-то ищет» on the Deal card, a sentence another package changed tonight), so the three specs' new strings were checked through this package's own run, not through the specs themselves.

### Needs of this round (files this package does not own)

1. **The three specs that pin the old headline.** `tests/e2e/life.spec.ts:339` and `tests/e2e/smoke/thank.spec.ts:187`: `"Thanked. Here's who got what — straight from the chain."` → `"Thanked. Here's every payout — straight from the chain."`. `tests/e2e/guards/russian.spec.ts:157`: `"Спасибо сказано. Кто сколько получил — прямо из сети."` → `"Спасибо сказано. Все выплаты — прямо из сети."`.
2. **The network's name on three screens.** Add `import { chainName } from "../../i18n/common/chain";` and replace `config.chain.name` with `chainName(config.chain)` in `apps/hand/src/screens/give/index.tsx` (the agree card, `{config.chain.name} <span …>`), `apps/hand/src/screens/core/index.tsx` (`{config.chain.name} · CHAIN ID …`) and `apps/hand/src/screens/without-us/index.tsx` (`name: config.chain.name`). `tests/e2e/smoke/give.spec.ts:135` keeps passing: the English name is unchanged.
3. **`apps/hand/src/ui/words.ts`**, `RU.land.fresh`: «У меня нет — сделать» → «У меня нет — создать адрес».
4. **The tick on the give screen.** `LandPicker` (`apps/hand/src/ui/LandSheet.tsx`) knows that words are made and "I wrote them down" is unticked (`choice === "fresh" && fresh && !wrote`), and tells its caller only `undefined`. Give it an optional `onWaiting?: (what: "tick" | undefined) => void`, reported beside `onChange`; in `apps/hand/src/screens/give/index.tsx`, step 3 then shows `t(waiting === "tick" ? "give.agree.tick" : "give.agree.pick")`.
5. **The address beside "Pass {n}".** In `apps/hand/src/screens/proof/model.ts`, `sentenceKeyOf`: when `check.sentence` is `proof.share` or `proof.route` and `check.inputs.payee` is an address other than zero, return `` `${check.sentence}.to` ``. `sentenceOf` in `proof/index.tsx` already passes `who`.
