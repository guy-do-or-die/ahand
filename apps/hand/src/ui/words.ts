import { useLang, type Lang } from "./ambient";

/**
 * The kit's own words, in English and Russian (UX-SPEC §4, §5, §8.6). A component that speaks
 * takes its language from the page (ui/ambient) and its sentences from here, so the same
 * sentence is the same everywhere it appears. `RU` is typed by `EN`, so a sentence missing in
 * one language does not compile; words.test.ts checks the banned words of UX-SPEC §5.
 *
 * Core's own names (hands, reward, claimBps) stay untranslated: they stand in mono, in evidence.
 */

const ruHands = new Intl.PluralRules("ru-RU");

const EN = {
  close: "Close",
  theme: { switch: "Switch between light and dark", light: "light", dark: "dark" },
  copy: {
    copy: "Copy",
    copied: "Copied",
    failed: "Couldn't copy. Select the text and copy it by hand.",
  },
  rail: {
    count: (n: number) => (n === 1 ? "1 hand so far." : `${n} hands so far.`),
    you: "You",
    someone: "someone",
    asker: "the asker",
    passer: "passed it on",
    helper: "helped",
    next: "the next person?",
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
  },
  disclose: { show: "show", hide: "hide" },
  deal: {
    intro: "Someone is looking for",
    bare: "Someone raised a hand.",
    lost: "The description didn't arrive with this link. Ask whoever sent it.",
    /** The words around the amount: "[$40] reward". */
    reward: ["", " reward"] as readonly [string, string],
    noReward: "No reward: a thank-you only",
    openUntil: (date: string) => `open until ${date}`,
    until: (date: string) => `until ${date}`,
    wasOpenUntil: (date: string) => `was open until ${date}`,
    ifHelp: "If you help and they thank you",
    atLeast: (amount: string) => `at least ${amount}`,
    ifPass: "If you pass it on",
    keepShare: "keep a share you choose",
    passFree: "it's free; there is no share to keep",
    ifNobody: (date: string) => `If nobody is thanked by ${date}`,
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
    block: "block",
    networkTime: "Network time",
    floorWhy: "what is left of the reward at your place on this route",
  },
  receipt: {
    caption: "Who got what, from the chain's own records",
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
    address: "An address I have",
    addressLabel: "The address",
    addressHint: "Paste any address. An exchange deposit address is fine.",
    oneTime: "A one-time key confirms your answer here and is thrown away.",
    keepKey: "Keep this answer's key",
    keepKeyHint: "A small file. Future receipts would belong to it.",
    fresh: "I have none — make one",
    freshWarn:
      "These 12 words are the only key to this address. Write them down before you go on; we don't keep them. They open it in any crypto app. Moving money out of it later costs a little ETH.",
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
  theme: { switch: "Переключить светлую и тёмную тему", light: "светлая", dark: "тёмная" },
  copy: {
    copy: "Копировать",
    copied: "Скопировано",
    failed: "Не получилось скопировать. Выдели текст и скопируй вручную.",
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
  },
  marks: {
    checked: "Проверено здесь",
    chain: "В сети",
    waiting: "Ждёт",
  },
  tx: {
    label: "Как далеко оно дошло",
    steps: ["Отправлено", "В блоке", "Записано в Ethereum", "Навсегда"],
    done: "готово",
    now: "сейчас",
    todo: "ещё нет",
    localTag: "Локальная замена",
    localWhy: "За этой локальной сетью нет Ethereum. Здесь эти два шага значат: на 1 и на 2 блока позже.",
  },
  disclose: { show: "показать", hide: "скрыть" },
  deal: {
    intro: "Кто-то ищет",
    bare: "Кто-то поднял руку.",
    lost: "Описание не дошло вместе со ссылкой. Спроси у того, кто её прислал.",
    reward: ["Награда ", ""],
    noReward: "Без награды: только спасибо",
    openUntil: (date: string) => `открыта до ${date}`,
    until: (date: string) => `до ${date}`,
    wasOpenUntil: (date: string) => `была открыта до ${date}`,
    ifHelp: "Поможешь, и тебя поблагодарят",
    atLeast: (amount: string) => `минимум ${amount}`,
    ifPass: "Передашь дальше",
    keepShare: "оставь себе долю, сколько решишь",
    passFree: "бесплатно; доли здесь нет",
    ifNobody: (date: string) => `Никого не поблагодарят до ${date}`,
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
    block: "блок",
    networkTime: "Время сети",
    floorWhy: "что остаётся от награды на твоём месте этого пути",
  },
  receipt: {
    caption: "Кто сколько получил — по записям самой сети",
    passed: "передали дальше",
    helped: "помогли",
    back: "вернулось автору",
    total: "вся награда",
    keptNothing: "ничего себе не оставили",
    thanksOnly: "только спасибо",
    notRead: "ещё не прочитано",
  },
  money: {
    invalid: (digits: number) => `Нужно число, после запятой не больше ${digits} знаков.`,
    tooMuch: (max: string) => `Не больше ${max}.`,
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
    connectHint: "Или выбери один из двух способов ниже. Для них он не нужен.",
    address: "Адрес у меня есть",
    addressLabel: "Адрес",
    addressHint: "Вставь любой адрес. Адрес пополнения на бирже тоже подойдёт.",
    oneTime: "Твой ответ подтвердит одноразовый ключ прямо здесь, после этого он выбрасывается.",
    keepKey: "Сохранить ключ этого ответа",
    keepKeyHint: "Небольшой файл. Будущие квитанции принадлежали бы ему.",
    fresh: "У меня нет — сделать",
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
