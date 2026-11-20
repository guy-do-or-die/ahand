import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

/**
 * Compression of what face sends: brotli or gzip by the request's Accept-Encoding, for text only
 * (a PNG or a font is compressed already). Nothing is written to disk: the build's folder stays
 * exactly as built, so build.json and its published hash do not move. The files of the build are
 * compressed once, at the strongest setting, on the libuv thread pool, and held in memory; a page
 * face writes per request (index.html with a Hand's tags) is compressed per response at a fast
 * setting.
 */

export type Coding = "br" | "gzip";

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

/** Below this a compressed answer saves less than its own headers cost. */
export const MIN_BYTES = 1_024;

const TEXT = /^(?:text\/|application\/(?:json|javascript|manifest\+json|wasm|xml)|image\/svg\+xml)/;

export function compressible(type: string, length: number): boolean {
  return length >= MIN_BYTES && TEXT.test(type);
}

/**
 * The coding to answer with, from Accept-Encoding: brotli, else gzip, each unless refused with
 * q=0 (a `*` stands for any coding not named). Undefined means the bytes as they are.
 */
export function codingFor(acceptEncoding: string | string[] | undefined): Coding | undefined {
  const header = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : (acceptEncoding ?? "");
  const q = new Map<string, number>();
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    let weight = 1;
    for (const param of params) {
      const [k, v] = param.trim().split("=");
      if (k === "q") weight = Number(v);
    }
    q.set(name, Number.isFinite(weight) ? weight : 0);
  }
  const accepted = (coding: Coding) => (q.get(coding) ?? q.get("*") ?? 0) > 0;
  if (accepted("br")) return "br";
  if (accepted("gzip")) return "gzip";
  return undefined;
}

export function compress(bytes: Uint8Array, coding: Coding, strength: "fast" | "best"): Promise<Buffer> {
  if (coding === "br") {
    return brotli(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: strength === "best" ? 11 : 5,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
      },
    });
  }
  return gzipped(bytes, { level: strength === "best" ? 9 : 6 });
}

/**
 * The compressed forms of the build's files, made on first use (or by `warm`) and kept while the
 * file on disk keeps its size and modification time. A file replaced in place is compressed anew.
 */
export function fileCompressor() {
  const memory = new Map<string, { size: number; mtimeMs: number; coded: Partial<Record<Coding, Promise<Buffer>>> }>();

  async function compressed(path: string, bytes: Uint8Array, coding: Coding): Promise<Buffer> {
    const { size, mtimeMs } = await stat(path);
    let entry = memory.get(path);
    if (!entry || entry.size !== size || entry.mtimeMs !== mtimeMs) {
      entry = { size, mtimeMs, coded: {} };
      memory.set(path, entry);
    }
    let coded = entry.coded[coding];
    if (!coded) {
      coded = compress(bytes, coding, "best");
      const held = entry;
      coded.catch(() => delete held.coded[coding]);
      entry.coded[coding] = coded;
    }
    return coded;
  }

  /**
   * Compresses every text file of the folder, one at a time in the background, so the first
   * visitor does not wait for the strongest setting. Failures are left for first use to meet.
   */
  async function warm(dist: string, typeOf: (path: string) => string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dist, { recursive: true });
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dist, name);
      try {
        const bytes = await readFile(path);
        if (!compressible(typeOf(path), bytes.byteLength)) continue;
        await compressed(path, bytes, "br");
        await compressed(path, bytes, "gzip");
      } catch {
        // A folder, a file gone meanwhile, or one that would not compress: first use decides.
      }
    }
  }

  return { compressed, warm };
}
