import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ConfigError, parseConfig } from "./load";
import { LOCAL_CHAIN_ID, localChainProblem } from "./local";

const example = JSON.parse(readFileSync(new URL("./config.example.json", import.meta.url), "utf8")) as {
  chain: { id: number; local: boolean };
  cores: { trusted: { chainId: number; core: string }[] };
};

/** The example configuration moved to another chain: its trusted Core moves with it. */
function on(id: number, local: boolean) {
  const copy = structuredClone(example);
  copy.chain.id = id;
  copy.chain.local = local;
  copy.cores.trusted = copy.cores.trusted.map((entry) => ({ ...entry, chainId: id }));
  return copy;
}

describe("chain.local belongs to chain 31337 only", () => {
  test("the shared rule", () => {
    expect(localChainProblem({ id: LOCAL_CHAIN_ID, local: true })).toBeUndefined();
    expect(localChainProblem({ id: 8453, local: false })).toBeUndefined();
    expect(localChainProblem({ id: 8453, local: true })).toMatch(/only chain 31337/);
    expect(localChainProblem({ id: "31337", local: true })).toMatch(/only chain 31337/);
    expect(localChainProblem(undefined)).toBeUndefined();
  });

  test("parseConfig takes the example (local on 31337) and a public chain that is not local", () => {
    expect(parseConfig(example).chain.local).toBe(true);
    expect(parseConfig(on(8453, false)).chain.id).toBe(8453);
  });

  test("parseConfig refuses chain 8453 marked local", () => {
    expect(() => parseConfig(on(8453, true))).toThrow(ConfigError);
    expect(() => parseConfig(on(8453, true))).toThrow(/chain.local is true, but chain.id is 8453/);
  });
});

describe("the public test network's fields", () => {
  const sepolia = JSON.parse(readFileSync(new URL("./base-sepolia.json", import.meta.url), "utf8"));

  test("base-sepolia.json is a test network with an explorer, faucets and link previews (face's Vercel Function)", () => {
    const config = parseConfig(sepolia);
    expect(config.chain.local).toBe(false);
    expect(config.chain.testnet).toBe(true);
    expect(config.chain.explorer).toBe("https://sepolia.basescan.org");
    expect(config.faucets?.map((f) => f.asset)).toEqual(["USDC", "ETH"]);
    expect(config.faucets?.[0]?.url).toBe("https://faucet.circle.com");
    expect(config.previews).toBe(true);
    expect(parseConfig({ ...sepolia, previews: false }).previews).toBe(false);
  });

  test("the fields are optional, and a configuration without them reads as before", () => {
    const config = parseConfig(example);
    expect(config.chain.testnet).toBeUndefined();
    expect(config.chain.explorer).toBeUndefined();
    expect(config.faucets).toBeUndefined();
    expect(config.previews).toBeUndefined();
  });

  test("an explorer is an https URL without a trailing slash; faucets belong to a test network", () => {
    expect(parseConfig({ ...sepolia, chain: { ...sepolia.chain, explorer: "https://x.example/" } }).chain.explorer).toBe("https://x.example");
    expect(() => parseConfig({ ...sepolia, chain: { ...sepolia.chain, explorer: "javascript:alert(1)" } })).toThrow(/chain.explorer/);
    expect(() => parseConfig({ ...sepolia, faucets: [{ asset: "ETH", url: "http://x.example" }] })).toThrow(/faucets\[0\].url/);
    expect(() => parseConfig({ ...sepolia, chain: { ...sepolia.chain, testnet: false } })).toThrow(/faucets belong to a test network/);
  });
});

describe("email sign-in through Privy", () => {
  const sepolia = JSON.parse(readFileSync(new URL("./base-sepolia.json", import.meta.url), "utf8"));

  test("base-sepolia.json turns it on with the public app id; the local example has none", () => {
    expect(parseConfig(sepolia).privy).toEqual({ appId: "clt69jwp204btq1o3q72cupji", origins: ["https://ahand.in", "https://*.ahand.in"] });
    expect(parseConfig({ ...sepolia, privy: { appId: "clt69jwp204btq1o3q72cupji" } }).privy).toEqual({ appId: "clt69jwp204btq1o3q72cupji" });
    expect(() => parseConfig({ ...sepolia, privy: { appId: "clt69jwp204btq1o3q72cupji", origins: "https://ahand.in" } })).toThrow(/privy.origins must be a list/);
    for (const bad of ["http://ahand.in", "https://ahand.in/", "https://*", "https://a.*.ahand.in", "*.ahand.in"]) {
      expect(() => parseConfig({ ...sepolia, privy: { appId: "clt69jwp204btq1o3q72cupji", origins: [bad] } })).toThrow(/privy.origins\[0\]/);
    }
    expect(parseConfig(example).privy).toBeUndefined();
    expect(parseConfig({ ...sepolia, privy: null }).privy).toBeUndefined();
  });

  test("an app id is letters and digits only, and a local chain cannot have Privy", () => {
    expect(() => parseConfig({ ...sepolia, privy: { appId: "x" } })).toThrow(/privy.appId/);
    expect(() => parseConfig({ ...sepolia, privy: { appId: "clt69jwp204btq1o3q72cupji\"; script-src *" } })).toThrow(/privy.appId/);
    expect(() => parseConfig({ ...sepolia, privy: {} })).toThrow(/privy.appId must be a string/);
    expect(() => parseConfig({ ...example, privy: { appId: "clt69jwp204btq1o3q72cupji" } })).toThrow(/privy belongs to a public network/);
  });
});
