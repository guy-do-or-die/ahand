/**
 * What can be printed small (UX-SPEC §11, D-44). The decision is made from the real code the Qr
 * component's reading (`qrOf`) gives for this address, never from a capacity quoted anywhere: the
 * same Hand's code grows with every pass and with its description.
 *
 * The rule: a printed module is at least the size a version 13 code has on the 31 mm tag, quiet
 * zone included: 69 modules and 4 quiet modules on each side, 31 / 77 = 0.40 mm, three dots of a
 * 190 dpi printer. The card's code is 50 mm wide, so it takes the codes whose modules stay at that
 * size or larger. `side` below is the kit's `QrCode.side`: modules plus the quiet zone.
 */

export type Format = "tag" | "card";

/** The printed width of the code, quiet zone included, in millimetres. */
export const CODE_MM: Record<Format, number> = { tag: 31, card: 50 };

/** The highest version the tag is offered for (PLAN, care-print). */
export const TAG_MAX_VERSION = 13;

/** The quiet zone the kit draws on each side of a code (ui/qr-code.ts QR_QUIET_MODULES; the test pins it). */
export const QUIET_MODULES = 4;

/** Modules on one side of a version, quiet zone included. */
export function sideOf(version: number): number {
  return 17 + 4 * version + 2 * QUIET_MODULES;
}

/** The side of one printed module, in millimetres, for a code of `side` modules at a code width. */
export function moduleMm(side: number, codeMm: number): number {
  return codeMm / side;
}

/** The smallest module printed: a version 13 code on the 31 mm tag. */
export const MIN_MODULE_MM = moduleMm(sideOf(TAG_MAX_VERSION), CODE_MM.tag);

/** True when a code of `side` modules keeps them at MIN_MODULE_MM or larger in this format. */
export function fits(side: number | undefined, format: Format): boolean {
  if (side === undefined || side <= 0) return false;
  return moduleMm(side, CODE_MM[format]) >= MIN_MODULE_MM - 1e-9;
}

/** The highest version a format takes. */
export function maxVersionOf(format: Format): number {
  let version = 1;
  while (version < 40 && fits(sideOf(version + 1), format)) version++;
  return version;
}

/** The formats offered for a code of `side` modules, smallest first. */
export function offered(side: number | undefined): Format[] {
  return (["tag", "card"] as const).filter((format) => fits(side, format));
}

/** Dots per inch at which one module of MIN_MODULE_MM is three dots. */
export const DPI_FOR_THREE_DOTS = Math.ceil((3 * 25.4) / MIN_MODULE_MM);
