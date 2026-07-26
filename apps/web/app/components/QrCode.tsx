import { useMemo } from "react";
import { encode } from "uqr";

/**
 * The hand link as a scannable square — for handing it over in person,
 * phone to phone, with no messenger in between. Always dark-on-light with
 * raw palette colors: an inverted (light-on-dark) QR reads as decoration
 * to many camera apps, so the tile ignores the theme.
 */
export function QrCode({ value, className = "" }: { value: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 0 });
    let d = "";
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.data[y][x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <div
      className={`p-3.5 ${className}`}
      style={{
        background: "var(--ah-raw-paper)",
        border: "var(--bw-emph) solid var(--ah-raw-ink)",
        borderRadius: "var(--r-chip-lg)",
      }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={value}
        shapeRendering="crispEdges"
        className="block w-full h-full"
      >
        <path d={path} fill="var(--ah-raw-ink)" />
      </svg>
    </div>
  );
}
