import { useMemo } from "react";

import { clsx } from "../lib/clsx";
import { QR_MAX_VERSION, QR_MIN_PIXELS_PER_MODULE, qrOf } from "./qr-code";
import { useWords } from "./words";

export interface QrProps {
  /** The address to carry: the site's part, then the link as digits (the SDK's digits form). */
  value: string;
  /** The highest version still drawn; above it the code is too dense (25: a good camera). */
  maxVersion?: number;
  /** What the code is, for a screen reader; the link itself is never read out. */
  label?: string;
  className?: string;
}

/**
 * A QR code as inline SVG: ink on paper in both themes, with its quiet zone inside the
 * drawing. Under it, in mono, the version it needed. A code too dense to scan is not drawn:
 * the component says "Too long for a code. Send it as text." and names the version it would
 * have needed. The same reading is exported as `qrOf` for a screen that decides about print.
 */
export function Qr({ value, maxVersion = QR_MAX_VERSION, label, className }: QrProps) {
  const words = useWords().qr;
  const code = useMemo(() => qrOf(value, maxVersion), [value, maxVersion]);

  if (code.dense) {
    return (
      <div className={clsx("ah-qr", className)} data-qr-dense="true" data-qr-version={code.version}>
        <p className="ah-note" style={{ margin: 0 }}>
          {words.tooDense}
        </p>
        <span className="ah-meta">{code.version ? `QR v${code.version} > v${maxVersion}` : `QR > v40`}</span>
      </div>
    );
  }
  return (
    <div className={clsx("ah-qr", className)} data-qr-dense="false" data-qr-version={code.version}>
      <div className="ah-qr__tile" style={{ minWidth: code.side * QR_MIN_PIXELS_PER_MODULE }}>
        <svg viewBox={`0 0 ${code.side} ${code.side}`} role="img" aria-label={label ?? words.alt} shapeRendering="crispEdges">
          <path d={code.path} />
        </svg>
      </div>
      <span className="ah-meta">
        QR v{code.version} · {code.modules}×{code.modules} · L
      </span>
    </div>
  );
}
