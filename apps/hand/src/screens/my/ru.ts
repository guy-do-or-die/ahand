import type en from "./en";

// The my screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "my.title": "Мои руки.",
};

export default ru;
