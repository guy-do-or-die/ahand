import { useLang, type Lang } from "../ui/ambient";

/**
 * The wallet layer's own words, in English and Russian, kept like the kit's (`ui/words.ts`): RU is
 * typed by EN, so a sentence missing in one language does not compile, and words.test.ts checks
 * the banned words of UX-SPEC §5 on the human layer. "Wallet" appears only in "Connect a wallet".
 * `dev` is the local-only test accounts' section: a specialist's layer that names what it is.
 */

const EN = {
  title: "Connect a wallet",
  found: "Found in this browser",
  none: "Nothing to connect was found in this browser. Add a crypto app's browser extension, then reload this page.",
  selfNamed: "Each name and icon comes from the app itself; this site can't check them.",
  waiting: (name: string) => `Waiting for your answer in ${name}…`,
  refused: "You said no. Nothing was connected.",
  failed: "Couldn't connect. Nothing was sent.",
  connected: "Connected",
  disconnect: "Disconnect",
  otherNetwork: (network: string) => `This account is on another network. Switch it to ${network} to go on.`,
  step: (n: number, of: number) => `Step ${n} of ${of}`,
  dev: {
    heading: "Test accounts · this local network only",
    account: (n: number) => `Test account ${n}`,
    unset: "Not set up yet",
    entropyTag: "Answers differently each time",
    unsetTag: "Can't send",
    wrappedTag: "Answers wrapped · ERC-6492",
    unsetKey: "Its key is test account 6's",
  },
};

export type WalletWords = typeof EN;

const RU: WalletWords = {
  title: "Подключить кошелёк",
  found: "Найдено в этом браузере",
  none: "В этом браузере нечего подключить. Добавь расширение криптоприложения для браузера и перезагрузи страницу.",
  selfNamed: "Название и значок каждое приложение задаёт само; этот сайт их не проверяет.",
  waiting: (name) => `Ждём твоего ответа в ${name}…`,
  refused: "Ты отказался. Ничего не подключено.",
  failed: "Не получилось подключиться. Ничего не отправлено.",
  connected: "Подключено",
  disconnect: "Отключить",
  otherNetwork: (network) => `Этот аккаунт в другой сети. Переключи его на «${network}», чтобы продолжить.`,
  step: (n, of) => `Шаг ${n} из ${of}`,
  dev: {
    heading: "Тестовые аккаунты · только эта локальная сеть",
    account: (n) => `Тестовый аккаунт ${n}`,
    unset: "Ещё не настроен",
    entropyTag: "Каждый раз отвечает по-разному",
    unsetTag: "Не может отправлять",
    wrappedTag: "Ответы в обёртке · ERC-6492",
    unsetKey: "Его ключ — ключ тестового аккаунта 6",
  },
};

export const WALLET_WORDS: Record<Lang, WalletWords> = { en: EN, ru: RU };

export function useWalletWords(): WalletWords {
  return WALLET_WORDS[useLang()];
}
