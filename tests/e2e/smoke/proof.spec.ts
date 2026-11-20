/**
 * The verifier's three pages in a real browser against the stand's chain (PLAN wave 5,
 * proof-pages; UX-SPEC §10):
 *
 *   STAND_SLOT=4 bunx playwright test tests/e2e/smoke/proof.spec.ts
 *
 * Fixtures, made in beforeAll and used by this file only: the seed's `thanked` and `refunded`
 * Hands and its `twoPasses` live address. The passport's verdicts are compared with the SDK's own
 * `verifyBundle` run in a child process over the bundle the page downloaded; /core's derived
 * address with the Core in stand.json; /check's DOM is searched for the live link's seed in three
 * forms (craft.ts `secrets`).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { getAddress } from "viem";

import { readStand, runProgram, seed, standSlot, type StandInfo } from "../lib/stand";

test.describe.configure({ mode: "serial" });

interface HandFixture {
  handId: string;
  address: string;
}
interface SeedRun {
  fixtures: { thanked: HandFixture; refunded: HandFixture; twoPasses: HandFixture; give: HandFixture & { giveAddress: string } };
}
interface Line {
  id: string;
  verdict: string;
  mark: string;
}

let stand: StandInfo;
let fixtures: SeedRun["fixtures"];

test.beforeAll(() => {
  stand = readStand();
  fixtures = seed<SeedRun>(standSlot(), ["refunded", "thanked", "twoPasses", "give"]).fixtures;
});

/** Opens a passport and waits until every line has ticked in. */
async function openPassport(page: Page, handId: string): Promise<Line[]> {
  await page.goto(`/${stand.chainId}/${handId}/proof`);
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  return linesOf(page);
}

async function linesOf(page: Page): Promise<Line[]> {
  return page.getByTestId("proof-check").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-value") ?? "",
      verdict: node.getAttribute("data-verdict") ?? "",
      mark: node.getAttribute("data-mark") ?? "",
    })),
  );
}

test("the thanked Hand's passport: every line carries a mark, none failed, the giveHash matches Core", async ({ page }) => {
  const lines = await openPassport(page, fixtures.thanked.handId);
  expect(lines.length).toBeGreaterThan(10);
  for (const line of lines) {
    expect(["ok", "not-checkable"], `${line.id} is ${line.verdict}`).toContain(line.verdict);
    expect(["checked", "chain", "waiting"]).toContain(line.mark);
  }
  // Each line shows its mark's words (the three marks never look alike: ✓ / ⛓ / ⏳ and their words).
  const checks = page.getByTestId("proof-check");
  for (let index = 0; index < lines.length; ++index) await expect(checks.nth(index).locator(".ah-mark")).toHaveCount(1);
  // A line that can't be checked says so in words and is never a finding.
  await expect(page.locator(".proof-finding")).toHaveCount(0);
  for (const line of lines.filter((l) => l.verdict === "not-checkable")) {
    await expect(page.locator(`[data-value="${line.id}"] .proof-nc`)).toBeVisible();
  }
  const ids = lines.map((line) => line.id);
  expect(ids.slice(0, 4)).toEqual(["core", "raised", "reward-time", "description"]);
  expect(ids).toContain("give-hash");
  expect(lines.find((line) => line.id === "core")!.verdict).toBe("ok"); // the stand's deployment facts derive its Core
  await expect(page.getByTestId("proof-givehash-matches")).toBeVisible();
  await expect(page.getByTestId("proof-givehash-matches")).toHaveText(/giveHash matches Core/i);
  await expect(page.getByTestId("proof-givehash-matches")).toHaveCSS("text-transform", "uppercase");

  // "Check it all again" re-runs and ticks the same lines in order.
  await page.getByTestId("proof-again").click();
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "false");
  await expect(page.getByTestId("proof-tally")).toHaveAttribute("data-done", "true", { timeout: 30_000 });
  expect((await linesOf(page)).map((line) => [line.id, line.verdict])).toEqual(lines.map((line) => [line.id, line.verdict]));

  // "Check it without this site": the CLI over a clone, with this chain, Core, number and commit.
  await page.getByTestId("proof-without-site").getByRole("button").first().click();
  const verify = (await page.getByTestId("proof-verify-line").textContent()) ?? "";
  expect(verify).toContain("bun tools/ahand.ts verify");
  expect(verify).toContain(`--rpc ${stand.rpc}`);
  expect(verify).toContain(`--core ${getAddress(stand.core)}`);
  expect(verify).toMatch(new RegExp(` ${fixtures.thanked.handId}$`));
  expect(verify).toMatch(/git checkout [0-9a-f]{40} /);
  expect(verify).not.toMatch(/\bnpx\b|\bbunx\b|npm i/);
});

test("the downloaded bundle, checked by the SDK in a child process, gives the page's ids and verdicts", async ({ page }) => {
  const lines = await openPassport(page, fixtures.thanked.handId);
  const download = page.waitForEvent("download");
  await page.getByTestId("proof-download").click();
  const file = join(mkdtempSync(join(tmpdir(), "ahand-proof-")), (await download).suggestedFilename());
  expect(file).toMatch(new RegExp(`ahand-proof-${stand.chainId}-${fixtures.thanked.handId}\\.json$`));
  await (await download).saveAs(file);
  const { stdout } = runProgram("tests/e2e/lib/proof-pages/verify-bundle.ts", [file]);
  const fromBundle = (JSON.parse(stdout) as { checks: { id: string; verdict: string }[] }).checks;
  expect(fromBundle).toEqual(lines.map(({ id, verdict }) => ({ id, verdict })));
});

test("the refunded Hand's passport is the short list, ending in the refund", async ({ page }) => {
  const lines = await openPassport(page, fixtures.refunded.handId);
  const sections = await page.locator(".proof-section").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-section")));
  expect(sections).toEqual(["core", "raised", "reward-time", "description", "back"]);
  expect(lines.slice(0, 4).map((line) => line.id)).toEqual(["core", "raised", "reward-time", "description"]);
  expect(lines[4]!.id).toBe("refunded");
  expect(lines.some((line) => line.id.startsWith("route.") || line.id === "give-hash")).toBe(false);
  for (const line of lines) expect(line.verdict).not.toBe("fail");
  await expect(page.locator('.proof-section[data-section="back"] .proof-section__title')).toHaveText(/The reward went back/);
  // "Print the receipt" leads to /print's receipt of this Hand.
  await page.getByTestId("proof-print").click();
  await expect(page).toHaveURL(new RegExp(`/print\\?receipt=\\d+/${fixtures.refunded.handId}$`));
  await expect(page.getByTestId("print-receipt")).toBeVisible();
});

test("/check ticks every step of a live address, agrees with Core, and never holds the seed", async ({ page }) => {
  const secrets = JSON.parse(runProgram("tests/e2e/lib/craft.ts", ["secrets", fixtures.twoPasses.address, "--slot", String(standSlot())]).stdout) as {
    hex: string;
    base64url: string;
    digits: string;
  };
  await page.goto("/check");
  await page.getByTestId("check-input").fill(fixtures.twoPasses.address);
  await page.getByTestId("check-run").click();
  await expect(page.getByTestId("check-input")).toHaveValue("");

  await expect(page.getByTestId("check-ruler")).toBeVisible();
  await expect(page.locator('.check-ruler__seg[data-kind="secret"]')).toHaveCount(1);
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-value", "accepted");
  await expect(page.getByTestId("check-agree")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("check-finding")).toHaveCount(0);
  const statuses = await page.getByTestId("check-step").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status")));
  expect(statuses).toEqual(Array(6).fill("pass")); // two passes × three of Core's checks each

  const dom = await page.content();
  const values = await page.locator("input, textarea").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value).join("\n"));
  const text = `${dom}\n${values}`;
  const hex = secrets.hex.replace(/^0x/, "").toLowerCase();
  expect(text.toLowerCase().includes(hex), "seed as hex").toBe(false);
  expect(text.includes(secrets.base64url), "seed as base64url").toBe(false);
  expect(text.includes(secrets.digits), "seed as digits").toBe(false);
  // Nor the link itself: the box was emptied and nothing renders it.
  expect(text.includes(fixtures.twoPasses.address.split("#")[1]!)).toBe(false);
});

test("/check: an answer whose helper confirmation was altered fails at the same step here and in Core", async ({ page }) => {
  const tampered = (JSON.parse(runProgram("tests/e2e/lib/craft.ts", ["tamper", fixtures.give.giveAddress, "--how", "giver-sig", "--slot", String(standSlot())]).stdout) as { address: string })
    .address;
  await page.goto("/check");
  await page.getByTestId("check-input").fill(tampered);
  await page.getByTestId("check-run").click();
  await expect(page.getByTestId("check-core-answer")).toHaveAttribute("data-value", "InvalidGiverSig", { timeout: 30_000 });
  await expect(page.getByTestId("check-agree")).toBeVisible({ timeout: 15_000 });
  const steps = await page.getByTestId("check-step").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-check"), node.getAttribute("data-status")]));
  expect(steps.at(-1)).toEqual(["InvalidGiverSig", "fail"]);
  expect(steps.slice(0, -1).every(([, status]) => status === "pass")).toBe(true);
});

test("/core derives the Core in use, lists the twelve limits, and labels the served build", async ({ page, request }) => {
  await page.goto("/core");
  await expect(page.getByTestId("core-address")).toHaveText(getAddress(stand.core));
  const derivation = page.getByTestId("core-derivation");
  await expect(derivation).toHaveAttribute("data-match", "true");
  await expect(derivation).toHaveAttribute("data-value", getAddress(stand.core));
  await expect(page.getByTestId("core-cap")).toHaveAttribute("data-value", String(180 * 86_400), { timeout: 15_000 });
  await expect(page.getByTestId("core-domain")).toContainText(getAddress(stand.core));
  await expect(page.getByTestId("core-commit")).toHaveAttribute("data-value", /^[0-9a-f]{40}$/);
  await expect(page.getByTestId("core-limits").locator("li")).toHaveCount(12);
  await expect(page.getByTestId("core-limits")).toContainText("Thanking is voluntary.");
  await expect(page.getByTestId("core-limits")).toContainText("Gas-heavy refund");
  await expect(page.getByTestId("core-command")).toContainText("cast\" keccak");
  await expect(page.getByTestId("core-unaudited")).toHaveText(
    "Unaudited: seven AI reviews and one AI scan found no defect; no professional audit has been done.",
  );
  // A built stand serves /build.json and the page shows its hash; a dev stand serves none and says so.
  const served = await request.get("/build.json");
  const isJson = served.ok() && (served.headers()["content-type"] ?? "").includes("json");
  const real = isJson ? ((await served.json()) as { hash?: unknown }).hash : undefined;
  if (typeof real === "string") {
    await expect(page.getByTestId("core-build-hash")).toHaveAttribute("data-state", "served");
    await expect(page.getByTestId("core-build-value")).toHaveText(real);
  } else {
    await expect(page.getByTestId("core-build-hash")).toHaveAttribute("data-state", "none");
    await expect(page.getByTestId("core-build-hash")).toContainText("There is no build to hash");
  }

  // With /build.json served, the hash stands with its label.
  const hash = "5e".repeat(32);
  await page.route("**/build.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hash, command: "sha256sum", commit: null, dirty: false, files: [] }) }),
  );
  await page.reload();
  await expect(page.getByTestId("core-build-hash")).toHaveAttribute("data-state", "served");
  await expect(page.getByTestId("core-build-label")).toHaveText(/served by this site/i);
  await expect(page.getByTestId("core-build-value")).toHaveText(hash);
});
