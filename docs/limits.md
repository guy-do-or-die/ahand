# What it can't promise

```
/limits  ·  What it can't promise.  ·  Чего она не обещает.
1. Thanking is voluntary. The asker can get help and let the hand run out; the reward then goes back to them.
```

The sixteen entries of the `/limits` screen, in its order: the twelve accepted limits of the owner's record (1–11 and 16), the two token risks of the plan's token policy (12, 13), and the two this build adds (14, 15). The words are the screen's own, copied on 2026-11-20 from `apps/hand/src/screens/limits/en.ts` and `ru.ts` (the order and the sources from `index.tsx`); if the catalogue changes, the screen is right and this page is stale. The `/raise` screen repeats the USDC line under the reward; `/core` repeats the twelve accepted limits in the record's own wording. Tested by `tests/e2e/smoke/about.spec.ts` ("/limits 16 entries in EN and RU with both token entries").

### 1. Thanking is voluntary.

Thanking is voluntary. The asker can get help and let the hand run out; the reward then goes back to them.

*For example:* You name exactly the right person. The asker says “thanks!” in a chat, never presses Thank, and on the last day the whole reward goes back to them. Nothing in the contract can make them pay.

RU: Благодарить — по желанию. Автор может получить помощь и дождаться конца срока; тогда награда вернётся ему.

Source: `R-3 · ACCEPTED LIMITS` · from the record's twelve accepted limits · key `limits.voluntary`

### 2. Whoever passes it on relies on the asker and the helper.

Whoever passes it on relies on the asker and the helper. Anyone who held the link earlier, the asker included, can offer the helper a shorter route that leaves later people out, and the helper can accept it. The contract only makes this visible and provable.

*For example:* You pass the link on, and the next person passes it to the helper. The asker offers the helper a route without that person; the helper agrees; that person gets nothing. The receipt shows which route was paid.

RU: Тот, кто передаёт дальше, полагается на автора и помощника. Любой, у кого ссылка была раньше, включая автора, может предложить помощнику путь покороче, без тех, кто был после него, и помощник может согласиться. Контракт только делает это видимым и доказуемым.

Source: `R-29 · ONEDOLLARAUDIT M-3` · from the record's twelve accepted limits · key `limits.route`

### 3. A second address is invisible.

A second address is invisible. The contract only stops the asker's own address from being the helper; the asker answering from another address looks like any other helper.

*For example:* The asker answers their own hand from a second address and thanks it. On the receipt it looks like a normal deal.

RU: Второй адрес не виден. Контракт не даёт стать помощником только собственному адресу автора; если автор отвечает с другого адреса, это выглядит как обычный помощник.

Source: `R-4 · GIVERISRAISER COMPARES ADDRESSES` · from the record's twelve accepted limits · key `limits.second`

### 4. A very long route can't be thanked.

A very long route can't be thanked. More than about 369 passes, or about 70 paid shares in a token that runs the payee's own code on every payment, don't fit into one thanks. Only that branch is stuck, and anyone holding the link can pad a branch with empty passes.

*For example:* Someone passes the link to themselves 400 times before it reaches a helper. That branch can no longer be thanked; a helper reached by another branch still can.

RU: Очень длинный путь нельзя поблагодарить. Больше примерно 369 передач или примерно 70 оплачиваемых долей в токене, который при каждой выплате запускает код получателя, в одну благодарность не помещаются. Застревает только эта ветка, и любой, у кого есть ссылка, может забить ветку пустыми передачами.

Source: `R-45 · R-46 · ONEDOLLARAUDIT M-1` · from the record's twelve accepted limits · key `limits.length`

### 5. Tokens that change balances by themselves don't fit.

Tokens that change balances by themselves don't fit. With a token that grows, shrinks or takes a cut on its own, the last people paid can get less, or their money waits until payments come out exact again. Any extra, and any token sent to the contract directly, stays in it forever.

*For example:* A token starts keeping 1% of every payment. The helper, paid last, gets less than the receipt promised, or the payment waits.

RU: Токены, которые сами меняют балансы, не подходят. С токеном, который сам растёт, уменьшается или удерживает часть, последние в очереди на выплату могут получить меньше, или их деньги будут ждать, пока выплаты снова не станут точными. Любой излишек и любой токен, отправленный в контракт напрямую, останутся в нём навсегда.

Source: `R-2 · R-26 · R-102 · ONEDOLLARAUDIT M-2, L-8` · from the record's twelve accepted limits · key `limits.balances`

### 6. Money for a blocked address waits.

Money for a blocked address waits. If a token refuses to pay an address, that share waits in the contract, and only that address can send it somewhere else.

*For example:* The helper's address is on the token's block list. Everyone else on the receipt is paid at once; the helper's part waits until the helper takes it out to another address.

RU: Деньги для заблокированного адреса ждут. Если токен отказывается платить на какой-то адрес, эта доля ждёт в контракте, и только сам этот адрес может отправить её в другое место.

Source: `R-26 · PENDING · WITHDRAW` · from the record's twelve accepted limits · key `limits.blocked`

### 7. A pass or an answer can't be taken back.

A pass or an answer can't be taken back. They have no deadline of their own and count for as long as the hand is open, even after it is extended.

*For example:* You passed a link in March and regret it in April. The pass still counts; only the end of the hand ends it.

RU: Передачу или ответ нельзя забрать назад. У них нет своего срока, и они действуют, пока рука открыта, даже после продления.

Source: `R-20` · from the record's twelve accepted limits · key `limits.forever`

### 8. At most 180 days at a time.

At most 180 days at a time. Each raise or extension reaches at most 180 days ahead. If the asker misses an extension, the reward goes back and every route collected so far is dead.

*For example:* A hand open until 1 June isn't extended in time. On 1 June anyone can send the reward back, and every link passed around for months opens as closed.

RU: Не больше 180 дней за раз. Каждый подъём или продление — максимум на 180 дней вперёд. Если автор не продлит вовремя, награда вернётся, а все собранные пути пропадут.

Source: `R-98 · R-99 · MAX_EXPIRY_PERIOD 180 D` · from the record's twelve accepted limits · key `limits.cap`

### 9. Lose the link and only the way back remains.

Lose the link and only the way back remains. If the asker loses what opens the hand's link, nobody can be thanked; after the end the reward goes back.

*For example:* The asker's only device is lost with the saved link, and the hand can't be rebuilt anywhere else. The hand waits out its time, then the reward goes back.

RU: Потеряешь ссылку — останется только возврат. Если автор потеряет то, что открывает ссылку руки, поблагодарить никого не выйдет; после конца срока награда вернётся.

Source: `R-19 · ROOT KEY` · from the record's twelve accepted limits · key `limits.lost`

### 10. Nobody can fix it or rescue anything.

Nobody can fix it or rescue anything. The contract has no owner, takes nothing and has no rescue switch. A mistake in it is permanent.

*For example:* If a flaw were found tomorrow, there would be no one to pause it and no way to move money out except by its own rules.

RU: Никто не может её исправить или что-то спасти. У контракта нет владельца, он ничего себе не берёт, и в нём нет кнопки спасения. Ошибка в нём — навсегда.

Source: `NO OWNER · NO ADMIN · NO RESCUE FUNCTION` · from the record's twelve accepted limits · key `limits.rescue`

### 11. A send-back can be pushed into waiting.

A send-back can be pushed into waiting. Anyone can send a hand back after its end, and someone who starts it with too little room to run can leave the asker's money waiting instead of delivered. Then one more step, taking it out, gets it.

*For example:* An outsider sends an ended hand back on purpose with too little room. The reward shows up as waiting for the asker, who takes it out with one more press.

RU: Возврат можно столкнуть в ожидание. Вернуть руку после конца срока может кто угодно, и тот, кто запустит возврат впритык, без запаса на выполнение, может оставить деньги автора ждать вместо того, чтобы их доставить. Тогда нужен ещё один шаг — забрать их.

Source: `R-33 · REFUND → PENDING` · from the record's twelve accepted limits · key `limits.refund`

### 12. If a token stops moving or changes its rules after a reward is locked, everything held in that token is stuck in the contract: rewards, waiting money and the way back to the asker.

If a token stops moving or changes its rules after a reward is locked, everything held in that token is stuck in the contract: rewards, waiting money and the way back to the asker. Nobody can rescue it.

*For example:* The makers of a token switch off all payments. Every reward in it, every share waiting in it and every send-back in it stay where they are.

RU: Если токен перестанет переводиться или сменит правила после того, как награда положена, в контракте застрянет всё, что в нём лежит: награды, ждущие деньги и возврат автору. Спасти их некому.

Source: `PLAN · TOKEN POLICY · MAINNET RISKS` · from the plan's token policy · key `limits.token`

### 13. USDC has an issuer.

USDC has an issuer. It can freeze any address, the contract's own included, or the whole token. A frozen payee's money waits. If the contract itself is frozen, every hand in USDC is stuck, the way back included.

*For example:* The issuer freezes the helper's address: that share waits. The issuer freezes the contract: no hand in USDC can be thanked or sent back.

RU: У USDC есть эмитент. Он может заморозить любой адрес, в том числе сам контракт, или весь токен. Деньги замороженного получателя ждут. Если заморожен сам контракт, застрянут все руки в USDC, включая возврат.

Source: `PLAN · TOKEN POLICY · USDC BLOCKLIST` · from the plan's token policy · key `limits.usdc`

### 14. This site's code reads your link.

This site's code reads your link. A server never receives what follows # in an address, but the code this site serves reads it in your browser, because that is how a link opens. A dishonest or look-alike site could copy a link, or write a different address for the money into a pass.

*For example:* You open a link on a copy of this site at an address one letter off. It shows the same card and quietly keeps your link. Check the address bar; the same code also runs from your own copy, with no site.

RU: Код этого сайта читает твою ссылку. Сервер никогда не получает то, что стоит после # в адресе, но код, который отдаёт этот сайт, читает это в твоём браузере — иначе ссылка не откроется. Нечестный сайт или сайт-двойник может скопировать ссылку или вписать в передачу другой адрес для денег.

Source: `THIS BUILD · ARCHITECTURE §9, §11` · from this build · key `limits.code`

### 15. Another site can ask for the same keys confirmation.

Another site can ask for the same keys confirmation. A hand's keys come from one fixed message your account confirms. A site that gets the same confirmation can rebuild your links and read the answers sent to you. It can never take the reward: only your account thanks or gets it back.

*For example:* A site you don't know asks you to confirm the message about your aHand links. If you did, treat every link you made as seen by that site.

RU: Другой сайт может попросить то же подтверждение ключей. Ключи руки получаются из одного неизменного сообщения, которое подтверждает твой аккаунт. Сайт, получивший такое же подтверждение, сможет восстановить твои ссылки и читать присланные тебе ответы. Забрать награду он не сможет никогда: благодарит и получает её назад только твой аккаунт.

Source: `THIS BUILD · D-19 · KEYS/1 MESSAGE` · from this build · key `limits.keys`

### 16. Unaudited: seven AI reviews and one AI scan found no defect; no professional audit has been done.

Unaudited: seven AI reviews and one AI scan found no defect; no professional audit has been done.

*For example:* Confirmations from smart accounts were tried with only two kinds of them. Nobody has been paid to look for what the AI reviews might have missed.

RU: Без аудита: семь проверок ИИ и одно сканирование ИИ не нашли дефектов; профессионального аудита не было.

Source: `7 AI REVIEWS · 1 AI SCAN · TESTED: COINBASE SMART WALLET, SAFE 1.4.1` · from the record's twelve accepted limits · key `limits.unaudited`

