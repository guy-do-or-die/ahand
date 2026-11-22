/**
 * Puts the personas' videos of one run side by side into one file (ffmpeg's hstack), so a demo
 * recorded headless reads like the live show: one phone per persona, in the scenario's order.
 *
 *   bun tests/demo/stitch.ts <test result folder> [out.mp4]
 *
 * The folder is the one Playwright wrote for a test run with DEMO_VIDEO=1; it holds video-<persona>/.
 * Needs a full ffmpeg on PATH (Playwright's own build only encodes VP8/VP9).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "");
const out = resolve(process.argv[3] ?? join(dir, "demo.mp4"));
const folders = readdirSync(dir).filter((name) => name.startsWith("video-")).sort((a, b) => order(a) - order(b));
if (folders.length === 0) throw new Error(`no video-<persona> folders in ${dir}: run with DEMO_VIDEO=1`);
const inputs = folders.map((folder) => join(dir, folder, readdirSync(join(dir, folder)).find((f) => f.endsWith(".webm"))!));

/** The persona order of the scenario is the order the contexts were made: the oldest file first. */
function order(folder: string): number {
  const file = readdirSync(join(dir, folder)).find((f) => f.endsWith(".webm"))!;
  return Bun.file(join(dir, folder, file)).lastModified;
}

const filter = inputs.length > 1 ? `${inputs.map((_, i) => `[${i}:v]`).join("")}hstack=inputs=${inputs.length}[v]` : "[0:v]copy[v]";
const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", filter, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", out], { stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(`${out} (${folders.map((f) => f.slice(6)).join(" | ")})`);
