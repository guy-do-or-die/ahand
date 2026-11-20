import raw from "virtual:ahand-config";

import { parseConfig } from "./load";

export type * from "./schema";
export { ConfigError, parseConfig } from "./load";

/** This build's configuration, read from AHAND_CONFIG at build time and checked once at start. */
export const config = parseConfig(raw);
