import type { Address } from "viem";

import { clsx } from "../lib/clsx";

/**
 * A person as a small round mark drawn from their address: a five-by-five pattern, mirrored left
 * to right, in ink on the tone of a control. The same address always draws the same mark, so in
 * the calm view, where an address is not shown, two people on one screen can still be told apart
 * and the same person recognised twice. It is not proof of who someone is: two addresses can draw
 * alike, and the address itself stands under the lens.
 *
 * With no address (nobody logged in) it draws a plain head and shoulders. Decorative: whoever
 * places it names the person in words beside it.
 */
export function PersonDisc({ address, size = 28, className }: { address?: Address | undefined; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className={clsx("ah-person-disc", className)}>
      <circle cx="14" cy="14" r="14" fill="var(--sunken-hi)" />
      {address ? (
        cellsOf(address).map(([x, y]) => <rect key={`${x}:${y}`} x={6.5 + x * 3} y={6.5 + y * 3} width="3.05" height="3.05" fill="currentColor" />)
      ) : (
        <>
          <circle cx="14" cy="11" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6.5 22.5 C7.5 18 10.5 16.5 14 16.5 C17.5 16.5 20.5 18 21.5 22.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * The filled cells of an address's mark, as [column, row] in a 5×5 grid. Fifteen bits decide the
 * left three columns, taken from the address's last bytes (its first ones are often zeros or a
 * vanity prefix); columns four and five mirror two and one. A mark that would be empty or full
 * gets its centre cell flipped, so it never reads as a blank disc.
 */
export function cellsOf(address: string): [number, number][] {
  const hex = address.toLowerCase().replace(/^0x/, "");
  const bits = parseInt(hex.slice(-4), 16) ^ (parseInt(hex.slice(-8, -4), 16) << 1);
  const cells: [number, number][] = [];
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 5; row++) {
      if (((bits >> (column * 5 + row)) & 1) === 0) continue;
      cells.push([column, row]);
      if (column < 2) cells.push([4 - column, row]);
    }
  }
  if (cells.length === 0) return [[2, 2]];
  if (cells.length === 25) return cells.filter(([x, y]) => !(x === 2 && y === 2));
  return cells;
}
