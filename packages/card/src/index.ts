/**
 * The link's preview, shared by the view server and the raise screen: its words, its model
 * and the facts it is built from. The drawing itself is `@ahand/card/Card`, kept apart so that
 * code which only reads or writes words (the stand, the tools) does not load React.
 */
export { isolate, visible } from "./bidi.ts";
export { cardModelOf, drawable, metaOf, oneLine, DETAILS_MAX, TITLE_MAX, type CardModel, type HandFacts, type MetaText } from "./model.ts";
export {
  amountText,
  day,
  DOLLAR_KINDS,
  endLine,
  lineText,
  termsLine,
  unitsText,
  LANGS,
  WORDS,
  type CardState,
  type CardWords,
  type Lang,
  type Line,
  type Terms,
  type TokenFacts,
} from "./words.ts";
