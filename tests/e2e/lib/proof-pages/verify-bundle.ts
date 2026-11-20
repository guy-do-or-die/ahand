/**
 * Checks a downloaded passport bundle with the SDK's own `verifyBundle`, with no network, and
 * prints the checks' ids and verdicts as JSON (proof.spec.ts runs it as a child process: spec
 * files never import a workspace package, PLAN rule 9).
 *
 *   bun tests/e2e/lib/proof-pages/verify-bundle.ts FILE
 *   → {"checks":[{"id":"core","verdict":"ok"},…]}
 */
import { readFileSync } from "node:fs";

import { verifyBundle } from "@ahand/sdk";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun tests/e2e/lib/proof-pages/verify-bundle.ts FILE");
  process.exit(2);
}
const checks = await verifyBundle(readFileSync(file, "utf8"));
const verdict = (ok: boolean | "not-checkable") => (ok === "not-checkable" ? "not-checkable" : ok ? "ok" : "fail");
console.log(JSON.stringify({ checks: checks.map((check) => ({ id: check.id, verdict: verdict(check.ok) })) }));
