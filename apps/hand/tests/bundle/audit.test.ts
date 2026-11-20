import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ANVIL_MNEMONIC, anvilKeys, audit, type AuditConfig } from "./audit.ts";

const publicConfig: AuditConfig = { chain: { rpcUrls: ["https://rpc.example.org/key"], local: false }, relays: ["wss://relay.example.org"], site: "https://hand.example.org" };
const meta = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />';

function folderWith(files: Record<string, string>): string {
  const folder = mkdtempSync(join(tmpdir(), "ahand-audit-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(folder, name, ".."), { recursive: true });
    writeFileSync(join(folder, name), text);
  }
  return folder;
}

describe("bundle audit", () => {
  test("anvil's first key is the well-known one", () => {
    expect(anvilKeys()[0]).toBe("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    expect(anvilKeys()).toHaveLength(10);
  });

  test("a clean build: configured addresses, library text and the CSP meta only", () => {
    const folder = folderWith({
      "index.html": `<head>${meta}</head>`,
      "gallery.html": `<head>${meta}</head>`,
      "assets/a.js": 'fetch("https://rpc.example.org/key");new WebSocket("wss://relay.example.org");"https://viem.sh/docs";"http://www.w3.org/2000/svg"',
    });
    try {
      expect(audit(folder, publicConfig).findings).toEqual([]);
    } finally {
      rmSync(folder, { recursive: true });
    }
  });

  test("a third-party origin, a source map, the mnemonic, a key and a missing meta are all found", () => {
    const folder = folderWith({
      "index.html": "<head></head>",
      "assets/a.js": `"https://cdn.tracker.example/x.js";"${ANVIL_MNEMONIC}";"0x${anvilKeys()[3]!.toUpperCase()}"\n//# sourceMappingURL=a.js.map`,
      "assets/a.js.map": "{}",
    });
    try {
      const whats = audit(folder, publicConfig).findings.map((finding) => finding.what);
      expect(whats).toContain("an address that is not the configured RPC, relay or site: https://cdn.tracker.example");
      expect(whats).toContain("a source map would ship");
      expect(whats).toContain("a sourceMappingURL comment");
      expect(whats).toContain("anvil's test mnemonic in a build that is not local");
      expect(whats).toContain("anvil's test key 3 in a build that is not local");
      expect(whats).toContain("no CSP meta tag");
    } finally {
      rmSync(folder, { recursive: true });
    }
  });

  test("a local build may carry the dev wallet's mnemonic", () => {
    const folder = folderWith({ "index.html": `<head>${meta}</head>`, "assets/dev.js": `"${ANVIL_MNEMONIC}"` });
    try {
      expect(audit(folder, { ...publicConfig, chain: { ...publicConfig.chain, local: true } }).findings).toEqual([]);
    } finally {
      rmSync(folder, { recursive: true });
    }
  });
});
