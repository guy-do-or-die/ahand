/**
 * The catalogue as a page with a video of every scenario, for one branch: a fresh stand, every
 * stand scenario recorded without windows (the director's captions and badges, Playwright's
 * cursor), each scenario's phones stitched side by side, and one static page that lists them with
 * their story, people, steps and checks. Nothing in it needs a server: open
 * tests/demo/.gallery/index.html, or put the folder on any static host.
 *
 *   bun tests/demo/gallery.ts [--ru] [--only a,b] [--speed 2] [--page-only]
 *
 * --page-only writes the page from the videos already in the folder (no stand, no recording).
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { slotInUse } from "../../infra/stand/stand.ts";
import { describe, name } from "./catalogue.ts";
import { captionIn, LANG, nameIn, roleIn, titleOf } from "./engine/lang.ts";
import type { Scenario } from "./engine/scenario.ts";
import { captionOf } from "./engine/verbs.ts";
import { SCENARIOS } from "./scenarios/index.ts";

const REPO = resolve(import.meta.dirname, "../..");
const OUT = join(REPO, "tests/demo/.gallery");
const argv = process.argv.slice(2);
const value = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const lang = argv.includes("--ru") ? "ru" : "en";
const only = value("--only")?.split(",");
const onStand = SCENARIOS.filter((s) => s.targets.includes("stand"));
// --only records some again; the page always lists every stand scenario with the videos it has.
const chosen = onStand.filter((s) => !only || only.includes(s.id));
const env: Record<string, string> = { ...(process.env as Record<string, string>), STAND_PORT_BASE: process.env.STAND_PORT_BASE ?? "47000", DEMO_LANG: lang };
const bun = process.execPath;
const run = (command: string, args: string[], extra: Record<string, string> = {}) => spawnSync(command, args, { cwd: REPO, env: { ...env, ...extra }, stdio: "inherit" }).status ?? 1;
/** What went wrong in this run; the page is still written, then the run fails. */
const failures: string[] = [];
const videoName = (id: string) => `${id}.${lang}.mp4`;

async function record(): Promise<void> {
  process.env.STAND_PORT_BASE = env.STAND_PORT_BASE;
  let slot = -1;
  for (let s = 1; s <= 8 && slot < 0; s++) if ((await slotInUse(s)).length === 0) slot = s;
  if (slot < 0) throw new Error("no free stand slot from 1 to 8");
  if (run(bun, ["infra/stand/stand.ts", "up", "--slot", String(slot)]) !== 0) throw new Error("the stand did not come up");
  const output = join(REPO, "tests/demo/test-results", `gallery-${lang}`);
  let played = 1;
  try {
    played = run(bun, ["x", "playwright", "test", "-c", "playwright.demo.config.ts", "tests/demo/scenarios.spec.ts", "--output", output, "--reporter", "list"], {
      DEMO: "1",
      DEMO_HEADLESS: "1",
      DEMO_VIDEO: "1",
      DEMO_SPEED: value("--speed") ?? "2",
      DEMO_ONLY: chosen.map((s) => s.id).join(","),
      STAND_SLOT: String(slot),
      // The trace is not part of a gallery.
      DEMO_TRACE: "0",
    });
  } finally {
    run(bun, ["infra/stand/stand.ts", "down", "--slot", String(slot)]);
  }
  if (played !== 0) failures.push(`a scenario failed (Playwright exited ${played}): its error is in the log above, its videos in ${output}`);
  // Each test's folder starts with "scenarios-<id>-": stitch its phones into one video.
  mkdirSync(join(OUT, "videos"), { recursive: true });
  const folders = existsSync(output) ? readdirSync(output).map((n) => join(output, n)).filter((p) => statSync(p).isDirectory()) : [];
  for (const s of chosen) {
    // play.ts writes the scenario's id into its test folder (scenario.id) when it records.
    const folder = folders.find((f) => existsSync(join(f, "scenario.id")) && readFileSync(join(f, "scenario.id"), "utf8").trim() === s.id);
    if (!folder) {
      console.log(`gallery: no video for ${s.id} (it failed or was skipped)`);
      failures.push(`no video for ${s.id}`);
      continue;
    }
    if (run(bun, ["tests/demo/stitch.ts", folder, join(OUT, "videos", videoName(s.id))]) !== 0) {
      console.log(`gallery: stitching ${s.id} failed`);
      failures.push(`stitching ${s.id}`);
    }
  }
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function card(s: Scenario): string {
  const { title, story } = titleOf(s);
  const video = existsSync(join(OUT, "videos", videoName(s.id)));
  const people = Object.values(s.personas).map((p) => `<span class="who">${esc(nameIn(p.name))} · ${esc(roleIn(p.role))}</span>`).join(" ");
  const steps = s.steps
    .map((step) => {
      const caption = captionIn(step, step.who ? s.personas[step.who]!.name : undefined, captionOf);
      const checks = [...(step.form ?? []).map((e) => `${lang === "ru" ? "до свайпа" : "before the swipe"}: ${describe(e)}`), ...(step.expect ?? []).map(describe)];
      return `<li>${esc(caption)}${checks.length ? `<ul>${checks.map((c) => `<li class="check">${esc(c)}</li>`).join("")}</ul>` : ""}</li>`;
    })
    .join("");
  const end = s.checks.map((c) => ("state" in c ? `Hand "${c.hand}" is ${c.state}` : "received" in c ? `${name(s.personas, c.received)} received ${c.amount}` : `the asker of "${c.askerWhole}" has the whole reward back`));
  return `<article id="${s.id}">
  <h2>${esc(title)}</h2><p class="id">${s.id} · ${s.covers.map(esc).join(", ")}</p>
  <p>${esc(story)}</p><p>${people}</p>
  ${video ? `<video controls preload="metadata" src="videos/${videoName(s.id)}"></video>` : `<p class="none">${lang === "ru" ? "ролика нет" : "no video"}</p>`}
  <details><summary>${lang === "ru" ? "Шаги и проверки" : "Steps and checks"}</summary><ol>${steps}</ol>
  <p><b>${lang === "ru" ? "В сети в конце" : "On the chain at the end"}:</b> ${end.map(esc).join("; ")}</p></details>
</article>`;
}

function page(): string {
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: REPO, encoding: "utf8" }).trim();
  const branch = process.env.GITHUB_REF_NAME ?? git("rev-parse --abbrev-ref HEAD");
  const commit = git("rev-parse --short HEAD");
  const heading = lang === "ru" ? "aHand: сценарии" : "aHand: scenarios";
  return `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title>
<style>
:root{--bg:#faf8f2;--ink:#16181d;--mute:#5b6070;--card:#fff;--line:#e4e0d4;--accent:#f5b82e}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--ink:#e8e8e8;--mute:#9aa0ad;--card:#171a20;--line:#2a2f38}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:1240px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px}header p{color:var(--mute);margin:0 0 20px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 18px}
h2{margin:0;font-size:19px}.id{color:var(--mute);font:12px ui-monospace,monospace;margin:2px 0 8px}
.who{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-size:13px;margin:0 4px 4px 0}
video{width:100%;border-radius:8px;background:#000;margin:6px 0}
.check{color:var(--mute);font-size:13px}.none{color:var(--mute)}
nav{columns:2 260px;margin:0 0 20px}nav a{color:var(--ink)}
</style>
<main><header><h1>${heading}</h1><p>${esc(branch)} · ${commit} · ${new Date().toISOString().slice(0, 10)} · ${onStand.length} ${lang === "ru" ? "сценариев, сыграны движком на свежем стенде" : "scenarios, played by the engine on a fresh stand"}</p></header>
<nav>${onStand.map((s) => `<a href="#${s.id}">${esc(titleOf(s).title)}</a><br>`).join("")}</nav>
${onStand.map(card).join("\n")}
</main></html>
`;
}

// The language is read when the engine's modules load: with --ru, start again with DEMO_LANG=ru.
if (LANG !== lang) process.exit(spawnSync(bun, [import.meta.filename, ...argv], { cwd: REPO, env, stdio: "inherit" }).status ?? 1);
if (!argv.includes("--page-only")) await record();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, lang === "ru" ? "ru.html" : "index.html"), page());
console.log(`gallery: ${join(OUT, lang === "ru" ? "ru.html" : "index.html")} (${readdirSync(join(OUT, "videos")).filter((f) => f.endsWith(`.${lang}.mp4`)).length} videos)`);
if (failures.length) {
  console.error(`gallery: ${failures.length} problem(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
