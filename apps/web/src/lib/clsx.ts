/**
 * Joins class names, as the `clsx` package does for the forms this app uses: strings, numbers,
 * falsy values (skipped), arrays, and objects whose truthy keys are kept. Written here so the
 * ported components need no extra dependency.
 */
export type ClassValue = string | number | bigint | boolean | null | undefined | ClassValue[] | Record<string, unknown>;

export function clsx(...values: ClassValue[]): string {
  const out: string[] = [];
  const add = (value: ClassValue): void => {
    if (!value && value !== 0) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      out.push(String(value));
    } else if (Array.isArray(value)) {
      for (const item of value) add(item);
    } else if (typeof value === "object") {
      for (const [key, on] of Object.entries(value)) if (on) out.push(key);
    }
  };
  for (const value of values) add(value);
  return out.join(" ");
}
