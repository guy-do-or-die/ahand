/**
 * The documentation against the tree it describes. Each test holds one promise a page makes that
 * the code can break without anyone touching the page: the recipe for contracts/lib, the test-port
 * variables, the commands that need a deployment file, the words the app now says, the archive's
 * banner, the browser suites. Run from the root: `bun test docs/tests`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const README = read("README.md");

function walk(dir: string, keep: (path: string) => boolean, skip: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (skip(path)) continue;
    if (statSync(join(ROOT, path)).isDirectory()) out.push(...walk(path, keep, skip));
    else if (keep(path)) out.push(path);
  }
  return out.sort();
}

/** The pages this package writes: README.md and docs/**, less the archive, other packages' notes, the glossary, evidence and these tests. */
const OWN_PAGES = [
  "README.md",
  ...walk(
    "docs",
    (path) => path.endsWith(".md"),
    (path) => path === "docs/archive" || path === "docs/tests" || (path.startsWith("docs/build-notes/") && path !== "docs/build-notes/docs.md"),
  ).filter((path) => path !== "docs/glossary.md" && path !== "docs/evidence.md"),
];

/** The lines inside ``` blocks of a page. */
function codeLines(text: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) inside = !inside;
    else if (inside) lines.push(line);
  }
  return lines;
}

describe("a fresh clone builds from the README alone", () => {
  test("the README fetches contracts/lib with the libraries and versions CI fetches, before bun install", () => {
    const ci = read(".github/workflows/check.yml");
    const clones = [...ci.matchAll(/git clone --depth 1 --branch (\S+) (\S+) (contracts\/lib\/\S+)/g)];
    expect(clones.length).toBe(2);
    const install = README.indexOf("bun install");
    expect(install).toBeGreaterThan(0);
    for (const [, tag, url, dir] of clones) {
      const line = codeLines(README).find((l) => l.includes(`--branch ${tag} ${url} ${dir}`));
      expect(line, `README clones ${url} ${tag}`).toBeDefined();
      expect(README.indexOf(line!)).toBeLessThan(install);
    }
  });

  test("the README says .gitmodules is not the way in", () => {
    expect(README).toMatch(/`\.gitmodules`[^\n]*leftover/);
  });

  test("the README names every program the checks call: Bun, Foundry, jq, git", () => {
    const need = README.split("\n").find((line) => line.startsWith("You need"));
    expect(need).toBeDefined();
    for (const word of ["Bun 1.4.4", "Foundry 1.8.6", "jq", "git"]) expect(need!).toContain(word);
  });
});

describe("ports", () => {
  test("every port variable a test or the stand reads is named in the README", () => {
    const code = [
      ...["packages", "apps/hand", "apps/face", "infra/stand", "infra/relay", "tools", "contracts/exit"].flatMap((dir) =>
        walk(dir, (path) => /\.(ts|tsx|sh)$/.test(path), (path) => /(^|\/)(node_modules|dist|\.run|out|cache)$/.test(path)),
      ),
    ];
    const names = new Set<string>();
    for (const path of code) {
      for (const [name] of read(path).matchAll(/\b[A-Z][A-Z_]*(?:TEST_PORTS?|TEST_PORT_BASE|TEST_SLOTS|SELFTEST_PORT|STAND_PORT_BASE)\b/g)) names.add(name);
    }
    expect(names.size).toBeGreaterThan(5);
    const missing = [...names].filter((name) => !README.includes(`\`${name}\``) && !README.includes(`${name}=`));
    expect(missing).toEqual([]);
  });
});

describe("commands that need a deployment file", () => {
  test("manifest and core-check against a stand name the slot's file", () => {
    for (const page of ["README.md", "docs/deploy.md"]) {
      for (const line of codeLines(read(page))) {
        const stand = /ahand\.ts (manifest 31337|core-check --rpc http:\/\/127\.0\.0\.1)/.test(line);
        if (stand) expect(line, `${page}: ${line}`).toMatch(/--deployment contracts\/deployments\/31337-slot\d\.json|STAND_SLOT=\d/);
      }
    }
  });
});

describe("serving and dependencies", () => {
  const deploy = read("docs/deploy.md");

  test("deploy.md says what to put in front of face: cache, compression, the cap on cards", () => {
    const part = deploy.slice(deploy.indexOf("## In front of face"));
    expect(part.length).toBeGreaterThan(20);
    for (const word of ["max-age=300", "immutable", "no-cache", "brotli", "gzip", "503", "Retry-After", "Vary"]) expect(part).toContain(word);
  });

  test("every package bun audit flags is triaged, and the vitest UI is ruled out", () => {
    const part = deploy.slice(deploy.indexOf("## Advisories in dependencies"));
    for (const name of ["vitest", "tinypool", "vite", "esbuild", "postcss", "nanoid", "source-map-js", "ws", "zod", "fflate"]) {
      expect(part, name).toContain(`\`${name}\``);
    }
    expect(part).toMatch(/[Nn]ever run the vitest UI/);
  });
});

describe("the tree", () => {
  test("the README names the folders built for the earlier Core and says why they stay", () => {
    for (const dir of ["apps/web", "packages/subgraph", "infra/anvil", "infra/seed"]) {
      expect(existsSync(join(ROOT, dir))).toBe(true);
      expect(README).toContain(`\`${dir}\``);
    }
    expect(README).toMatch(/D-2[^\n]*D-6|D-6[^\n]*D-2/);
  });

  test("every browser suite at the top of tests/e2e is named in the README", () => {
    const specs = readdirSync(join(ROOT, "tests/e2e")).filter((name) => name.endsWith(".spec.ts"));
    expect(specs).toContain("shots.spec.ts");
    for (const spec of specs) expect(README, spec).toContain(`tests/e2e/${spec}`);
  });

  test("no page carries a test count that goes stale; docs/evidence.md is where counts live", () => {
    for (const page of OWN_PAGES.filter((path) => path !== "docs/build-notes/docs.md")) {
      expect(read(page), page).not.toMatch(/\d+ files?, \d+ tests/);
    }
  });
});

describe("words the app says", () => {
  const words = read("apps/hand/src/ui/words.ts");
  // The holder's lead-in, `deal.intro`, four spaces in; the asker's own card (`deal.asker.intro`) is nested deeper.
  const [en, ru] = [...words.matchAll(/^ {4}intro: "([^"]+)"/gm)].map((match) => match[1]!);

  test("pages quote the Deal card's lead-in as the app has it now", () => {
    expect(en).toBeDefined();
    expect(ru).toBeDefined();
    for (const page of OWN_PAGES.filter((path) => path !== "docs/build-notes/docs.md")) {
      const text = read(page);
      expect(text, page).not.toContain("Someone is looking for");
      expect(text, page).not.toContain("Кто-то ищет");
    }
    for (const page of ["README.md", "docs/how-it-works.md", "docs/app.md"]) expect(read(page), page).toContain(en!);
    expect(read("docs/ru/how-it-works.md")).toContain(ru!);
  });

  test("the receipt is what was sent, never who gets what", () => {
    for (const page of OWN_PAGES) expect(read(page), page).not.toMatch(/who gets what|кому сколько,/i);
  });

  test("no page says the app shows its limits: the /limits screen is gone and docs/limits.md is the reference", () => {
    // Decided by the owner on 2026-11-22: the app's "What it can't promise" screen was removed.
    expect(read("apps/hand/src/routes.ts")).not.toContain('"/limits"');
    for (const row of read("docs/app.md").split("\n").filter((line) => line.startsWith("| `/"))) expect(row).not.toContain("/limits");
    // A paragraph may still name the screen only to say it is gone: dated to the decision and saying so.
    // The glossary is checked too (evidence.md is a dated record and stays out).
    const names = /(^|[\s`(])\/limits\b|\blimits (page|screen)\b|(page|screen) [“"]What it can't promise/i;
    const saysGone = (paragraph: string) => paragraph.includes("2026-11-22") && /remov|not-found|no limits page|gone/i.test(paragraph);
    const stale: string[] = [];
    for (const page of [...OWN_PAGES, "docs/glossary.md"]) {
      for (const paragraph of read(page).split("\n")) {
        if (names.test(paragraph) && !saysGone(paragraph)) stale.push(`${page}: ${paragraph.slice(0, 80)}`);
      }
    }
    expect(stale).toEqual([]);
    expect(read("docs/limits.md")).not.toMatch(/key `limits\./);
  });

  test("the bundle is said to check its signatures and arithmetic offline, and amounts to need the chain", () => {
    expect(read("docs/how-it-works.md")).toContain("signatures and arithmetic with no network; amounts need the chain");
    expect(read("docs/ru/how-it-works.md")).toContain("подписи и арифметику без сети; суммы — только по сети");
  });
});

describe("links", () => {
  test("every relative link on these pages points at a file that exists", () => {
    const broken: string[] = [];
    for (const page of OWN_PAGES) {
      for (const [, target] of read(page).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target!)) continue;
        const path = target!.split("#")[0]!;
        if (!existsSync(resolve(ROOT, dirname(page), path))) broken.push(`${page} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("the archive", () => {
  const BANNER = "> **These pages describe an earlier Core. They are kept for history.**";

  test("every archived page starts with the banner", () => {
    const pages = walk("docs/archive/core-v2", (path) => path.endsWith(".md"));
    expect(pages.length).toBe(45);
    const bare = pages.filter((path) => !read(path).startsWith(BANNER));
    expect(bare).toEqual([]);
  });

  test("the banner's link reaches the current README from every depth", () => {
    for (const path of walk("docs/archive/core-v2", (p) => p.endsWith(".md"))) {
      const first = read(path).split("\n")[0]!;
      const link = /\]\(([^)]+)\)/.exec(first)?.[1];
      expect(link, path).toBeDefined();
      expect(relative(ROOT, resolve(ROOT, dirname(path), link!)), path).toBe("README.md");
    }
  });
});
