import { i18n } from "@lingui/core";
import { messages } from "./en";

/**
 * Lingui runtime setup (macro-less: explicit ids, hand-maintained catalog —
 * see DEVIATIONS.md). Ids are the EN source copy; a missing catalog entry
 * falls back to the id, so nothing ever renders blank.
 */
i18n.load("en", messages);
i18n.activate("en");

/** Translate helper for plain strings: t("Raise it"). */
export function t(id: string, values?: Record<string, unknown>): string {
  return i18n._(id, values);
}

export { i18n };
