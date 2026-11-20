import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ANVIL_MNEMONIC, audit, type AuditConfig } from "./audit.ts";

/**
 * The main build itself (vite.config.ts), run three times on configurations written here:
 *  - chain 8453 marked local must not build at all (a local build carries anvil's public keys);
 *  - chain 8453, not local: no gallery.html, no gallery or dev wallet chunk, no mnemonic, and the
 *    bundle audit is clean;
 *  - chain 31337, local: the gallery and the dev wallet are there (the check above is not vacuous).
 * Each build writes into its own temporary folder with its own Vite cache.
 */

const app = resolve(import.meta.dirname, "../..");
const example = JSON.parse(readFileSync(join(app, "src/config/config.example.json"), "utf8")) as Record<string, unknown> & {
  chain: Record<string, unknown>;
  cores: { trusted: { chainId: number; core: string }[]; canonical: string | null };
};
const work = mkdtempSync(join(tmpdir(), "ahand-build-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function configOn(id: number, local: boolean) {
  return {
    ...example,
    chain: { ...example.chain, id, local, name: local ? "Local test network" : "Public test", rpcUrls: local ? example.chain.rpcUrls : ["https://rpc.ahand-test.example"] },
    cores: { ...example.cores, trusted: example.cores.trusted.map((entry) => ({ ...entry, chainId: id })) },
    relays: local ? example.relays : ["wss://relay.ahand-test.example"],
    site: local ? example.site : "https://hand.ahand-test.example",
  };
}

function build(name: string, config: unknown): { code: number; output: string; out: string } {
  const file = join(work, `${name}.json`);
  writeFileSync(file, JSON.stringify(config));
  const out = join(work, `${name}-out`);
  const run = Bun.spawnSync([join(app, "node_modules/.bin/vite"), "build"], {
    cwd: app,
    // bun test sets NODE_ENV=test, which would make Vite bundle React's development build.
    env: { ...process.env, NODE_ENV: "production", AHAND_CONFIG: file, AHAND_OUT_DIR: out, AHAND_VITE_CACHE: join(work, `${name}-cache`) },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: run.exitCode, output: `${run.stdout.toString()}${run.stderr.toString()}`, out };
}

function assetsOf(out: string): string[] {
  return readdirSync(join(out, "assets"));
}

describe("the main build", () => {
  test(
    "refuses chain 8453 marked local",
    () => {
      const { code, output, out } = build("base-local", configOn(8453, true));
      expect(code).not.toBe(0);
      expect(output).toContain("only chain 31337 (anvil) may be local");
      expect(existsSync(join(out, "index.html"))).toBe(false);
    },
    60_000,
  );

  test(
    "a public build has no gallery, no dev wallet and no mnemonic",
    () => {
      const config = configOn(8453, false);
      const { code, output, out } = build("base-public", config);
      expect(code, output).toBe(0);
      expect(existsSync(join(out, "index.html"))).toBe(true);
      expect(existsSync(join(out, "gallery.html"))).toBe(false);
      const assets = assetsOf(out);
      expect(assets.filter((name) => /^(gallery|dev)-/.test(name))).toEqual([]);
      for (const name of assets.filter((n) => n.endsWith(".js"))) expect(readFileSync(join(out, "assets", name), "utf8").includes(ANVIL_MNEMONIC)).toBe(false);
      expect(audit(out, config as AuditConfig).findings).toEqual([]);
    },
    120_000,
  );

  test(
    "a local build on 31337 carries the gallery and the dev wallet",
    () => {
      const { code, out } = build("anvil-local", configOn(31337, true));
      expect(code).toBe(0);
      expect(existsSync(join(out, "gallery.html"))).toBe(true);
      const assets = assetsOf(out);
      expect(assets.some((name) => name.startsWith("gallery-"))).toBe(true);
      expect(assets.some((name) => name.startsWith("dev-") && readFileSync(join(out, "assets", name), "utf8").includes(ANVIL_MNEMONIC))).toBe(true);
    },
    120_000,
  );
});
