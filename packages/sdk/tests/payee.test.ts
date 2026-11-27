import { getAddress, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { payeeProblem, payeeRefused, raiserHops } from "../src/payee.js";

const ctx = {
  core: getAddress("0x0f0555972388151d2c187f636a0855b6ee9b9685"),
  raiser: getAddress("0x70997970c51812dc3a010c7d01b50e0d17dc79c8"),
  token: getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
};
const helper: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

describe("payeeProblem", () => {
  it("names each of the five cases", () => {
    expect(payeeProblem(zeroAddress, ctx)).toBe("zero");
    expect(payeeProblem(ctx.core, ctx)).toBe("core");
    expect(payeeProblem(ctx.raiser, ctx)).toBe("raiser");
    expect(payeeProblem(ctx.token, ctx)).toBe("token");
    expect(payeeProblem(helper, ctx)).toBe("ok");
  });

  it("ignores letter case: a lower-case and a checksummed address are one address", () => {
    expect(payeeProblem(ctx.core.toLowerCase() as Address, ctx)).toBe("core");
    expect(payeeProblem(ctx.raiser.toUpperCase().replace("0X", "0x") as Address, ctx)).toBe("raiser");
    expect(payeeProblem(helper.toLowerCase() as Address, { ...ctx, token: helper })).toBe("token");
  });

  it("refuses zero and Core, and only flags the raiser and the token", () => {
    expect(["zero", "core", "raiser", "token", "ok"].map((p) => payeeRefused(p as Parameters<typeof payeeRefused>[0]))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("puts a refusal before a flag when one address is both", () => {
    // A misconfigured context where Core and the raiser coincide: the refusal wins.
    expect(payeeProblem(ctx.core, { ...ctx, raiser: ctx.core })).toBe("core");
  });
});

describe("raiserHops", () => {
  const other: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const shake = (nextKey: Address, payee: Address, claimBps: number, nextClaimBps: number) => ({ shake: { nextKey, payee, claimBps, nextClaimBps } });

  it("names each Shake that pays the raiser or hands the link to the raiser's address, in any letter case", () => {
    const route = [
      shake(other, ctx.raiser.toLowerCase() as Address, 10_000, 9_000), // pays the raiser
      shake(ctx.raiser, helper, 9_000, 8_000), // the next key is the raiser's address
      shake(other, helper, 8_000, 7_000), // nothing of the raiser's
      shake(ctx.raiser, ctx.raiser, 7_000, 6_000), // both
    ];
    expect(raiserHops(ctx.raiser, route)).toEqual([
      { position: 0, as: "payee" },
      { position: 1, as: "key" },
      { position: 3, as: "payee and key" },
    ]);
  });

  it("does not count a raiser named as payee of a Shake that keeps nothing: nothing is paid", () => {
    expect(raiserHops(ctx.raiser, [shake(other, ctx.raiser, 10_000, 10_000)])).toEqual([]);
    expect(raiserHops(ctx.raiser, [])).toEqual([]);
  });
});
