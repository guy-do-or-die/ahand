import type en from "./en";

// The thank screen's words in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "thank.title": "Поблагодарить.",
};

export default ru;
