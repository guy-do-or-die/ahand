import { expect, test } from "bun:test";

import { cellsOf } from "./PersonDisc";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

test("a person's mark is the same for the same address, whatever its capitals", () => {
  expect(cellsOf(A)).toEqual(cellsOf(A.toLowerCase()));
  expect(cellsOf(A)).toEqual(cellsOf(A.toUpperCase().replace("0X", "0x")));
});

test("two addresses draw two marks", () => {
  expect(cellsOf(A)).not.toEqual(cellsOf(B));
});

test("a mark mirrors left to right and stays inside its five-by-five grid", () => {
  for (const address of [A, B, "0x000000000000000000000000000000000000dEaD"]) {
    const cells = cellsOf(address);
    const has = (x: number, y: number) => cells.some(([cx, cy]) => cx === x && cy === y);
    for (const [x, y] of cells) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(5);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(5);
      expect(has(4 - x, y)).toBe(true);
    }
  }
});

test("a mark is never a blank disc and never a full one", () => {
  for (const address of ["0x0000000000000000000000000000000000000000", "0xffffffffffffffffffffffffffffffffffffffff", "0x000000000000000000000000000000000000ffff"]) {
    const cells = cellsOf(address);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(25);
  }
});
