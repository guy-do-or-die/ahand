# Glossary: one concept, one word

Every concept the app speaks about, with the word that stands for it on screen in English and in Russian, the name Core uses for it, and the words the screens never use for it. The table follows UX-SPEC §5, and the words come from the catalogues (`apps/hand/src/i18n/common/*.ts`, `apps/hand/src/screens/*/{en,ru}.ts`, `apps/hand/src/ui/words.ts`). Russian speaks as «ты».

Core's own names (`HAND`, `SHAKE`, `GIVE`, `handId`, `claimBps`, `payee` and the rest) appear only in the lens. That is the specialist layer, set in mono, where the words below may also be used in their technical sense.

| Concept | EN on screen | RU on screen | Core's name (lens only) | Never on the human layer |
|---|---|---|---|---|
| Hand | hand | рука | `HAND`, `handId`, `hands(id)` | request, post, task, bounty; заявка, запрос |
| Raise | raise a hand; "Raise your hand" | поднять руку; «Поднять руку» | `raise`, `Raised` | create, post, publish; создать, опубликовать |
| Reward | reward | награда | `reward` | pot, pocket, prize, bounty, donation, escrow; копилка, приз, донат, депозит |
| Shake | pass it on; keep a share | передать дальше; оставить себе долю | `SHAKE`, `claimBps`, `nextClaimBps`, margin | shake (on buttons), hop, forward, refer; пожать, переслать, реферал |
| Give | help; "I can help"; an answer | помочь; «Могу помочь»; ответ | `GIVE`, `signer`, `giverSig`, `giveHash` | solve, accept, reply (for a Give); решить, принять |
| Thank | thank; "Say thanks" | поблагодарить; спасибо; «Сказать спасибо» | `thank`, `Thanked` | pay out, settle, mark solved, release; выплатить, закрыть сделку |
| Refund | goes back; "Send it back" | вернётся; «Вернуть» | `refund`, `Refunded` | reclaim, cancel, withdraw (for this); отменить, забрать назад |
| Expiry | open until {date}; Time's up | открыта до {date}; Срок вышел | `expiry`, `MAX_EXPIRY_PERIOD` | deadline (for a hand), expires (as a verb on screen); дедлайн, истекает |
| Extend | keep it open longer | продлить | `extend`, `Extended` | renew, bump; обновить |
| Fund | add to the reward | добавить к награде | `fund`, `Funded` | top up, deposit; пополнить депозит |
| Pending | waiting for you; take it out; deliver | ждёт тебя; забрать; доставить | `pending`, `withdraw`, `Pending`, `Withdrawn` | balance, claim (as a verb), received; баланс, получено |
| Paid | left the contract for {payee} | ушло из контракта на {payee} | `Paid` | got, received, arrived, delivered (as a promise about the token's end); получил, получено, зачислено |
| Payout | a payout; "Here's every payout" (a `Paid` and a `Pending` alike) | выплата; «Все выплаты» | `Paid`, `Pending` | "who got what"; «кто сколько получил» |
| Payee | where the money lands | куда придут деньги | `payee` | recipient, beneficiary, wallet; получатель (allowed only in the two /limits token entries that UX-SPEC quotes) |
| Raiser | the asker; "Someone" on the Deal card | автор; «Кто-то» | `raiser` | owner, friend, creator, poster; хозяин, друг, создатель |
| Helper | the helper | помощник | `giver` | solver, winner, recipient; победитель |
| Holder | someone; a short address where a share was named | кто-то; короткий адрес | the key in a `Shake` | friend, friend of a friend, contact; друг, знакомый |
| Route | route | путь | `shakes[]`, `routeHash` | chain (for a route), path (mixed with route), hops; цепочка |
| A position on a route | Pass {n} | Передача {n} | `shakes[n − 1]`, `position` | Hand {n}, hop {n}; Рука {n} (a hand is the whole request) |
| Visibility | public / unlisted / dark | открытая / по ссылке / тёмная | dataHash shape: faced, bare | private, secret, encrypted; приватная, секретная, шифрованная |
| Cost of an action | costs about $… | стоит около $… | `gas`, gwei, ETH | fee, gas, network cost, gasless; комиссия, газ |
| Time | the network's clock | часы сети | block `timestamp` | your clock, local time (for a comparison); время устройства |
| The network's name | Local test network (chain 31337); any other chain: the name its configuration gives | Локальная тестовая сеть | `chain.id`; `common.chain.<id>`, read through `chainName()` | `config.chain.name` straight on a screen (it is English only) |
| Keys confirmation | one confirmation; "Unlock links and replies" | одно подтверждение; «Открыть ссылки и ответы» | `Keys(string purpose, address raiser)`, EIP-712 | sign, signature, password; подпись, пароль |
| Account | account; "Connect a wallet" (the one allowed use of "wallet") | аккаунт; «Подключить кошелёк» | EOA, smart account, ERC-1271, ERC-6492 | wallet (anywhere else), custody; кошелёк (где-либо ещё) |
| Relay | relay | реле | NIP-17 gift wrap, `inbox.n1` | server, mailbox, ретранслятор |
| Proof page | the passport | паспорт | `checks`, `verify` | audit, certificate; аудит, сертификат |

## Words that need a reason

- **safe / в безопасности**: only in "Your money is safe where it is." on /waiting (UX-SPEC §9).
- **fee / комиссия**: only in the lens copy of Core's accepted limits ("fee-switching tokens", "no fee"). The footer's "No fee" / «Без комиссии» was removed with its line on 2026-11-21 (the owner's decision; [app](app.md)).
- **got / received / получил**: never for `Paid`, on any screen that shows paid amounts (brief 02, duty 19). Paid money "left the contract"; a token that takes a cut may deliver less. The headline after a thank and the printed receipt say "every payout" / «все выплаты». `review-1.test.ts` fails on these words in the thank, proof, print, hand, my, waiting, check and care catalogues.
- **guarantee, secure, trustless, instantly, every cent, $0**: not used. A hand with no reward says "No reward: a thank-you only".
- **Unaudited / Без аудита**: always this word, never "audited".

## Sentence rules

- Headlines are short sentences that end in a full stop: "Your hand is up."
- Meta lines are fragments joined by a middle dot: "$40 reward · open until 20 Dec".
- An error says what happened. Where money could be in doubt, it then says what was not lost: "Nothing was sent.", "Nothing left your account.", "The money stays waiting; nothing was lost."
- Russian quotes are «…» everywhere, never „…“ or "…" (`review-1.test.ts` checks the human layer).
- A sentence promises only what happens by itself. What needs one more press says so: "After you raise it, you'll get a button to add a calendar reminder."
- Any amount promised to a helper says "if they thank you" (or "if this route is thanked"). Thanking is called voluntary on the Hand view, the give screen and /limits.
