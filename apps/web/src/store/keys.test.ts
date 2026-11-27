import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "bun:test";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { TypedOutcome } from "../wallet/useTypedSigner";
import { closeDb, configureDb } from "./db";
import { repeatsOnDevice, unlock, type KeysTyped } from "./keys";

// anvil's first public test key: never a real key.
const raiser = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const core = getAddress("0x0f0555972388151d2c187f636a0855b6ee9b9685");

let run = 0;
afterEach(() => closeDb());
function fresh(): void {
  configureDb({ name: `ahand-keys-${process.pid}-${++run}` });
}

const answer = (signature: Hex): TypedOutcome => ({ ok: true, signature, kind: "code", wrapped: false });

describe("the keys confirmation's verdict", () => {
  test("a key's own signature that repeats gives the master", async () => {
    fresh();
    const outcome = await unlock(31337, core, raiser.address, async (typed: KeysTyped) => ({ ...answer(await raiser.signTypedData(typed)), kind: "key" }));
    expect(outcome.ok && outcome.unlocked.master).toMatch(/^0x[0-9a-f]{64}$/);
    expect(outcome.ok && outcome.unlocked.repeats).toBe(true);
    expect(outcome.ok && outcome.unlocked.notKey).toBeUndefined();
  });

  test("a signature that repeats but is not a key's: still 'repeats', no master, and notKey says why", async () => {
    fresh();
    // A smart account's fixed answer (a Safe's pre-approved form): the same every time.
    const fixed = `0x${raiser.address.slice(2).toLowerCase().padStart(64, "0")}${"00".repeat(32)}01` as Hex;
    const outcome = await unlock(31337, core, raiser.address, async () => answer(fixed));
    expect(outcome).toEqual({ ok: true, unlocked: { repeats: true, notKey: true } });
    expect(await repeatsOnDevice(raiser.address)).toBe(true);
  });

  test("answers that differ give no master and no notKey", async () => {
    fresh();
    let n = 0;
    const outcome = await unlock(31337, core, raiser.address, async () => answer(`0x${(++n).toString(16).padStart(2, "0").repeat(65)}` as Hex));
    expect(outcome).toEqual({ ok: true, unlocked: { repeats: false } });
  });

  test("any other failure is reported, never turned into a locked copy", async () => {
    fresh();
    const outcome = await unlock(31337, core, raiser.address, async () => answer("0x"));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.reason).toBe("failed");
  });
});
