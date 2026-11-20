import type en from "./en";

// The limits screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "limits.title": "Чего она не обещает.",
};

export default ru;
