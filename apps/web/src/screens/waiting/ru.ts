import type en from "./en";

// The waiting screen's words in Russian: the same keys as en.ts, checked by the type.
// «В безопасности» stands only in waiting.safe.
const ru: Record<keyof typeof en, string> = {
  "waiting.title": "Деньги, которые ждут адресата.",
  "waiting.intro": "Если деньги не смогли дойти до адреса, когда руку поблагодарили или вернули, они хранятся, пока это не станет возможно. Отсюда их можно забрать или доставить.",

  "waiting.look.label": "Чьи деньги? Вставь любой адрес, чтобы посмотреть",
  "waiting.look.go": "Посмотреть",
  "waiting.look.readOnly": "Посмотреть — значит только прочитать. Ничего не отправляется.",
  "waiting.look.bad": "Это ещё не целый адрес: 0x и сорок знаков.",
  "waiting.look.mine": "Показать мои",
  "waiting.start": "Вставь любой адрес или нажми «Подключить кошелёк» — и увидишь, что для него ждёт.",
  "waiting.start.logIn": "Вставь любой адрес или нажми «Войти» — и увидишь, что для него ждёт.",
  "waiting.for": "Для этого адреса",

  "waiting.heading": "Ждёт этот адрес",
  "waiting.reading": "Читаем контракт…",
  "waiting.nothing": "Для этого адреса ничего не ждёт.",
  "waiting.offline": "Сеть сейчас недоступна. Ничего не отправлено, деньги там же, где были.",

  "waiting.takeOut": "Забрать",
  "waiting.takeOut.where": "Куда придут деньги",
  "waiting.takeOut.here": "На этот адрес",
  "waiting.takeOut.elsewhere": "На другой адрес",
  "waiting.takeOut.toLabel": "Вставь адрес, куда они должны прийти",
  "waiting.takeOut.only": "Отправить эти деньги в другое место может только сам этот адрес.",
  "waiting.deliver": "Доставить",
  "waiting.deliver.note": "Кто бы ни нажал, деньги придут только на этот адрес.",
  "waiting.deliver.visitor": "Доставить может кто угодно. Сначала попросим «Подключить кошелёк»; кто бы ни нажал, деньги придут только на этот адрес.",
  "waiting.deliver.visitorLogIn": "Доставить может кто угодно. Сначала попросим «Войти»; кто бы ни нажал, деньги придут только на этот адрес.",
  "waiting.cost.checking": "Считаем, сколько это стоит…",

  "waiting.safe": "Эти деньги в безопасности там, где лежат. Нажать «Доставить» может кто угодно — деньги придут только на этот адрес.",
  "waiting.friend": "Отправь эту страницу любому, кто сможет нажать «Доставить»:",

  "waiting.stuck": "Токен сейчас не переводит эти деньги на этот адрес.",
  "waiting.kept": "Деньги так и ждут; ничего не потеряно.",
  "waiting.stuck.said": "Что ответил токен",
  "waiting.issuer": "Почему токен может отказать? Его эмитент может заморозить адрес, и тогда деньги ждут.",
  "waiting.failed": "Не получилось.",

  "waiting.done": "Отправлено: {amount} пришло на адрес ниже.",
  "waiting.done.to": "Пришли на",

  "waiting.withoutUs": "Сделать без нас",
  "waiting.withoutUs.body": "То же самое из терминала, без сайта. Запустить может кто угодно; поменять, куда придут деньги, — только адрес, для которого они ждут.",
  "waiting.withoutUs.more": "Все способы без нас",

  "waiting.events.heading": "Из рук, которые знает это устройство",
  "waiting.events.reading": "Читаем, что оставили эти руки…",
  "waiting.events.noHands": "Это устройство пока не знает ни одной руки. Суммы выше прочитаны прямо из открытой записи.",
  "waiting.events.none": "Ни одна рука, которую знает это устройство, не оставила денег для этого адреса.",
  "waiting.events.hand": "Рука {hand}",
  "waiting.events.waited": "Стало ждать здесь: {amount}",
  "waiting.events.took": "Забрано: {amount}",

  "waiting.lens.perToken": "Ждущие деньги считаются по токену и адресу, а не по руке: pending(token, payee).",
  "waiting.lens.view": "pending({token}, {payee}) = {amount} · блок {block}",
  "waiting.lens.bounded": "Логи Pending читаются только в блоке, где рука закрылась, по её handId. У Withdrawn нет handId, поэтому он показан для того, что забрали здесь.",
  "waiting.lens.pending": "Pending · блок {block} · лог {index} · tx {tx}",
  "waiting.lens.withdrawn": "Withdrawn · блок {block} · лог {index} · tx {tx}",
  "waiting.lens.calldata": "calldata",
};

export default ru;
