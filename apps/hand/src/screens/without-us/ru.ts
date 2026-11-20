import type en from "./en";

// The without-us screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "without-us.title": "Сделать без нас.",
};

export default ru;
