import type en from "./en";

// The raise screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "raise.title": "Поднять руку.",
};

export default ru;
