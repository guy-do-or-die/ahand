import type en from "./en";

// The without-us screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "without-us.title": "Сделать без нас.",
  "without-us.lead": "У контракта нет владельца и нет выключателя. Если этого сайта не станет, деньги всё равно можно двигать: поблагодарить, вернуть, забрать. Три пути, и ни один не наш.",
  "without-us.core": "Контракт",
  "without-us.chain": "Сеть {chain} · {name}",
  "without-us.file.title": "1 · Эта страница одним файлом",
  "without-us.file.body": "exit.html делает те же три вещи одним файлом: поблагодарить по ответу помощника, вернуть, забрать ждущие деньги. Ещё он показывает состояние руки. Сохрани его сейчас. Он работает, открытый с диска, с любым адресом сети, который ты введёшь; чтобы подтверждать из расширения браузера, открой его через любой локальный веб-сервер.",
  "without-us.file.download": "Сохранить exit.html",
  "without-us.file.size": "Один файл, больше ничего загружать не нужно.",
  "without-us.command.title": "2 · Одна команда",
  "without-us.command.body": "Из копии кода, с cast из Foundry. Всё после -- говорит cast, каким ключом подтверждать.",
  "without-us.command.thank": "Calldata для thank собирается из ответа, который прислал помощник:",
  "without-us.explorer.title": "3 · Обозреватель блоков, поле за полем",
  "without-us.explorer.body": "Открой контракт в обозревателе блоков сети, вкладка Contract → Write Contract, нажми «Подключить кошелёк» и заполни одну форму. Сначала прочитай hands(handId): сравнивай expiry со временем последнего блока, а не со своими часами.",
  "without-us.explorer.refund": "Вернуть. Может кто угодно, с той секунды, когда наступил expiry.",
  "without-us.explorer.withdraw": "Ждущие деньги. Доставить их на payee может кто угодно; отправить в другое место — только сам payee.",
  "without-us.explorer.thank": "Поблагодарить. Только автор и только до expiry. Значения даёт exit.html или команда выше.",
  "without-us.explorer.handId": "номер руки",
  "without-us.explorer.token": "токен, в котором они ждут",
  "without-us.explorer.payee": "адрес, для которого они ждут",
  "without-us.explorer.to": "куда отправить: на сам payee",
  "without-us.explorer.shakes": "путь, по записи на каждую передачу",
  "without-us.explorer.give": "ответ помощника",
  "without-us.explorer.dataHash": "0x000…000, если нечего сказать",
};

export default ru;
