import type en from "./en";

// The care screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "care.title": "Позаботиться о руке.",
};

export default ru;
