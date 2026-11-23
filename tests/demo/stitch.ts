/**
 * Puts the personas' videos of one run side by side into one file (ffmpeg's hstack), each persona's
 * pages on one timeline (overlay), so a demo
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
const folders = readdirSync(dir).filter((name) => name.startsWith("video-")).sort((a, b) => startOf(a) - startOf(b));
if (folders.length === 0) throw new Error(`no video-<persona> folders in ${dir}: run with DEMO_VIDEO=1`);

/** A page's video: where it is, and when it started (its file's last write minus its length). */
interface Clip {
  file: string;
  start: number;
}

function seconds(file: string): number {
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  const value = Number(probe.stdout.trim());
  // Without a length the page could not be placed on the timeline: stop rather than guess.
  if (probe.status !== 0 || probe.stdout.trim() === "" || !Number.isFinite(value)) throw new Error(`ffprobe could not read the length of ${file}${probe.stderr ? `: ${probe.stderr.trim()}` : ""}`);
  return value;
}

/**
 * A persona's pages, oldest first. A persona may open a second page (exit.html in exit-thank): each
 * page has its own video, so they are laid on one timeline and the newer page covers the older
 * while it is open.
 */
function clipsOf(folder: string): Clip[] {
  return readdirSync(join(dir, folder))
    .filter((f) => f.endsWith(".webm"))
    .map((f) => join(dir, folder, f))
    .map((file) => ({ file, start: Bun.file(file).lastModified / 1000 - seconds(file) }))
    .sort((a, b) => a.start - b.start);
}

/** The persona order of the scenario is the order the contexts were made: the earliest page first. */
function startOf(folder: string): number {
  return clipsOf(folder)[0]?.start ?? 0;
}

const inputs: string[] = [];
const chains: string[] = [];
const outs: string[] = [];
folders.forEach((folder, p) => {
  const clips = clipsOf(folder);
  const first = clips[0]!.start;
  let label = "";
  clips.forEach((clip, j) => {
    const at = inputs.push(clip.file) - 1;
    const offset = Math.max(0, clip.start - first).toFixed(3);
    chains.push(`[${at}:v]setpts=PTS-STARTPTS+${offset}/TB[p${p}c${j}]`);
    if (j === 0) label = `p${p}c0`;
    else {
      chains.push(`[${label}][p${p}c${j}]overlay=eof_action=pass[p${p}o${j}]`);
      label = `p${p}o${j}`;
    }
  });
  outs.push(`[${label}]`);
});
const filter = [...chains, outs.length > 1 ? `${outs.join("")}hstack=inputs=${outs.length}[v]` : `${outs[0]}copy[v]`].join(";");
const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", filter, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", out], { stdio: "inherit" });
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(`${out} (${folders.map((f) => f.slice(6)).join(" | ")})`);
