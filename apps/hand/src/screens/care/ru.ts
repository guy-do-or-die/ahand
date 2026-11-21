import type en from "./en";

// The care screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "care.title": "Позаботиться о руке.",
  "care.kicker": "Рука {id}",
  "care.kicker.calm": "Твоя рука",
  "care.words": "Текст руки передаётся только внутри ссылки. Эта страница читает то, что хранит сеть.",
  "care.words.device": "Твои слова, как их хранит это устройство. Они совпадают с тем, что хранит контракт.",
  "care.words.deviceUnchecked": "Твои слова, как их хранит это устройство. Их проверят, когда ты откроешь доступ.",
  "care.words.deviceMismatch": "Слова, хранящиеся здесь, не совпадают с тем, что хранит контракт, поэтому карточка показывает только то, что хранит сеть.",
  "care.back": "Назад к этой руке",
  "care.who": "Добавить к награде или продлить руку может только аккаунт, который её поднял. Напоминание может сделать кто угодно.",
  "care.untrusted": "Эта страница называет сеть, которую этот сайт не читает. Ничего не открыто.",
  "care.loading": "Читаем руку из сети…",

  "care.fund.title": "Добавить к награде",
  "care.fund.stays": "Все уже разосланные ссылки остаются в силе.",
  "care.fund.amount": "Сколько добавить?",
  "care.fund.balance": "У тебя {amount}.",
  "care.fund.twoSteps": "Два шага: сначала разреши контракту взять {amount}, потом добавь.",
  "care.fund.oneStep": "Один шаг: контракту уже разрешено взять столько.",
  "care.fund.swipe": "Добавить {amount}",
  "care.fund.swipeEmpty": "Добавить к награде",
  "care.fund.done": "Добавлено. Теперь награда {amount}.",

  "care.extend.title": "Продлить",
  "care.extend.chips": "На сколько продлить",
  "care.extend.plus": "+{n} дн.",
  "care.extend.max": "до {n} дней с сегодняшнего дня",
  "care.extend.until": "Открыта до {date}.",
  "care.extend.capped": "Сокращено до самого долгого срока, который позволяет контракт.",
  "care.extend.off": "Этот вариант не отодвинет конец.",
  "care.extend.later": "Срок можно только отодвинуть, и только пока рука открыта.",
  "care.extend.lastMinutes": "Можно не успеть. В последнюю секунду не пройдут ни продление, ни спасибо.",
  "care.extend.lastMinutesWhose": "Это предупреждение самого приложения, а не правило контракта.",
  "care.extend.swipe": "Оставить открытой до {date}",
  "care.extend.swipeEmpty": "Продлить",
  "care.extend.done": "Готово. Открыта до {date}.",
  "care.extend.how": "Как считается эта дата",
  "care.extend.lens.now": "now = блок {block} · {timestamp} · MAX_EXPIRY_PERIOD {cap} s",
  "care.extend.lens.formula": "extend(handId, min({from} + {days} d, now + cap − 600)) = {target}",
  "care.extend.lens.max": "extend(handId, now + cap − 600) = {target}",

  "care.reminder.title": "Напоминание",
  "care.reminder.button": "Скачать напоминание",
  "care.reminder.when": "{n, plural, one {Календарь напомнит за # день до закрытия.} few {Календарь напомнит за # дня до закрытия.} many {Календарь напомнит за # дней до закрытия.} other {Календарь напомнит за # дня до закрытия.}}",
  "care.reminder.local": "Файл создаётся прямо на этой странице. Ничего никуда не уходит.",
  "care.reminder.summary": "Рука {id} закрывается",
  "care.reminder.description": "Открыта до {date}. Продлить или добавить к награде: {url}",
  "care.reminder.alarm": "Рука {id} закроется через {n, plural, one {# день} few {# дня} many {# дней} other {# дня}}.",

  "care.steps.why": "Сначала пробуем: если контракт откажет, ты увидишь почему, ещё до отправки.",
  "care.lens.calls": "Сделать без нас",
  "care.lens.callsLead": "Тот же вызов из терминала, с любым ключом на твой выбор:",
};

export default ru;
