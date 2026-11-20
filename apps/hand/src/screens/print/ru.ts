import type en from "./en";

// The print screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "print.title": "Печать.",
  "print.kicker": "На бумаге",
  "print.lead": "Карточка на стену или бирка на посылку. В коде вся ссылка: кто отсканирует, сможет передать её дальше.",
  "print.none": "Сначала открой ссылку: вставь её сюда или приходи со страницы руки.",
  "print.paste.label": "Твоя ссылка",
  "print.paste.open": "Открыть",
  "print.paste.memory": "Ссылка остаётся только в этой вкладке. После перезагрузки её не будет.",
  "print.notLive": "Эту не напечатать: на бумагу идёт только ссылка, которую ещё можно передать дальше.",
  "print.checking": "Проверяем ссылку…",

  "print.format": "Размер",
  "print.format.tag": "Бирка · 85 × 55 мм",
  "print.format.card": "Карточка · A6",
  "print.tooDense": "Слишком плотно для маленькой печати. Покажи с экрана.",
  "print.onScreen": "С экрана",
  "print.go": "Напечатать",
  "print.inkOnly": "Печатается чёрным по белому, какая бы ни была тема.",
  "print.card.scan": "Отсканируй и посмотри, как помочь. Передать дальше — бесплатно.",
  "print.tag.found": "Нашёл? Отсканируй.",
  "print.tag.free": "Передать дальше — бесплатно.",
  "print.secret": "У кого эта бумага, у того и ссылка. Вешай её только там, где выложил бы саму ссылку.",
  "print.how": "Как выбран размер",
  "print.lens.code": "QR v{version} · {modules}×{modules} · L · {digits} digits · {shakes} passes",
  "print.lens.rule": "module ≥ 31 mm / 77 = {min} mm (v13 on the tag) · 3 dots at {dpi} dpi",
  "print.lens.tag": "tag: 31 mm / ({modules} + 8) = {mm} mm",
  "print.lens.card": "card: 50 mm / ({modules} + 8) = {mm} mm",

  "print.receipt.title": "Квитанция.",
  "print.receipt.lead": "Кто сколько получил — по записям самой сети. Код ведёт к паспорту руки.",
  "print.receipt.open": "Эта рука ещё открыта: квитанции пока нет.",
  "print.receipt.scan": "Отсканируй, чтобы проверить всё заново.",
  "print.receipt.verify": "Проверить без всякого сайта, из копии кода:",
  "print.receipt.unknown": "Эта рука в сети, которую этот сайт не читает. Ничего не открыто.",
};

export default ru;
