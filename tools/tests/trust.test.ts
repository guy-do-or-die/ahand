/**
 * Where the CLI's trust comes from, run in a clone of its own (see cloneAt): a build of another
 * AHandCore.sol is never the trust anchor, and the deployment file of a stand slot is found
 * (STAND_SLOT, or the only slot file of the chain) and named.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deploymentOf } from "@ahand/sdk/testing";
import { keccak256, stringToBytes, type Hex } from "viem";

import { coreAddressOf } from "../manifest.ts";
import { chainOn, cloneAt, raise, type Chain, type Clone, type Raised, testPort } from "./fixtures.ts";

const STALE = "contracts/out was not built from contracts/src/AHandCore.sol as it is now";

let chain: Chain;
let raised: Raised;
const scratch = mkdtempSync(join(tmpdir(), "ahand-tools-trust-"));

beforeAll(async () => {
  chain = await chainOn(testPort(9));
  raised = await raise(chain, { raiser: 1, content: "Trust test." });
}, 120_000);

afterAll(async () => {
  await chain?.stop();
  rmSync(scratch, { recursive: true, force: true });
});

let clones = 0;
function freshClone(): Clone {
  return cloneAt(join(scratch, `clone-${++clones}`));
}

/**
 * Turns the clone's contracts/out into a build of another AHandCore.sol: other creation code, and
 * metadata that records another source. Returns the Core that build would derive.
 */
function doctor(clone: Clone): Hex {
  const json = JSON.parse(readFileSync(clone.artifact, "utf8"));
  json.bytecode.object = `${json.bytecode.object}00`;
  const other = keccak256(stringToBytes("// another AHandCore.sol"));
  json.metadata.sources["src/AHandCore.sol"].keccak256 = other;
  const raw = JSON.parse(json.rawMetadata);
  raw.sources["src/AHandCore.sol"].keccak256 = other;
  json.rawMetadata = JSON.stringify(raw);
  writeFileSync(clone.artifact, JSON.stringify(json));
  return coreAddressOf(keccak256(json.bytecode.object));
}

function writeDeployment(clone: Clone, name: string): string {
  const file = join(clone.deployments, name);
  writeFileSync(file, JSON.stringify(deploymentOf(chain), null, 2));
  return file;
}

const handId = () => String(raised.hand.handId);

describe("the trust anchor from a build of another source", () => {
  test("the clone's own build, fresh, is trusted as before", () => {
    const clone = freshClone();
    const run = clone.run(["verify", "--rpc", chain.rpc, handId()]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Core ${chain.core} (create2(factory, salt, initcode built in contracts/out))`);
  });

  test("with no deployment file, every command that trusts a Core refuses with core-check's sentence", () => {
    const clone = freshClone();
    const foreign = doctor(clone);
    expect(foreign).not.toBe(chain.core);
    const commands = [
      ["verify", "--rpc", chain.rpc, handId()],
      ["find", "--rpc", chain.rpc, "--raiser", raised.hand.raiser],
      ["inspect", "AQ", "--rpc", chain.rpc],
    ];
    for (const args of commands) {
      const run = clone.run(args);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`ahand: no Core to trust: ${STALE}`);
      expect(run.stdout + run.stderr).not.toContain(foreign);
    }
    const check = clone.run(["core-check", "--rpc", chain.rpc]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain(STALE);
  });

  test("with the chain's deployment file, that file is trusted, and the header says why", () => {
    const clone = freshClone();
    const foreign = doctor(clone);
    writeDeployment(clone, "31337.json");
    const run = clone.run(["verify", "--rpc", chain.rpc, handId()]);
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`Core ${chain.core} (contracts/deployments/31337.json: the deployment file of chain 31337; contracts/out is stale, so it was not used)`);
    expect(run.stdout).toContain("the contract is checked against contracts/deployments/31337.json");
    expect(run.stdout).not.toContain(foreign);
  });

  test("--core still decides on its own", () => {
    const clone = freshClone();
    doctor(clone);
    const run = clone.run(["verify", "--rpc", chain.rpc, "--core", chain.core, handId()]);
    expect(run.stdout).toContain(`Core ${chain.core} (given with --core)`);
    // No build of its own and no deployment file here: the contract is checked against the
    // canonical Core's build the SDK carries, which this test chain's Core is.
    expect(run.stdout).toContain("the contract is checked against the canonical Core's build");
    expect(run.stdout).toMatch(/^core\s+ok/m);
  });
});

describe("a stand slot's deployment file", () => {
  test("the only slot file of the chain is found by manifest and core-check, and named", () => {
    const clone = freshClone();
    writeDeployment(clone, "31337-slot3.json");
    const out = join(clone.dir, "m.json");
    const manifest = clone.run(["manifest", "31337", "--out", out]);
    expect(manifest.stderr).toBe("");
    expect(manifest.status).toBe(0);
    expect(manifest.stdout).toContain("deployment  contracts/deployments/31337-slot3.json (the only stand slot file of chain 31337; STAND_SLOT or --deployment choose another)");
    expect(JSON.parse(readFileSync(out, "utf8")).core).toBe(chain.core);

    const check = clone.run(["core-check", "--rpc", chain.rpc]);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("ok    the deployment file contracts/deployments/31337-slot3.json (the only stand slot file of chain 31337; STAND_SLOT or --deployment choose another)");
    expect(check.stdout).not.toContain("no deployment file");
  });

  test("STAND_SLOT chooses among several; without it, several are refused by name", () => {
    const clone = freshClone();
    writeDeployment(clone, "31337-slot3.json");
    writeDeployment(clone, "31337-slot5.json");
    const several = clone.run(["core-check", "--rpc", chain.rpc]);
    expect(several.status).toBe(2);
    expect(several.stderr).toContain("several stand slots have one (31337-slot3.json, 31337-slot5.json): set STAND_SLOT=N or give --deployment FILE");

    const five = clone.run(["core-check", "--rpc", chain.rpc], { STAND_SLOT: "5" });
    expect(five.status).toBe(0);
    expect(five.stdout).toContain("contracts/deployments/31337-slot5.json (stand slot 5, from STAND_SLOT)");

    const manifest = clone.run(["manifest", "31337", "--out", join(clone.dir, "m.json")], { STAND_SLOT: "3" });
    expect(manifest.status).toBe(0);
    expect(manifest.stdout).toContain("deployment  contracts/deployments/31337-slot3.json (stand slot 3, from STAND_SLOT)");

    const missing = clone.run(["manifest", "31337"], { STAND_SLOT: "7" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("STAND_SLOT=7 names contracts/deployments/31337-slot7.json, and there is no such file");

    const wrong = clone.run(["core-check", "--rpc", chain.rpc], { STAND_SLOT: "x" });
    expect(wrong.status).toBe(2);
    expect(wrong.stderr).toContain("STAND_SLOT is a stand slot from 0 to 9, not x");
  });

  test("the chain's own file comes before a lone slot file, and --deployment before both", () => {
    const clone = freshClone();
    writeDeployment(clone, "31337.json");
    writeDeployment(clone, "31337-slot3.json");
    const plain = clone.run(["manifest", "31337", "--out", join(clone.dir, "m.json")]);
    expect(plain.stdout).toContain("deployment  contracts/deployments/31337.json (the deployment file of chain 31337)");
    const named = join(scratch, "elsewhere.json");
    writeFileSync(named, JSON.stringify(deploymentOf(chain)));
    const given = clone.run(["manifest", "31337", "--deployment", named, "--out", join(clone.dir, "m.json")], { STAND_SLOT: "3" });
    expect(given.status).toBe(0);
    expect(given.stdout).toContain(`deployment  ${named} (given with --deployment)`);
  });

  test("without --out, the manifest lands next to the slot's file and is named after it", () => {
    const clone = freshClone();
    writeDeployment(clone, "31337-slot3.json");
    const run = clone.run(["manifest", "31337"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`wrote ${join(clone.deployments, "31337-slot3.manifest.json")}`);
    expect(JSON.parse(readFileSync(join(clone.deployments, "31337-slot3.manifest.json"), "utf8")).core).toBe(chain.core);
  });

  test("with no file at all, manifest says where it looked", () => {
    const clone = freshClone();
    const run = clone.run(["manifest", "31337"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("there is no deployment file for chain 31337 (neither contracts/deployments/31337.json nor a stand slot's): give --deployment FILE, or set STAND_SLOT=N for a stand");
  });
});
