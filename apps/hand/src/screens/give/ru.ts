import type en from "./en";

// The give screen's words in Russian: the same keys as en.ts, checked by the type. Speaks as «ты».
const ru: Record<keyof typeof en, string> = {
  "give.title": "Могу помочь.",
  "give.opening": "Проверяем ссылку…",
  "give.noLink": "В этой вкладке не открыта ссылка. Открой ту, что тебе прислали.",
  "give.notLive": "Ответить можно только на присланную ссылку: эта — чей-то ответ или уже законченный путь.",
  "give.closed": "На эту руку уже нельзя ответить.",

  "give.step.words": "1 · Чем поможешь",
  "give.step.land": "2 · Куда придут деньги",
  "give.step.agree": "3 · Прежде чем согласиться",

  "give.words.ask": "Напиши, чем поможешь. Если поблагодарят — тебе минимум {amount}.",
  "give.words.askNoReward": "Напиши, чем поможешь. У этой руки нет награды: только спасибо.",
  "give.words.placeholder": "Например: знаю такую квартиру и хозяйку, могу познакомить на этой неделе.",
  "give.words.meta": "Твои слова уйдут автору сообщением, а не в сеть.",
  "give.words.count": "{n} из {max} знаков",
  "give.land.noReward": "Сейчас награды нет. Если автор добавит её до спасибо, она придёт сюда.",

  "give.agree.intro": "Ровно это и говорит твой ответ. Больше с ним ничего не уходит. Благодарить или нет — решает автор.",
  "give.agree.network": "Сеть",
  "give.agree.contract": "Контракт",
  "give.agree.hand": "Рука",
  "give.agree.handNumber": "номер {n}",
  "give.agree.claim": "Твоя часть",
  "give.agree.claimMoney": "{percent} награды — сегодня это {amount}",
  "give.agree.claimNoReward": "{percent} награды — сейчас награды нет",
  "give.agree.lands": "Куда придут деньги",
  "give.agree.confirms": "Кто подтверждает",
  "give.agree.byAccount": "Этот аккаунт, на своём экране, с теми же числами",
  "give.agree.byOneTime": "Одноразовый ключ, здесь; потом он стирается",
  "give.agree.byWords": "Адрес из твоих двенадцати слов, здесь",
  "give.agree.flagged.raiser": "Это адрес самого автора. Деньги вернулись бы ему.",
  "give.agree.flagged.token": "Это адрес самого токена. Деньги, отправленные туда, обычно пропадают.",
  "give.agree.pick": "Сначала выбери, куда придут деньги.",

  "give.swipe": "Отправить помощь",
  "give.swipe.busy": "Проверяем…",

  "give.check.confirm": "Подтверждаем твой ответ",
  "give.check.here": "Проверяем здесь, в порядке Core",
  "give.check.core": "Спрашиваем сам контракт",
  "give.check.write": "Записываем твой ответ",
  "give.check.deliver": "Отправляем автору",

  "give.setup": "Твой аккаунт в этой сети ещё не настроен. Это не страшно: его настроит спасибо автора.",
  "give.noForwarder":
    "Твой аккаунт в этой сети ещё не настроен, и этот сайт не умеет настроить его за тебя. Выбери «Адрес у меня есть» и вставь адрес аккаунта: деньги придут туда же.",
  "give.noForwarder.go": "Выбрать «Адрес у меня есть»",

  "give.error.refused": "Ты отказался. Ничего не отправлено.",
  "give.error.failed": "Твой ответ не удалось подтвердить. Ничего не отправлено.",
  "give.error.kept": "Твои слова остались здесь.",

  "give.done.title": "Твой ответ готов.",
  "give.done.checked": "Проверено здесь и самим контрактом.",
  "give.delivered.one": "Доставлено на {acks} из 1 реле.",
  "give.delivered.many": "Доставлено на {acks} из {of} реле.",
  "give.delivering": "Отправляем автору…",
  "give.relay.what": "Что такое реле?",
  "give.relay.body":
    "Реле — небольшой сервер, который держит запечатанные сообщения, пока устройство автора их не заберёт. Он видит, что сообщение пришло, но не видит, что в нём. Если ни одно реле недоступно, ссылку ниже можно отправить любым другим путём.",
  "give.fallback":
    "Напрямую достучаться не вышло. Отправь это тому, кто прислал тебе ссылку: каждый знает предыдущего.",
  "give.retrying": "Пока страница открыта, это устройство пробует снова.",
  "give.retry": "Попробовать сейчас",
  "give.answer.label": "Твой ответ — ссылкой",
  "give.answer.copyHint": "Копируй как есть: адрес стоит на отдельной строке.",
  "give.keyFile": "Файл с ключом сохранён. Держи его вместе с другими ключами: будущие квитанции принадлежали бы ему.",

  "give.thread.title": "Сообщения",
  "give.thread.empty": "Здесь появятся ответы автора.",
  "give.thread.asker": "Автор",
  "give.thread.you": "Ты",
  "give.thread.yourWords": "Твои слова, вместе с ответом",
  "give.thread.queued": "ждёт доставки",
  "give.thread.reply": "Написать автору",
  "give.thread.send": "Отправить",
  "give.thread.noInbox": "Эта рука не говорит, куда писать, поэтому сообщений здесь не будет. Твой ответ уходит ссылкой выше.",
  "give.waiting": "Если тебя поблагодарят, деньги придут на {payee}.",
  "give.waiting.go": "Посмотреть, что ждёт этот адрес",

  "give.lens.heading": "Что проверено",
  "give.lens.offline": "checkGive · посчитано здесь · в порядке Core · OK",
  "give.lens.core": "checkGive · eth_call · блок {block} · OK",
  "give.lens.coreSetup": "aggregate3 [setup, checkGive] · eth_call через forwarder {forwarder} · блок {block} · OK",
  "give.lens.giveHash": "giveHash {hash}",
  "give.lens.dataHash": "Give.dataHash 0x0 · слов в нём нет",
  "give.lens.keySig": "keySig · ключ ссылки {key}",
  "give.lens.sigKey": "giverSig · 65 байт · от ключа",
  "give.lens.sigWrapped": "giverSig · ERC-6492 · {bytes} байт · factory {factory}",
  "give.lens.sigCode": "giverSig · ERC-1271 · {bytes} байт · самого аккаунта",
  "give.lens.signer": "Give.signer {address}",
  "give.lens.payee": "Give.payee {address}",
  "give.lens.claim": "Give.claimBps {bps} · routeHash {hash}",
  "give.lens.delivery": "NIP-17 gift wrap · kind 1059 · на inbox.n1 {inbox}",
  "give.lens.noInbox": "в описании руки нет inbox.n1",
};

export default ru;
