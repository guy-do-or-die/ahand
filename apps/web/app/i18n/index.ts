import { i18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";
import { messages } from "./en";

/**
 * Lingui runtime setup (macro-less: explicit ids, hand-maintained catalog —
 * see DEVIATIONS.md). Ids are the EN source copy; a missing catalog entry
 * falls back to the id, so nothing ever renders blank.
 *
 * Messages are compiled here rather than by @lingui/cli: lingui only compiles
 * raw strings on the fly in development, so a production build renders ICU
 * placeholders literally ("{amount}" instead of the value).
 */
i18n.load(
  "en",
  Object.fromEntries(
    Object.entries(messages).map(([id, message]) => [id, compileMessage(message as string)]),
  ),
);
i18n.activate("en");

/** Translate helper for plain strings: t("Raise it"). */
export function t(id: string, values?: Record<string, unknown>): string {
  return i18n._(id, values);
}

export { i18n };
