import type en from "./en";

// The core screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "core.title": "Этот контракт.",
};

export default ru;
