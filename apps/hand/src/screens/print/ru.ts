import type en from "./en";

// The print screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "print.title": "Печать.",
};

export default ru;
