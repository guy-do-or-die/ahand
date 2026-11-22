import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** apps/web/src, wherever the tests run from. */
export const SRC = join(import.meta.dirname, "..", "..", "src");

/** Every file under `dir` (relative to src, with forward slashes) whose name matches `pattern`. */
export function filesUnder(dir: string, pattern = /\.(ts|tsx|css)$/): string[] {
  const root = join(SRC, dir);
  const found: string[] = [];
  const walk = (at: string) => {
    let entries: string[];
    try {
      entries = readdirSync(at);
    } catch {
      return; // a folder another package has not written yet
    }
    for (const entry of entries) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (pattern.test(entry)) found.push(relative(SRC, path).split(sep).join("/"));
    }
  };
  walk(root);
  return found.sort();
}

export function source(file: string): string {
  return readFileSync(join(SRC, file), "utf8");
}

/** The source with comments blanked out (line and block), keeping line numbers and strings. */
export function code(file: string): string {
  const text = source(file);
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
    } else if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Each line of `text` that matches `pattern`, as "file:line: text". */
export function hits(file: string, text: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const lines = text.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    re.lastIndex = 0;
    if (re.test(line)) out.push(`${file}:${i + 1}: ${line.trim()}`);
  });
  return out;
}
