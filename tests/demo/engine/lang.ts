/**
 * The show's language (DEMO_LANG=ru): every persona's browser opens the app in Russian (its
 * locale, which the app follows: i18n/catalogue.ts deviceLang), the checks read the app's Russian
 * dictionaries (words.ts), and the captions, names and the director's own words are Russian. A
 * step's own caption is English; `captionRu` gives its Russian, else the verb's Russian caption
 * stands in for it.
 */
import type { Action, Scenario, Step } from "./scenario";

export type Lang = "en" | "ru";

export const LANG: Lang = process.env.DEMO_LANG === "ru" ? "ru" : "en";

/** The browser locale that makes the app open in LANG. */
export const LOCALE = LANG === "ru" ? "ru-RU" : "en-US";

const NAMES: Record<string, string> = {
  Nina: "Нина", Alex: "Алекс", Gina: "Гина", Vic: "Вик", Bea: "Беа", Bob: "Боб", Cem: "Джем", Dana: "Дана", Emil: "Эмиль",
  Fay: "Фэй", Gus: "Гас", Hana: "Хана", Alice: "Алиса", Board: "Доска", Finder: "Нашедший", Max: "Макс", Sam: "Сэм",
};

/** A persona's name in the show's language. */
export function nameIn(name: string, lang: Lang = LANG): string {
  return lang === "ru" ? (NAMES[name] ?? name) : name;
}

const ROLES: Record<string, string> = { asker: "автор", holder: "держатель", helper: "помощник", visitor: "гость" };

/** A persona's role in the show's language. */
export function roleIn(role: string, lang: Lang = LANG): string {
  return lang === "ru" ? (ROLES[role] ?? role) : role;
}

/** The director's own words. */
export const DIRECTOR_WORDS = {
  en: { checks: "Checks on the chain", done: "✓ everything above is on the chain", paused: "paused", playing: "playing", finished: "finished", pause: "Pause", step: "Step", play: "Play" },
  ru: { checks: "Проверки в сети", done: "✓ всё это записано в сети", paused: "пауза", playing: "идёт", finished: "конец", pause: "Пауза", step: "Шаг", play: "Дальше" },
}[LANG];

/** The scenario's title and story in the show's language. */
export function titleOf(s: Scenario): { title: string; story: string } {
  return LANG === "ru" ? { title: s.titleRu ?? s.title, story: s.storyRu ?? s.story } : { title: s.title, story: s.story };
}

/** A step's caption in the show's language. */
export function captionIn(step: Step, name: string | undefined, english: (action: Action, name: string | undefined) => string): string {
  if (LANG === "en") return step.caption ?? english(step, name);
  return step.captionRu ?? captionRu(step, name === undefined ? undefined : nameIn(name));
}

const ru = (dollars: string) => `${dollars} тест. долл.`;

export function captionRu(action: Action, name: string | undefined): string {
  switch (action.do) {
    case "raise":
      return `${name} поднимает руку: «${action.titleRu ?? action.title}», ${ru(typeof action.reward === "string" ? action.reward : action.reward.custom)}`;
    case "raise-sdk":
      return `${name} поднимает руку через SDK: «${action.title}», ${ru(action.reward)}`;
    case "open":
      return `${name} открывает ссылку`;
    case "pass":
      return action.keepBps ? `${name} передаёт дальше и оставляет себе ${action.keepBps / 100}%` : `${name} передаёт дальше и ничего себе не оставляет`;
    case "give":
      return `${name} может помочь и отвечает`;
    case "read-answers":
      return `${name} открывает «Мои руки» на том же устройстве и читает ответ`;
    case "reply":
      return `${name} отвечает: «${action.words}»`;
    case "thank":
      return `${name} благодарит за ответ: одна транзакция платит всем`;
    case "send-back":
      return `${name} возвращает награду автору`;
    case "deliver":
      return `${name}, посторонний человек, доставляет деньги, которые ждут ${action.for.replace(/^@/, "")}`;
    case "look":
      return `${name} смотрит`;
    case "review-thank":
      return `${name} вставляет ответ на странице благодарности и смотрит, что он заплатит`;
    case "pass-sdk":
      return action.until === "full" ? "Ссылку передают, пока путь не заполнится" : `Ссылку передают ещё ${action.times ?? 1} раз(а)`;
    case "give-sdk":
      return "Отвечает помощник, чей смарт-аккаунт ещё не развёрнут";
    case "seed":
      return "Стенд готовит руку с двумя ответами: по пути и по укороченному пути, где одного держателя пропустили";
    case "fund":
      return `${name} добавляет к награде ${ru(action.amount)}`;
    case "extend":
      return action.by === "max" ? `${name} продлевает руку на сколько можно` : `${name} продлевает руку на ${action.by} дней`;
    case "take-out":
      return `${name} забирает ожидающие деньги на другой адрес`;
    case "goto":
      return `${name} открывает ${action.path}`;
    case "reload":
      return `${name} перезагружает страницу`;
    case "connect":
      return `${name} подключает кошелёк`;
    case "network":
      return action.on ? `У ${name} снова есть сеть` : `${name} теряет сеть`;
    case "device-code":
      return `${name} смотрит код этого устройства в «Моих руках»`;
    case "rebuild":
      return `${name} на другом устройстве восстанавливает ссылку по коду`;
    case "check-link":
      return `${name} проверяет ссылку на странице проверки`;
    case "print":
      return `${name} печатает ссылку`;
    case "exit-thank":
      return `${name} благодарит со страницы выхода, открытой как файл: сайт не нужен`;
    case "clock":
      return `Часы сети уходят вперёд на ${action.days} дн.`;
    case "block":
      return action.blocked ? `Токен блокирует ${action.address.replace(/^@/, "")}` : `Токен снимает блокировку с ${action.address.replace(/^@/, "")}`;
    case "service":
      return `${action.service === "relay" ? "Ретранслятор" : "Сайт"} ${action.on ? "снова работает" : "выключается"}`;
    case "say":
      return "";
  }
}
