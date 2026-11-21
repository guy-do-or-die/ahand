/**
 * The accepted limits of the record (brief 02 §2), shown on /core verbatim. Their words live in
 * en.ts and ru.ts under `core.lens.limit.<n>` (the title) and `core.lens.limit.<n>.body`: the
 * specialist layer, because they are the record's own words and use Core's vocabulary (gas,
 * wallet, signatures), which the human layer avoids. docs/limits.md says each one in plain words;
 * the app has no plain-words page for them (decided by the owner on 2026-11-22).
 */
export const LIMIT_COUNT = 12;

export const LIMIT_NUMBERS: readonly number[] = Array.from({ length: LIMIT_COUNT }, (_, index) => index + 1);
