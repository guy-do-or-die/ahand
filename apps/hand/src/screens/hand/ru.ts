import type en from "./en";

// The hand screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "hand.title": "Рука.",
};

export default ru;
