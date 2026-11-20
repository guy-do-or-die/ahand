/// <reference types="vite/client" />

declare module "virtual:ahand-config" {
  /** The parsed JSON of AHAND_CONFIG; `config/index.ts` checks it against the schema. */
  const raw: unknown;
  export default raw;
}
