/**
 * Checks a downloaded passport bundle with the SDK, and prints the checks' ids, verdicts and
 * bases as JSON (proof.spec.ts runs it as a child process: spec files never import a workspace
 * package). With no RPC it is the SDK's `verifyBundle` (no network: events and views
 * read "recorded"); with `--rpc URL` it is `verifyBundleOnChain`, which re-reads them first.
 *
 *   bun tests/e2e/lib/proof-pages/verify-bundle.ts FILE [--rpc URL]
 *   → {"checks":[{"id":"core","verdict":"ok","basis":"recorded"},…]}
 */
import { readFileSync } from "node:fs";

import { verifyBundle, verifyBundleOnChain, type CheckVerdict } from "@ahand/sdk";
import { createPublicClient, http, type PublicClient } from "viem";

const [file, flag, rpc] = process.argv.slice(2);
if (!file || (flag !== undefined && (flag !== "--rpc" || !rpc))) {
  console.error("usage: bun tests/e2e/lib/proof-pages/verify-bundle.ts FILE [--rpc URL]");
  process.exit(2);
}
const json = readFileSync(file, "utf8");
const checks = rpc ? await verifyBundleOnChain(createPublicClient({ transport: http(rpc) }) as PublicClient, json) : await verifyBundle(json);
const verdict = (ok: CheckVerdict) => (ok === "not-checkable" || ok === "recorded" ? ok : ok ? "ok" : "fail");
console.log(JSON.stringify({ checks: checks.map((check) => ({ id: check.id, verdict: verdict(check.verdict), basis: check.basis })) }));
