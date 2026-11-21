import type en from "./en";

// The thank screen's words in Russian: the same keys as en.ts, checked by the type. Speaks as «ты».
const ru: Record<keyof typeof en, string> = {
  "thank.title": "Поблагодарить.",
  "thank.lead": "Когда кто-то может помочь, его ответ приходит сюда. Вставь его — он будет проверен раньше всего остального.",
  "thank.input.label": "Что тебе прислали",
  "thank.input.placeholder": "https://…/#…",
  "thank.input.hint": "Адрес, который заканчивается на #… — из сообщения или из «Моих рук».",
  "thank.open": "Проверить",
  "thank.again": "Проверить другой ответ",
  "thank.checking": "Проверяем этот ответ у контракта…",

  "thank.error.notGive": "Это ссылка самой руки, а не ответ на неё. Открой её с главной страницы.",
  "thank.error.noForwarder":
    "Аккаунт помощника в этой сети ещё не настроен, а этот сайт не умеет настроить его, не действуя от твоего имени. Попроси помощника ответить ещё раз с адреса, которым он уже пользуется.",
  "thank.error.checkFailed": "Контракт не смог это проверить. Ничего не отправлено.",
  "thank.error.notRaiser": "Сказать спасибо может только аккаунт, который поднял эту руку. Подключи его.",
  "thank.error.closed": "Эта рука уже закрыта.",
  "thank.error.thankedOther": "За эту руку уже поблагодарили — за другой ответ.",

  "thank.checked": "Ответ проверен: все, кто передавал, учтены, и помощник его подтвердил.",
  "thank.lens.checked": "checkGive · eth_call · блок {block} · ok",
  "thank.lens.checkedSetup": "checkGive через forwarder, с настройкой аккаунта · блок {block} · ok",
  "thank.lens.giveHash": "giveHash {hash}",
  "thank.lens.firstSeen": "Впервые на этом устройстве {time}",

  "thank.resigned":
    "Этот ответ пришёл более коротким путём, чем тот, что ты уже видел. Из него выпали: {holders}. Поблагодаришь — они ничего не получат.",
  "thank.resigned.tick": "Знаю, что они выпали",
  "thank.resigned.share": "себе {share}",
  "thank.resigned.noShare": "себе ничего",
  "thank.resigned.anyway": "Всё равно поблагодарить за этот путь",
  "thank.resigned.overridden": "Решено: благодарить за этот путь всё равно.",
  "thank.resigned.earlier": "Раньше на этом устройстве: {time}",
  "thank.branch": "На эту руку пришёл ещё один ответ, другим путём. Оба пути честные; за какой благодарить — решаешь ты.",

  "thank.payee.core": "Это адрес самого контракта: деньги, отправленные туда, будут ждать вечно.",
  "thank.payee.raiser": "Одна доля на этом пути придёт на твой же адрес.",
  "thank.key.raiser": "Передача {n} на этом пути отдала ссылку ключу с твоим же адресом.",
  "thank.payee.token": "Одна доля на этом пути придёт на адрес самого токена, а он обычно оставляет полученное себе.",

  "thank.tooLong": "Этот путь слишком длинный, чтобы поблагодарить за один раз.",
  "thank.lens.fit":
    "В худшем случае {gas} gas · {bytes} байт calldata · предел 16 777 216 gas. Худший случай нужен только для проверки, что этот путь помещается в одну транзакцию; отправляется оценка твоего кошелька.",

  "thank.setup": "Аккаунт помощника в этой сети ещё не настроен. Твоё спасибо сначала настроит его.",
  "thank.twoSteps":
    "Два шага: первый настраивает аккаунт помощника, второй говорит спасибо. Остановишься после первого — потратишь только его стоимость.",
  "thank.lens.factory": "Фабрика {factory}",
  "thank.lens.setupRuns": "Настройка идёт через {forwarder} · не от твоего имени",

  "thank.predicted.title": "Кто сколько получит",
  "thank.predicted.note": "Посчитано здесь — по тому, кто передавал, и по награде, которая есть сейчас.",
  "thank.predicted.passed": "Передали дальше",
  "thank.predicted.helper": "Помогли",
  "thank.predicted.formula": "как считается",
  "thank.predicted.total": "Вся награда",
  "thank.predicted.waitsIfBlocked":
    "Если выплата не может пройти, она хранится, пока её не заберёт тот, кому она причитается, или пока кто-нибудь не доставит её ему.",
  "thank.noReward": "У этой руки нет награды, так что спасибо не переводит денег. Оно закрывает руку и записывает, кто помог.",
  "thank.lens.shakeFormula": "{reward} × {bps} ÷ 10 000 = {amount}",
  "thank.lens.giveFormula": "{reward} − {paid} = {amount} · claim {bps} bps",

  "thank.warning": "Спасибо — и помощник, и все, кто передавал, получат свою долю. Отменить нельзя.",
  "thank.warning.noReward": "Спасибо закроет эту руку навсегда. Отменить нельзя.",
  "thank.swipe": "Сказать спасибо",
  "thank.connect": "Чтобы сказать спасибо, подключи аккаунт, который поднял эту руку.",
  "thank.costRefused": "Сейчас контракт это не примет:",
  "thank.costChecking": "Считаем, сколько это стоит…",
  "thank.step": "Шаг {step} из {of}",
  "thank.step.setup": "Настраиваем аккаунт помощника",
  "thank.step.thanks": "Отправляем спасибо",
  "thank.step.waiting": "Ждём сеть…",

  "thank.done": "Спасибо сказано. Все выплаты — прямо из сети.",
  "thank.done.before": "За эту руку уже поблагодарили — за этот ответ. Все выплаты — прямо из сети.",
  "thank.left": "{amount} ушло из контракта на {payee}",
  "thank.waiting": "{amount} ждёт {payee}",
  "thank.done.calm": "Спасибо сказано. Вот все выплаты.",
  "thank.done.before.calm": "За эту руку уже поблагодарили — за этот ответ. Вот все выплаты.",
  "thank.waiting.calm": "{amount} хранится, пока его не заберёт тот, кому оно причитается.",
  "thank.waiting.why":
    "Выплата не смогла пройти, поэтому она ждёт в контракте. Тот, кому она причитается, может её забрать, или кто угодно может её доставить.",
  "thank.noMoney": "Денег не двигалось: у этой руки не было награды.",
  "thank.lens.events": "Что записала сеть",
  "thank.lens.event": "{event} · блок {block} · лог {index}",

  "thank.spent": "Спасибо стоило около ${usd} · цены на {date}",
  "thank.spent.steps": "Оба шага вместе стоили около ${usd} · цены на {date}",
  "thank.spent.calm": "Спасибо стоило около ${usd}",
  "thank.spent.steps.calm": "Оба шага вместе стоили около ${usd}",
  "thank.spent.reading": "Читаем из сети, сколько это стоило…",
  "thank.spent.unread": "Сейчас не удалось прочитать из сети, сколько это стоило.",
  "thank.lens.tx": "Транзакция",
  "thank.lens.tx.hash": "tx {hash}",
  "thank.lens.tx.from": "от {from}",
  "thank.lens.tx.block": "блок {block} · {time}",
  "thank.lens.tx.blockOnly": "блок {block}",
  "thank.lens.tx.gas": "потрачено gas {gas} · фактическая цена {gwei} gwei",
  "thank.lens.tx.l1": "плата L1 за данные {eth} ETH",
  "thank.lens.tx.fee": "плата {eth} ETH · ${usd} при ETH ${ethUsd} · цены на {date}",
  "thank.lens.tx.local": "Локальная тестовая сеть: тестовый ETH по собственной цене этой сети",
  "thank.proof": "Посмотреть доказательство",
  "thank.withoutUs": "Сделать без нас",
  "thank.withoutUs.lead": "Тот же вызов — для терминала с cast из Foundry. Добавь, чем подтверждаешь: --ledger, --account или --private-key.",
  "thank.withoutUs.page": "Все способы обойтись без этого сайта",
  "thank.notConfirmed": "Сеть это приняла, но в её записи нет всех выплат, которые обещал этот путь. Посмотри доказательство, прежде чем доверять.",

  "thank.reverted": "Сеть это отклонила.",
  "thank.reverted.kept": "Награда осталась в контракте; потрачена только стоимость попытки.",
  "thank.firstStepOnly": "Аккаунт помощника настроен; спасибо не прошло. Потрачена только стоимость первого шага.",
  "thank.resumed": "С этого устройства уже отправлено спасибо за этот ответ. Следим за ним…",
  "thank.onWay": "С этого устройства уже отправлено спасибо, оно в пути: рука {id}. Второй раз ничего не отправится.",
  "thank.onWay.done": "Это спасибо прошло: рука {id}.",
  "thank.onWay.open": "Посмотреть, кому сколько отправлено",
};

export default ru;
