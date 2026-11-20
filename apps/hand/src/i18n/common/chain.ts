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
  const words = i18n._(id);
  // lingui answers a missing id with the id itself.
  return words === id ? chain.name : words;
}
