import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { keccak256, toHex } from "viem";

import { checkRecord, readRecords } from "../plugins/deployments.js";
import { aHandCoreAbi, DEPLOYMENTS, mockUsdAbi } from "./generated.js";

const PACKAGE = join(import.meta.dirname, "..");
const CONTRACTS = join(PACKAGE, "../../contracts");
const artifactOf = (name: string) => join(CONTRACTS, `out/${name}.sol/${name}.json`);

// The same comparison as `bun run check:abi`, run with the tests and without git: @wagmi/cli, with
// this package's configuration, writes today what generated.ts holds.
describe("generated.ts", () => {
  test("is what @wagmi/cli writes from wagmi.config.ts today", () => {
    // Inside the package, where the configuration's imports (viem, @wagmi/cli) resolve.
    const cache = join(PACKAGE, "node_modules/.cache");
    mkdirSync(cache, { recursive: true });
    const scratch = mkdtempSync(join(cache, "generated-"));
    try {
      const out = join(scratch, "generated.ts");
      const config = join(scratch, "wagmi.config.ts");
      writeFileSync(
        config,
        `import config from ${JSON.stringify(join(PACKAGE, "wagmi.config.ts"))};\n` +
          `export default { ...config, out: ${JSON.stringify(out)} };\n`,
      );
      // From the package, as `bun run generate` runs it: its tsconfig and prettier settings apply.
      const result = Bun.spawnSync(["bunx", "--bun", "wagmi", "generate", "--config", config], { cwd: PACKAGE, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(readFileSync(out, "utf-8")).toBe(readFileSync(join(import.meta.dirname, "generated.ts"), "utf-8"));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("holds the ABIs of forge's build", () => {
    expect(aHandCoreAbi).toStrictEqual(JSON.parse(readFileSync(artifactOf("AHandCore"), "utf-8")).abi);
    expect(mockUsdAbi).toStrictEqual(JSON.parse(readFileSync(artifactOf("MockUSD"), "utf-8")).abi);
  });

  test("holds the deployment records, as parseDeployment reads them, and frozen", () => {
    const records = readRecords({ records: join(CONTRACTS, "deployments"), artifact: artifactOf("AHandCore") });
    expect(records.size).toBeGreaterThan(0);
    expect(DEPLOYMENTS).toStrictEqual(Object.fromEntries(records) as unknown as typeof DEPLOYMENTS);
    for (const record of Object.values(DEPLOYMENTS)) expect(Object.isFrozen(record)).toBe(true);
  });
});

// The plugin checks a record's values before it ships it, for every chain, not only Base Sepolia.
describe("a deployment record the plugin would ship", () => {
  const good = { ...DEPLOYMENTS[84532], chainId: 8453 };
  const built = good.initcodeHash;

  test("passes when it names the Core this tree builds, at its create2 address", () => {
    expect(() => checkRecord("8453.json", good, built)).not.toThrow();
  });

  test.each([
    ["another core", { ...good, core: "0x65aC707E2Ae7392583de5D6192C619F1d8862308" }, /core is .* but create2/],
    ["another factory", { ...good, factory: "0x0000000000FFe8B47B3e2130213B802212439497" }, /not the deterministic deployer/],
    ["another salt", { ...good, salt: keccak256(toHex("aHand.core/2")) }, /salt is/],
    ["another initcode", { ...good, initcodeHash: keccak256("0x00") }, /this tree builds hashes to/],
    ["a lowercase core", { ...good, core: good.core.toLowerCase() }, /core .* EIP-55 checksum/],
    ["a core with a wrong checksum", { ...good, core: "0x65AC707E2AE7392583de5d6192C619F1D8862309" }, /core .* EIP-55 checksum/],
  ])("refuses %s", (_, record, message) => {
    expect(() => checkRecord("8453.json", record as typeof good, built)).toThrow(message);
  });
});
