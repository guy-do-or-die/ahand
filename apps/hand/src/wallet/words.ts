import { useLang, type Lang } from "../ui/ambient";

/**
 * The wallet layer's own words, in English and Russian, kept like the kit's (`ui/words.ts`): RU is
 * typed by EN, so a sentence missing in one language does not compile, and words.test.ts checks
 * the banned words of UX-SPEC §5 on the human layer. "Wallet" appears only in "Connect a wallet".
 * `dev` is the local-only test accounts' section: a specialist's layer that names what it is.
 */

const EN = {
  title: "Connect a wallet",
  /** The same control's name where Privy is the way in: someone with no crypto app would not press "Connect a wallet". */
  logIn: "Log in",
  found: "Found in this browser",
  none: "Nothing to connect was found in this browser. On a computer, add a crypto app's browser extension, then reload this page. On a phone, open this page in the browser inside your crypto app (MetaMask, Rabby, Trust and others have one).",
  browser: "The crypto app in this browser",
  selfNamed: "Each name and icon comes from the app itself; this site can't check them.",
  waiting: (name: string) => `Waiting for your answer in ${name}…`,
  refused: "You said no. Nothing was connected.",
  failed: "Couldn't connect. Nothing was sent.",
  connected: "Connected",
  disconnect: "Disconnect",
  another: "Use another account",
  otherNetwork: (network: string) => `This account is on another network. Switch it to ${network} to go on.`,
  step: (n: number, of: number) => `Step ${n} of ${of}`,
  /** Logging in through Privy's one window (a build whose configuration has `privy`). */
  privy: {
    opening: "Opening log in…",
    unavailable: "Logging in can't be reached right now. You can still connect a crypto app from this browser.",
    loggedIn: "Logged in",
    logOut: "Log out",
    failed: "Logging in didn't finish. Nothing was sent.",
    retry: "Try again",
    close: "Close",
    /** Back from Google, Apple or X: the page was loaded afresh, and an opened link lives only in a tab's memory (D-39). */
    linkAgain: "You're logged in. Logging in with a social account reloads the page, and a link lives only in this tab's memory, so open the one you were sent once more.",
  },
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
  logIn: "Войти",
  found: "Найдено в этом браузере",
  none: "В этом браузере нечего подключить. На компьютере добавь расширение криптоприложения для браузера и перезагрузи страницу. На телефоне открой эту страницу в браузере внутри своего криптоприложения (он есть в MetaMask, Rabby, Trust и других).",
  browser: "Криптоприложение в этом браузере",
  selfNamed: "Название и значок каждое приложение задаёт само; этот сайт их не проверяет.",
  waiting: (name) => `Ждём твоего ответа в ${name}…`,
  refused: "Ты отказался. Ничего не подключено.",
  failed: "Не получилось подключиться. Ничего не отправлено.",
  connected: "Подключено",
  disconnect: "Отключить",
  another: "Сменить аккаунт",
  otherNetwork: (network) => `Этот аккаунт в другой сети. Переключи его на «${network}», чтобы продолжить.`,
  step: (n, of) => `Шаг ${n} из ${of}`,
  privy: {
    opening: "Открываем вход…",
    unavailable: "Вход сейчас недоступен. Можно подключить криптоприложение из этого браузера.",
    loggedIn: "Вход выполнен",
    logOut: "Выйти",
    failed: "Вход не завершился. Ничего не отправлено.",
    retry: "Попробовать снова",
    close: "Закрыть",
    linkAgain: "Вход выполнен. Вход через соцсеть перезагружает страницу, а ссылка живёт только в памяти этой вкладки, поэтому открой присланную ссылку ещё раз.",
  },
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
