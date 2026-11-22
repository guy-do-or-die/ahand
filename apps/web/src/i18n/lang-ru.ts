import { config } from "../config";
import { mergeCatalogue, type CatalogueModules } from "./catalogue";
import common from "./common/ru";

/**
 * Every word of the app in Russian: `common/` and each screen's `ru.ts`, merged (a key defined
 * twice refuses to load). The loader imports this module only when Russian is the language shown,
 * so it is a chunk of its own and the entry chunk carries no catalogue.
 *
 * The dev wallet's words are part of it only in a local build: `__AHAND_LOCAL__` is false in a
 * public build, the branch is dead code, and its sentences are emitted nowhere.
 */

declare const __AHAND_LOCAL__: boolean | undefined;
const LOCAL = typeof __AHAND_LOCAL__ === "boolean" ? __AHAND_LOCAL__ : config.chain.local;

const screens = import.meta.glob<{ default: Record<string, string> }>(["../screens/*/ru.ts", "!../screens/dev-wallet/ru.ts"], {
  eager: true,
}) as CatalogueModules;
const local = LOCAL ? (import.meta.glob<{ default: Record<string, string> }>("../screens/dev-wallet/ru.ts", { eager: true }) as CatalogueModules) : {};

export default mergeCatalogue("ru", common, { ...screens, ...local });
