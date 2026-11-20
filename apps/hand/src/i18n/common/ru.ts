import type en from "./en";

// Words every screen shares, in Russian: the same keys as en.ts, checked by the type.
const ru: Record<keyof typeof en, string> = {
  "common.notBuilt": "Ещё не собрано",
  "common.ribbon": "Локальная тестовая сеть · Тестовые доллары",
  "common.footer": "Без аудита · Core {core} · Без владельца · Без комиссии",
  "common.language": "Язык",
};

export default ru;
