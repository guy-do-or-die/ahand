import type en from "./en";

// The pass screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "pass.title": "Передать дальше.",
};

export default ru;
