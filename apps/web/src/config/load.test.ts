import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { RECOMMENDED_RELAYS } from "@ahand/deliver";

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

/**
 * A configuration names its chain by id; viem/chains says the rest (config/chains.ts). The four
 * public networks are Ethereum, Sepolia, Base and Base Sepolia; 31337 is the stand's anvil.
 */
describe("the chain comes from viem/chains", () => {
  test("each known id reads as viem names it, with Base's real pace", () => {
    const read = (id: number) => parseConfig(on(id, false)).chain;
    expect(read(1)).toMatchObject({ name: "Ethereum", blockTimeMs: 12_000, hasL1: false, testnet: false, explorer: "https://etherscan.io" });
    expect(read(11_155_111)).toMatchObject({ name: "Sepolia", blockTimeMs: 12_000, hasL1: false, testnet: true, explorer: "https://sepolia.etherscan.io" });
    expect(read(8453)).toMatchObject({ name: "Base", blockTimeMs: 200, hasL1: true, testnet: false, explorer: "https://basescan.org" });
    expect(read(84532)).toMatchObject({ name: "Base Sepolia", blockTimeMs: 200, hasL1: true, testnet: true, explorer: "https://sepolia.basescan.org" });
    expect(parseConfig(example).chain).toMatchObject({ id: LOCAL_CHAIN_ID, name: "Local test network", blockTimeMs: 1_000, hasL1: false, testnet: true });
  });

  test("an id aHand does not know is refused", () => {
    expect(() => parseConfig(on(10, false))).toThrow(/chain.id must be one of the chains aHand knows \(1, 8453, 31337, 84532, 11155111\)/);
  });

  test("a field viem answers, left in an older configuration (a stand's slot), is passed over: viem's value stands", () => {
    const old = on(84532, false) as unknown as { chain: Record<string, unknown> };
    Object.assign(old.chain, { name: "Other", blockTimeMs: 2_000, hasL1: false, testnet: false, explorer: "https://x.example" });
    expect(parseConfig(old).chain).toMatchObject({ name: "Base Sepolia", blockTimeMs: 200, hasL1: true, testnet: true, explorer: "https://sepolia.basescan.org" });
  });

  test("the forwarder is the chain's Multicall3 unless the configuration names one; the stand's anvil has none", () => {
    const unnamed = (id: number) => {
      const { forwarder: _, ...rest } = on(id, id === LOCAL_CHAIN_ID) as ReturnType<typeof on> & { forwarder?: unknown };
      return rest;
    };
    expect(parseConfig(unnamed(84532)).forwarder).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
    expect(parseConfig(unnamed(1)).forwarder).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
    expect(parseConfig(unnamed(LOCAL_CHAIN_ID)).forwarder).toBeNull();
    expect(parseConfig({ ...on(84532, false), forwarder: null }).forwarder).toBeNull();
    expect(parseConfig({ ...on(84532, false), forwarder: "0x00000000000000000000000000000000000000c1" }).forwarder).toBe("0x00000000000000000000000000000000000000c1");
  });
});

describe("the public test network's fields", () => {
  const sepolia = JSON.parse(readFileSync(new URL("./base-sepolia.json", import.meta.url), "utf8"));

  test("base-sepolia.json is a test network with an explorer, faucets and link previews (the view server's Vercel Function)", () => {
    const config = parseConfig(sepolia);
    expect(config.chain.local).toBe(false);
    expect(config.chain.testnet).toBe(true);
    expect(config.chain.explorer).toBe("https://sepolia.basescan.org");
    expect(config.faucets?.map((f) => f.asset)).toEqual(["USDC", "ETH"]);
    expect(config.faucets?.[0]?.url).toBe("https://faucet.circle.com");
    expect(config.previews).toBe(true);
    expect(parseConfig({ ...sepolia, previews: false }).previews).toBe(false);
  });

  test("its relays are @ahand/deliver's recommended ones, in that order (the CSP's connect-src is written from them)", () => {
    expect(parseConfig(sepolia).relays).toEqual(RECOMMENDED_RELAYS.map((relay) => relay.url));
  });

  test("the fields are optional; without them there are no faucets or previews, and the stand's anvil is a test network with no explorer", () => {
    const config = parseConfig(example);
    expect(config.chain.testnet).toBe(true);
    expect(config.chain.explorer).toBeUndefined();
    expect(config.faucets).toBeUndefined();
    expect(config.previews).toBeUndefined();
  });

  test("a faucet is an https URL, and faucets belong to a test network", () => {
    expect(() => parseConfig({ ...sepolia, faucets: [{ asset: "ETH", url: "http://x.example" }] })).toThrow(/faucets\[0\].url/);
    expect(() => parseConfig({ ...on(8453, false), faucets: sepolia.faucets })).toThrow(/faucets belong to a test network/);
  });
});

/** The site addresses base-sepolia.json expects Privy's dashboard to allow: the site, and the ports on this machine Privy's dashboard allows. */
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
