import type en from "./en";

// The dev-wallet screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "dev-wallet.title": "Тестовые аккаунты.",
};

export default ru;
