import { create, type QRCodeSegment } from "qrcode";

/**
 * The QR code of an address (D-44, brief 03 §7): the site's part as a byte segment, the link's
 * digits as a numeric segment (three digits in ten bits), error correction level L. The
 * drawing is a single SVG path with a quiet zone of four modules on every side.
 *
 * A code above `maxVersion` (25, "a good camera") is called too dense: the caller shows the
 * sentence "Too long for a code. Send it as text." and draws nothing.
 */

export const QR_MAX_VERSION = 25;
export const QR_QUIET_MODULES = 4;
/** UX-SPEC §14: a code on screen is at least three pixels per module. */
export const QR_MIN_PIXELS_PER_MODULE = 3;

export interface QrCode {
  /** 1 to 40; undefined when the text does not fit any version. */
  version: number | undefined;
  /** Modules on one side, without the quiet zone; 0 when nothing fits. */
  modules: number;
  /** One side of the drawing in modules, quiet zone included. */
  side: number;
  /** The dark modules as an SVG path in module units, offset by the quiet zone. */
  path: string;
  /** True when the version is above the limit, or no version fits at all. */
  dense: boolean;
}

/** Splits an address into the part before its trailing digits and the digits themselves. */
export function qrSegments(value: string): QRCodeSegment[] {
  const bytes = (text: string): QRCodeSegment => ({ data: new TextEncoder().encode(text), mode: "byte" });
  const match = /^(.*?)([0-9]+)$/s.exec(value);
  if (!match) return [bytes(value)];
  const [, prefix, digits] = match;
  const segments: QRCodeSegment[] = [];
  if (prefix) segments.push(bytes(prefix));
  segments.push({ data: digits!, mode: "numeric" });
  return segments;
}

export function qrOf(value: string, maxVersion: number = QR_MAX_VERSION): QrCode {
  let code: ReturnType<typeof create>;
  try {
    code = create(qrSegments(value), { errorCorrectionLevel: "L" });
  } catch {
    // The library throws when the text is longer than version 40 holds.
    return { version: undefined, modules: 0, side: 0, path: "", dense: true };
  }
  const modules = code.modules.size;
  const side = modules + 2 * QR_QUIET_MODULES;
  if (code.version > maxVersion) return { version: code.version, modules, side, path: "", dense: true };

  // One run of dark modules per row becomes one rectangle of the path.
  let path = "";
  for (let row = 0; row < modules; ++row) {
    let start = -1;
    for (let column = 0; column <= modules; ++column) {
      const dark = column < modules && code.modules.get(row, column) === 1;
      if (dark && start < 0) start = column;
      if (!dark && start >= 0) {
        path += `M${start + QR_QUIET_MODULES} ${row + QR_QUIET_MODULES}h${column - start}v1h-${column - start}z`;
        start = -1;
      }
    }
  }
  return { version: code.version, modules, side, path, dense: false };
}
