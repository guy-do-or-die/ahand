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

/** The site addresses base-sepolia.json expects Privy's dashboard to allow: the site, and the ports on this machine the owner allowed. */
const SEPOLIA_ORIGINS = ["https://ahand.in", "https://*.ahand.in", ...[3000, 3001, 3300, 3400, 3411, 5173].map((port) => `http://localhost:${port}`)];

describe("sign-in through Privy", () => {
  const sepolia = JSON.parse(readFileSync(new URL("./base-sepolia.json", import.meta.url), "utf8"));

  test("base-sepolia.json turns it on with the public app id; the local example has none", () => {
    expect(parseConfig(sepolia).privy).toEqual({ appId: "clt69jwp204btq1o3q72cupji", origins: SEPOLIA_ORIGINS });
    expect(parseConfig({ ...sepolia, privy: { appId: "clt69jwp204btq1o3q72cupji" } }).privy).toEqual({ appId: "clt69jwp204btq1o3q72cupji" });
    expect(() => parseConfig({ ...sepolia, privy: { appId: "clt69jwp204btq1o3q72cupji", origins: "https://ahand.in" } })).toThrow(/privy.origins must be a list/);
    for (const bad of ["http://ahand.in", "https://ahand.in/", "https://*", "https://a.*.ahand.in", "*.ahand.in", "http://localhost", "http://127.0.0.1:3300", "http://localhost:3300/", "http://*.localhost:3300"]) {
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

describe("chain.pollMs and chain.logWindow", () => {
  const sepolia = JSON.parse(readFileSync(new URL("./base-sepolia.json", import.meta.url), "utf8")) as unknown;
  const withChain = (fields: Record<string, unknown>) => {
    const copy = structuredClone(example) as unknown as { chain: Record<string, unknown> };
    Object.assign(copy.chain, fields);
    return copy;
  };

  test("Base Sepolia states its real pace (200 ms), polls every 2 s and reads logs 200 blocks at a time", () => {
    const chain = parseConfig(sepolia).chain;
    expect(chain.blockTimeMs).toBe(200);
    expect(chain.pollMs).toBe(2_000);
    expect(chain.logWindow).toBe(200);
  });

  test("both are optional: the local example sets neither", () => {
    const chain = parseConfig(example).chain;
    expect(chain.pollMs).toBeUndefined();
    expect(chain.logWindow).toBeUndefined();
    expect("pollMs" in chain || "logWindow" in chain).toBe(false);
    expect(parseConfig(withChain({ pollMs: null, logWindow: null })).chain.logWindow).toBeUndefined();
  });

  test("they are whole numbers in range: polling at least 100 ms, a log window of 1 to 2 000 blocks", () => {
    expect(parseConfig(withChain({ pollMs: 500, logWindow: 1 })).chain).toMatchObject({ pollMs: 500, logWindow: 1 });
    expect(() => parseConfig(withChain({ pollMs: 50 }))).toThrow(/chain.pollMs must be a whole number from 100/);
    expect(() => parseConfig(withChain({ pollMs: "2000" }))).toThrow(ConfigError);
    expect(() => parseConfig(withChain({ logWindow: 0 }))).toThrow(/chain.logWindow must be a whole number from 1 to 2000/);
    expect(() => parseConfig(withChain({ logWindow: 5_000 }))).toThrow(ConfigError);
    expect(() => parseConfig(withChain({ logWindow: 2.5 }))).toThrow(ConfigError);
  });
});
