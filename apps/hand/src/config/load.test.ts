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
