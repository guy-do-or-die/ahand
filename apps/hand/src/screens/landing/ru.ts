import type en from "./en";

// The landing screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "landing.title": "Подними руку. Дальше — твои люди.",
};

export default ru;
