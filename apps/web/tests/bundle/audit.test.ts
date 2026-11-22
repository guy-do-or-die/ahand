import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ANVIL_MNEMONIC, anvilKeys, audit, privySdkFiles, type AuditConfig } from "./audit.ts";

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

  test("a public build with the gallery or the dev wallet's chunk is found; a local one may carry them", () => {
    const folder = folderWith({ "index.html": `<head>${meta}</head>`, "gallery.html": `<head>${meta}</head>`, "assets/gallery-x1.js": "1", "assets/dev-x2.js": "2", "assets/index-x3.js": "3" });
    try {
      expect(audit(folder, publicConfig).findings.sort((a, b) => a.file.localeCompare(b.file))).toEqual([
        { file: "assets/dev-x2.js", what: "a local-only file in a build that is not local" },
        { file: "assets/gallery-x1.js", what: "a local-only file in a build that is not local" },
        { file: "gallery.html", what: "a local-only file in a build that is not local" },
      ]);
      expect(audit(folder, { ...publicConfig, chain: { ...publicConfig.chain, local: true } }).findings).toEqual([]);
    } finally {
      rmSync(folder, { recursive: true });
    }
  });

  test("Privy's SDK: the chunks only privy-host reaches are Privy's, and only a build with privy may carry them", () => {
    const folder = folderWith({
      "index.html": `<head>${meta}<script type="module" src="/assets/index-a.js"></script></head>`,
      // The app's entry names privy-host only in a dynamic import, and the SDK chunk only in a preload list.
      "assets/index-a.js": 'import{x}from"./shared-b.js";const __vite__mapDeps=["assets/sdk-c.js"];()=>import(`./privy-host-d.js`);',
      "assets/shared-b.js": '"https://viem.sh/docs"',
      "assets/privy-host-d.js": 'import{y}from"./sdk-c.js";import{x}from"./shared-b.js";',
      "assets/sdk-c.js": '"https://explorer-api.walletconnect.com";"https://auth.privy.io"',
    });
    try {
      expect([...privySdkFiles(folder)].sort()).toEqual(["assets/privy-host-d.js", "assets/sdk-c.js"]);
      expect(audit(folder, { ...publicConfig, privy: { appId: "clt69jwp204btq1o3q72cupji" } }).findings).toEqual([]);
      const without = audit(folder, publicConfig).findings;
      expect(without).toContainEqual({ file: "assets/sdk-c.js", what: "Privy's SDK in a build without privy" });
      expect(without).toContainEqual({ file: "assets/sdk-c.js", what: "an address that is not the configured RPC, relay or site: https://explorer-api.walletconnect.com" });
    } finally {
      rmSync(folder, { recursive: true });
    }
  });

  test("an address in a chunk a page loads is still a finding, even with privy", () => {
    const folder = folderWith({
      "index.html": `<head>${meta}<script type="module" src="/assets/index-a.js"></script></head>`,
      "assets/index-a.js": 'import{x}from"./both-b.js";()=>import("./privy-host-d.js");',
      "assets/privy-host-d.js": 'import{x}from"./both-b.js";',
      "assets/both-b.js": '"https://cdn.tracker.example/x.js"',
    });
    try {
      expect([...privySdkFiles(folder)]).toEqual(["assets/privy-host-d.js"]);
      expect(audit(folder, { ...publicConfig, privy: { appId: "clt69jwp204btq1o3q72cupji" } }).findings.map((f) => f.what)).toContain("an address that is not the configured RPC, relay or site: https://cdn.tracker.example");
    } finally {
      rmSync(folder, { recursive: true });
    }
  });
});
