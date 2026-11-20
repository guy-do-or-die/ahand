import type en from "./en";

// The waiting screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "waiting.title": "Ждёт тебя.",
};

export default ru;
