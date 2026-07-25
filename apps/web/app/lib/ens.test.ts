import { describe, it, expect } from "vitest";
import { displayIdentity, looksLikeEnsName } from "./ens";

describe("displayIdentity", () => {
  const addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  it("prefers the resolved name", () => {
    expect(displayIdentity("maker.eth", addr)).toBe("maker.eth");
  });
  it("falls back to a shortened address", () => {
    expect(displayIdentity(null, addr)).toBe("0x7099…79C8");
  });
  it("renders empty without either", () => {
    expect(displayIdentity(null, null)).toBe("");
    expect(displayIdentity(undefined, undefined)).toBe("");
  });
});

describe("looksLikeEnsName", () => {
  it("accepts names", () => {
    expect(looksLikeEnsName("maker.eth")).toBe(true);
    expect(looksLikeEnsName("sub.maker.eth")).toBe(true);
    expect(looksLikeEnsName("Maker.ETH")).toBe(true);
  });
  it("rejects addresses and junk", () => {
    expect(looksLikeEnsName("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe(false);
    expect(looksLikeEnsName("maker")).toBe(false);
    expect(looksLikeEnsName("")).toBe(false);
    expect(looksLikeEnsName("a b.eth")).toBe(false);
  });
});
