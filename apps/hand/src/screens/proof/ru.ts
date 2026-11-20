import type en from "./en";

// The proof screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "proof.title": "Паспорт.",
};

export default ru;
