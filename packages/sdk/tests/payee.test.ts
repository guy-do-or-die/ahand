import { getAddress, zeroAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";

import { payeeProblem, payeeRefused } from "../src/payee.js";

const ctx = {
  core: getAddress("0x65ac707e2ae7392583de5d6192c619f1d8862309"),
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
