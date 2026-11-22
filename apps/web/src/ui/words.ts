import { useLang, type Lang } from "./ambient";

/**
 * The kit's own words, in English and Russian. A component that speaks
 * takes its language from the page (ui/ambient) and its sentences from here, so the same
 * sentence is the same everywhere it appears. `RU` is typed by `EN`, so a sentence missing in
 * one language does not compile; words.test.ts checks the banned words.
 *
 * Core's own names (hands, reward, claimBps) stay untranslated: they stand in mono, in evidence.
 */

const ruHands = new Intl.PluralRules("ru-RU");

const EN = {
  close: "Close",
  /** An amount above zero and under one cent (`money` in format.ts). */
  underCent: "under $0.01",
  theme: { switch: "Switch between light and dark", light: "light", dark: "dark" },
  copy: {
    copy: "Copy",
    copied: "Copied",
    failed: "Couldn't copy. Select the text and copy it by hand.",
    link: "Copy link",
    share: "Share",
  },
  rail: {
    count: (n: number) => (n === 1 ? "1 hand so far." : `${n} hands so far.`),
    you: "You",
    someone: "someone",
    asker: "the asker",
    passer: "passed it on",
    helper: "helped",
    next: "the next person?",
    askerOwn: "the asker's own address",
    askerOwnWhy: "This pass named the asker's own address: its share goes back to the asker, or the link went to the asker's key. The contract allows it.",
    dropped: "left out of this route",
  },
  marks: {
    checked: "Checked here",
    chain: "On chain",
    waiting: "Waiting",
  },
  tx: {
    label: "How far it has got",
    steps: ["Sent", "In a block", "Recorded on Ethereum", "Final"] as readonly string[],
    done: "done",
    now: "now",
    todo: "not yet",
    localTag: "Local stand-in",
    localWhy: "This local network has no Ethereum behind it. Here these two steps mean 1 and 2 blocks later.",
    /** The calm view's one sentence for each step (the lens shows the four steps instead). */
    calm: ["Sending…", "It went through. Making it final…", "It went through. Almost final…", "Done. It can't be undone."] as readonly string[],
  },
  disclose: { show: "show", hide: "hide" },
  /** The route as the spine of the receiver's screen: who asked, who passed it on, you (ui/Spine.tsx). */
  spine: {
    reward: (amount: string) => `Reward ${amount}`,
    passed: (n: number) => (n === 1 ? "Someone passed it on" : `${n} people passed it on`),
    kept: (amount: string, _n: number) => `kept ${amount}`,
    flagged: "A pass here named",
    /** The viewer's own beat: the hand has come to them. */
    you: "It reached you",
    /** The beat of whoever answered, on a Hand that has an answer. */
    answered: "Someone answered",
    /** Above the nearest passes of a very long route: how many came before them. */
    earlier: (n: number) => (n === 1 ? "and 1 more before them" : `and ${n} more before them`),
  },
  deal: {
    /**
     * The line above the Hand's own title. A whole sentence, so a title of any shape reads after
     * it: a question, a noun phrase, a plea. It is the bare card's sentence, ending in a colon.
     */
    intro: "Someone raised a hand:",
    bare: "Someone raised a hand.",
    lost: "The description didn't arrive with this link. Ask whoever sent it.",
    /** The amount's name where no condition stands over it: a hand that is over, or the lens. It
     *  stands in its own column beside the amount and starts its line, capitalised by the card's
     *  stylesheet (`.ah-deal__what::first-letter`), so it is a bare word in every language, with no
     *  dash before it. */
    rewardWord: "reward",
    /** Beside the amount that reaches the helper: the whole reward, and what passes before kept. */
    ofWhole: (whole: string, kept: string) => `of ${whole}: ${kept} was kept along the way`,
    noReward: "No reward: a thank-you only",
    openUntil: (date: string) => `open until ${date}`,
    until: (date: string) => `until ${date}`,
    wasOpenUntil: (date: string) => `was open until ${date}`,
    ifHelp: "If you help and they thank you",
    atLeast: (amount: string) => `at least ${amount}`,
    ifPass: "If you pass it on",
    keepShare: "keep a share you choose",
    passFree: "it's free. There is no share to keep",
    ifNobody: (date: string) => `If nobody is thanked by ${date}`,
    /** In the card's calm form the date stands once, at the asker; this row points back at it. */
    ifNobodyThen: "If nobody is thanked by then",
    /** After the date: how far off it is ("in 1 month and 7 days"), and the last hour of a Hand. */
    inTime: (span: string) => `in ${span}`,
    soon: "in under an hour",
    goesBack: "the whole reward goes back",
    closes: "the hand closes",
    timeUp: "Time's up.",
    sendBack: "Anyone can send the reward back to the asker now.",
    closeNow: "Anyone can close this hand now.",
    thanked: (date: string) => `Thanked on ${date}.`,
    refunded: (date: string) => `The reward went back on ${date}.`,
    closed: (date: string) => `This hand closed on ${date}.`,
    noClock: "Can't reach the network right now.",
    askedBy: "Asked by",
    askedByLater: "your address, once you connect",
    askedByLaterLogIn: "your address, once you log in",
    block: "block",
    networkTime: "Network time",
    floorWhy: "what is left of the reward at your place on this route. Each pass's share is rounded down, so yours is rounded up",
    wordsLabel: "In the asker's words — not checked",
    readAll: "Read all",
    readLess: "Show less",
    amountFlag: (amounts: string, reward: string) => `The words mention ${amounts}. The reward on chain is ${reward}.`,
    amountFlagNone: (amounts: string) => `The words mention ${amounts}. On chain this hand has no reward.`,
    hiddenChars: "Some characters here are invisible, turn the text around, or pass for other letters and digits. Each is marked where it stands.",
    hiddenToken: (name: string) => `Hidden character ${name}`,
    mixedScript: "Letters from different alphabets in one word",
    compat: "Digits or symbols in an unusual form",
    /**
     * The same card read by the asker on their own screens (/my, /care, /thank). Core refuses a
     * Give from the asker (GiverIsRaiser), so the holder's rows "if you help", "if you pass it
     * on" can never apply to them; these rows speak about whoever helps, and the floor is called
     * the floor the asker set, never "what you get".
     */
    asker: {
      intro: "You raised a hand:",
      bare: "You raised a hand.",
      wordsLabel: "In your own words — nobody checked them",
      ifHelp: "Whoever helps and is thanked",
      floor: (amount: string, pct: string) => `at least ${amount} (the floor you set: ${pct})`,
      ifPass: "Whoever passes it on",
      keepShare: "keeps a share they choose",
      ifNobody: (date: string) => `If you thank nobody by ${date}`,
      ifNobodyThen: "If you thank nobody by then",
      goesBack: "the whole reward comes back to you",
      sendBack: "Anyone can send the reward back to you now.",
      askedBy: "Asked from your address",
      floorWhy: "the least a helper is left, however long the route grows. Each pass's share is rounded down, so the helper's is rounded up",
    },
  },
  receipt: {
    /** What left the contract for whom. Never "got" or "received": Paid is not an arrival. */
    caption: "What was sent to whom, from the chain's own records",
    passed: "passed it on",
    helped: "helped",
    back: "back to the asker",
    total: "the whole reward",
    keptNothing: "kept nothing",
    thanksOnly: "a thank-you only",
    notRead: "not read yet",
  },
  money: {
    invalid: (digits: number) => `A number, with at most ${digits} digits after the point.`,
    tooMuch: (max: string) => `At most ${max}.`,
    thousands: (plain: string) => `Is that a thousand or more? Write it without a comma: ${plain}.`,
  },
  address: {
    incomplete: "This isn't a whole address yet: 0x and 40 more characters.",
    typo: "This address has a slip in it: its capital letters don't add up. Copy it again.",
    zero: "That is the empty address. Money sent there is gone. Choose another.",
    core: "That is the contract's own address. Money sent there stays locked for good. Choose another.",
    raiser: "That is the asker's own address. The money would go back to the person who asked. Is that what you mean?",
    token: "That is the dollar token's own contract. Most tokens keep what is sent to them. Is that what you mean?",
    ok: "We can't check who owns an address. Read it twice.",
    refused: "Refused",
    flagged: "Check",
  },
  land: {
    askGive: "Where should the money land?",
    askShare: "Where should your share land?",
    account: "My connected account",
    accountGive: "The money lands here, and this account confirms your answer on its own screen.",
    accountShare: "Your share lands here.",
    connect: "Connect a wallet",
    connectHint: "Or choose one of the two ways below. Neither needs one.",
    logIn: "Log in to get paid",
    logInHint: "With your email or a crypto app: the money lands in that account. Or choose one of the ways below.",
    address: "An address I have",
    addressLabel: "The address",
    addressHint: "Paste any address. An exchange deposit address is fine.",
    oneTime: "A one-time key confirms your answer here and is thrown away.",
    addressCalm: "The money goes to the address you pasted.",
    keepKey: "Keep this answer's key",
    keepKeyHint: "A small file. Future receipts would belong to it.",
    fresh: "I have none — make one",
    freshWarn:
      "These 12 words are the only key to this address. Write them down before you go on. We don't keep them. They open it in any crypto app. Moving money out of it later costs a little ETH.",
    freshAddress: "The address made from these words",
    freshGive: "It receives the money and confirms your answer.",
    wrote: "I wrote them down",
    others: "Make other words",
    done: "Use this address",
  },
  cost: {
    line: (base: string, ethereum: string) => `costs about $${base} on Base · $${ethereum} on Ethereum`,
    asOf: (date: string) => `prices of ${date}`,
    how: "how this is counted",
    /** The calm view's line: only the fee on the network this site uses. */
    calm: (base: string) => `sending it costs about $${base}`,
  },
  qr: {
    alt: "A code that carries this link",
    tooDense: "Too long for a code. Send it as text.",
  },
  error: { label: "What happened" },
};

export type Words = typeof EN;

const RU: Words = {
  close: "Закрыть",
  underCent: "меньше $0,01",
  theme: { switch: "Переключить светлую и тёмную тему", light: "светлая", dark: "тёмная" },
  copy: {
    copy: "Копировать",
    copied: "Скопировано",
    failed: "Не получилось скопировать. Выдели текст и скопируй вручную.",
    link: "Скопировать ссылку",
    share: "Поделиться",
  },
  rail: {
    count: (n: number) => {
      const form = ruHands.select(n);
      return `Уже ${n} ${form === "one" ? "рука" : form === "few" ? "руки" : "рук"}.`;
    },
    you: "Ты",
    someone: "кто-то",
    asker: "автор",
    passer: "передали дальше",
    helper: "помогли",
    next: "следующий?",
    askerOwn: "адрес самого автора",
    askerOwnWhy: "Эта передача назвала адрес самого автора: её доля вернётся автору, или ссылка ушла на ключ автора. Контракт это разрешает.",
    dropped: "не вошёл в этот путь",
  },
  marks: {
    checked: "Проверено здесь",
    chain: "В сети",
    waiting: "Ждёт",
  },
  tx: {
    label: "Как далеко оно дошло",
    steps: ["Отправлено", "В блоке", "Записано в Ethereum", "Окончательно"],
    done: "готово",
    now: "сейчас",
    todo: "ещё нет",
    localTag: "Локальная замена",
    localWhy: "За этой локальной сетью нет Ethereum. Здесь эти два шага значат: на 1 и на 2 блока позже.",
    calm: ["Отправляем…", "Прошло. Закрепляем…", "Прошло. Почти закреплено…", "Готово. Отменить это уже нельзя."],
  },
  disclose: { show: "показать", hide: "скрыть" },
  spine: {
    reward: (amount: string) => `Награда ${amount}`,
    passed: (n: number) => {
      if (n === 1) return "Кто-то передал дальше";
      const form = ruHands.select(n);
      return form === "one" ? `${n} человек передал дальше` : form === "few" ? `${n} человека передали дальше` : `${n} человек передали дальше`;
    },
    kept: (amount: string, n: number) => (ruHands.select(n) === "one" ? `оставил себе ${amount}` : `оставили себе ${amount}`),
    flagged: "Одна из передач назвала",
    you: "Дошло до тебя",
    answered: "Кто-то ответил",
    earlier: (n: number) => `и ещё ${n} до них`,
  },
  deal: {
    intro: "Кто-то поднял руку:",
    bare: "Кто-то поднял руку.",
    lost: "Описание не дошло вместе со ссылкой. Спроси у того, кто её прислал.",
    rewardWord: "награда",
    ofWhole: (whole: string, kept: string) => `из ${whole}: ${kept} оставили себе по пути`,
    noReward: "Без награды: только спасибо",
    openUntil: (date: string) => `рука открыта до ${date}`,
    until: (date: string) => `до ${date}`,
    wasOpenUntil: (date: string) => `рука была открыта до ${date}`,
    ifHelp: "Если поможешь и тебя поблагодарят",
    atLeast: (amount: string) => `минимум ${amount}`,
    ifPass: "Передашь дальше",
    keepShare: "оставь себе долю, сколько решишь",
    passFree: "бесплатно. Доли здесь нет",
    ifNobody: (date: string) => `Никого не поблагодарят до ${date}`,
    ifNobodyThen: "Если до тех пор никого не поблагодарят",
    inTime: (span: string) => `через ${span}`,
    soon: "меньше чем через час",
    goesBack: "вся награда вернётся автору",
    closes: "рука закроется",
    timeUp: "Срок вышел.",
    sendBack: "Теперь кто угодно может вернуть награду автору.",
    closeNow: "Теперь кто угодно может закрыть эту руку.",
    thanked: (date: string) => `Спасибо сказано ${date}.`,
    refunded: (date: string) => `Награда вернулась ${date}.`,
    closed: (date: string) => `Рука закрылась ${date}.`,
    noClock: "Сеть сейчас недоступна.",
    askedBy: "Автор",
    askedByLater: "твой адрес — появится после подключения",
    askedByLaterLogIn: "твой адрес — появится после входа",
    block: "блок",
    networkTime: "Время сети",
    floorWhy: "что остаётся от награды на твоём месте этого пути. Доля каждой передачи округляется вниз, поэтому твоя — вверх",
    wordsLabel: "Словами автора — не проверено",
    readAll: "Читать целиком",
    readLess: "Свернуть",
    amountFlag: (amounts: string, reward: string) => `В тексте написано ${amounts}. Награда в контракте — ${reward}.`,
    amountFlagNone: (amounts: string) => `В тексте написано ${amounts}. В контракте у этой руки награды нет.`,
    hiddenChars: "Некоторые символы здесь не видны, переворачивают текст или выдают себя за другие буквы и цифры. Каждый отмечен там, где стоит.",
    hiddenToken: (name: string) => `Скрытый символ ${name}`,
    mixedScript: "В одном слове буквы разных алфавитов",
    compat: "Цифры или символы в необычном начертании",
    asker: {
      intro: "Ты поднял руку:",
      bare: "Ты поднял руку.",
      wordsLabel: "Твоими словами — их никто не проверял",
      ifHelp: "Кто поможет и кого поблагодарят",
      floor: (amount: string, pct: string) => `минимум ${amount} (нижняя граница, которую ты задал: ${pct})`,
      ifPass: "Кто передаст дальше",
      keepShare: "оставит себе долю, сколько решит",
      ifNobody: (date: string) => `Если никого не поблагодаришь до ${date}`,
      ifNobodyThen: "Если до тех пор никого не поблагодаришь",
      goesBack: "вся награда вернётся тебе",
      sendBack: "Теперь кто угодно может вернуть награду тебе.",
      askedBy: "Твой адрес",
      floorWhy: "меньше этого помощнику не останется, как бы ни вырос путь. Доля каждой передачи округляется вниз, поэтому доля помощника — вверх",
    },
  },
  receipt: {
    caption: "Кому сколько отправлено — по записям самой сети",
    passed: "передали дальше",
    helped: "помогли",
    back: "вернулось автору",
    total: "вся награда",
    keptNothing: "не оставили себе ничего",
    thanksOnly: "только спасибо",
    notRead: "ещё не прочитано",
  },
  money: {
    invalid: (digits: number) => `Нужно число, после запятой не больше ${digits} знаков.`,
    tooMuch: (max: string) => `Не больше ${max}.`,
    thousands: (plain: string) => `Это тысяча или больше? Напиши без запятой: ${plain}.`,
  },
  address: {
    incomplete: "Это ещё не весь адрес: 0x и ещё 40 знаков.",
    typo: "В адресе опечатка: заглавные буквы не сходятся. Скопируй его ещё раз.",
    zero: "Это пустой адрес. Деньги, отправленные туда, пропадут. Выбери другой.",
    core: "Это адрес самого контракта. Деньги, отправленные туда, останутся заперты навсегда. Выбери другой.",
    raiser: "Это адрес самого автора. Деньги вернутся тому, кто просил. Так и задумано?",
    token: "Это контракт самого долларового токена. Большинство токенов не отдают то, что им прислали. Так и задумано?",
    ok: "Мы не можем проверить, чей это адрес. Перечитай дважды.",
    refused: "Отказ",
    flagged: "Проверь",
  },
  land: {
    askGive: "Куда придут деньги?",
    askShare: "Куда придёт твоя доля?",
    account: "Мой подключённый аккаунт",
    accountGive: "Деньги придут сюда, а твой ответ этот аккаунт подтвердит на своём экране.",
    accountShare: "Твоя доля придёт сюда.",
    connect: "Подключить кошелёк",
    connectHint: "Или выбери способ ниже — для него ничего подключать не нужно.",
    logIn: "Войти, чтобы получить деньги",
    logInHint: "По почте или через криптоприложение: деньги придут на этот аккаунт. Или выбери способ ниже.",
    address: "Адрес у меня есть",
    addressLabel: "Адрес",
    addressHint: "Вставь любой адрес. Адрес пополнения на бирже тоже подойдёт.",
    oneTime: "Твой ответ подтвердит одноразовый ключ прямо здесь, после этого он выбрасывается.",
    addressCalm: "Деньги придут на адрес, который ты вставил.",
    keepKey: "Сохранить ключ этого ответа",
    keepKeyHint: "Небольшой файл. По нему потом можно будет забрать квитанции этого ответа.",
    fresh: "Адреса нет — создать новый",
    freshWarn:
      "Эти 12 слов — единственный ключ к адресу. Запиши их, прежде чем идти дальше: мы их не храним. По ним адрес откроется в любом криптоприложении. Чтобы потом перевести деньги дальше, понадобится немного ETH.",
    freshAddress: "Адрес из этих слов",
    freshGive: "На него придут деньги, и им же подтвердится твой ответ.",
    wrote: "Слова записаны",
    others: "Сделать другие слова",
    done: "Выбрать этот адрес",
  },
  cost: {
    line: (base: string, ethereum: string) => `стоит около $${base} на Base · $${ethereum} на Ethereum`,
    asOf: (date: string) => `цены на ${date}`,
    how: "как это посчитано",
    calm: (base: string) => `отправка стоит около $${base}`,
  },
  qr: {
    alt: "Код, в котором лежит эта ссылка",
    tooDense: "Слишком длинно для кода. Отправь текстом.",
  },
  error: { label: "Что случилось" },
};

export const WORDS: Record<Lang, Words> = { en: EN, ru: RU };

export function wordsOf(lang: Lang): Words {
  return WORDS[lang];
}

/** The kit's words in the page's language, or in the one a component was handed. */
export function useWords(lang?: Lang): Words {
  const ambient = useLang();
  return WORDS[lang ?? ambient];
}
