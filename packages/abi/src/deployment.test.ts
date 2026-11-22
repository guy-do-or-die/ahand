import { describe, expect, test } from "bun:test";
import { DeploymentError, parseDeployment } from "./deployment.js";

const local = {
  chainId: 31337,
  core: "0x65ac707E2AE7392583de5d6192C619F1D8862309",
  factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  salt: "0x4f0ff848a233427c84043ed87224bdfcb9f141e864d27833ac5d1344e3a3347d",
  initcodeHash: "0x9f4031e9df87b432822254b2e546d1fc8b88a6bb8798522e7b47d1ab5a08de65",
  runtimeHash: "0xc82f010e03eb6a7d131f566e499da5fe9e00bff94b470641d4521439f1455c83",
  deployBlock: 1,
  tokens: [
    { address: "0x2b125dB6048d4Bf9681656d218B1cC88b4e781d6", symbol: "mUSD", decimals: 6, kind: "usd" },
    { address: "0x0D6c724566Ff1D79ea3F424e7a106190635eeB07", symbol: "mUSD", decimals: 6, kind: "blacklist" },
  ],
  forwarder: "0x0C444fC20D980719592aD1154c41258ae3ECd496",
  accountFactory: "0x1C1D1265fefc5d2743f8fD1E3BD2A15f6A8d41f6",
  commit: "d15e2fcb06c5355c763a6c5782dcb1f9d225c21b",
  dirty: true,
  solc: "0.8.35",
  optimizerRuns: 200,
  evmVersion: "prague",
  oz: "5.6.1",
};

describe("parseDeployment", () => {
  test("reads a local deployment, as an object or as text", () => {
    expect(parseDeployment(local)).toEqual(local as never);
    expect(parseDeployment(JSON.stringify(local))).toEqual(local as never);
  });

  test("returns the record frozen, its tokens too", () => {
    const parsed = parseDeployment(local);
    expect(Object.isFrozen(parsed) && Object.isFrozen(parsed.tokens) && parsed.tokens.every(Object.isFrozen)).toBe(true);
  });

  test("refuses text that is not JSON with a DeploymentError", () => {
    expect(() => parseDeployment("{ not json")).toThrow(DeploymentError);
    expect(() => parseDeployment("{ not json")).toThrow(/the file is not JSON/);
  });

  test("reads another chain: no tokens, no test helpers, commit unknown", () => {
    const base = { ...local, chainId: 8453, tokens: [], forwarder: null, accountFactory: null, commit: null, dirty: null };
    expect(parseDeployment(base).forwarder).toBeNull();
  });

  test.each([
    ["a missing field", { ...local, oz: undefined }, /field oz is missing/],
    ["a bad address", { ...local, core: "0x1234" }, /core is not an address/],
    ["a short salt", { ...local, salt: "0x01" }, /salt is not a 32-byte/],
    ["an unknown token kind", { ...local, tokens: [{ ...local.tokens[0], kind: "usdc" }] }, /kind is not one of/],
    ["a null forwarder on 31337", { ...local, forwarder: null }, /forwarder is null on chain 31337/],
    ["test code off 31337", { ...local, chainId: 1 }, /set off chain 31337/],
    ["a short commit", { ...local, commit: "abc" }, /40-digit commit/],
    ["dirty as text", { ...local, dirty: "yes" }, /dirty is neither/],
    ["a negative block", { ...local, deployBlock: -1 }, /deployBlock is not a whole number/],
  ])("refuses %s", (_, input, message) => {
    const json = JSON.parse(JSON.stringify(input));
    expect(() => parseDeployment(json)).toThrow(DeploymentError);
    expect(() => parseDeployment(json)).toThrow(message);
  });
});
