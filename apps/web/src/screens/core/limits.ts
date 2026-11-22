/**
 * Core's accepted limits, shown on /core. Their words live in en.ts and ru.ts under
 * `core.lens.limit.<n>` (the title) and `core.lens.limit.<n>.body`: the specialist layer, because
 * they use Core's vocabulary (gas, wallet, signatures), which the human layer avoids. The app has
 * no plain-words page for them (since 2026-11-22).
 */
export const LIMIT_COUNT = 12;

export const LIMIT_NUMBERS: readonly number[] = Array.from({ length: LIMIT_COUNT }, (_, index) => index + 1);
