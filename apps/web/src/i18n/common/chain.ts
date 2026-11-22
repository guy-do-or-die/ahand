import { i18n } from "@lingui/core";

/**
 * The network's name in the language shown. The configuration names its chain once, in English
 * (`chain.name`); a chain the catalogue knows has a sentence of its own under `common.chain.<id>`
 * in each language, and that one wins. Any other chain shows the configuration's name, which for
 * a public network is a proper name (Base) and reads the same in both languages.
 *
 * A screen that shows the network writes `chainName(config.chain)`, never `config.chain.name`.
 */
export function chainName(chain: { id: number; name: string }): string {
  const id = `common.chain.${chain.id}`;
  // Asked only for an id the catalogue holds: lingui answers a missing one with the id itself and
  // warns "Uncompiled message detected" on the console.
  if (!Object.hasOwn(i18n.messages, id)) return chain.name;
  return i18n._(id);
}
