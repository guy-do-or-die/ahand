// `bun run check` in packages/abi (`bun run check:abi` at the root): regenerates src/generated.ts with
// @wagmi/cli (wagmi.config.ts) and fails when the file differs from what git holds for it (the index,
// which in CI is the commit), or when git does not hold it at all. @wagmi/cli has no check mode of its
// own. A record in contracts/deployments that names another Core fails earlier, in the generation.
// Build the contracts first: bun run build:contracts at the root.
import { join } from "node:path";

const PACKAGE = join(import.meta.dirname, "..");
/** wagmi.config.ts's `out`: the one file @wagmi/cli writes. */
const GENERATED = "src/generated.ts";

function run(command: string[], quiet = false): string {
  const result = Bun.spawnSync(command, { cwd: PACKAGE, stdout: "pipe", stderr: "pipe" });
  const output = result.stdout.toString() + result.stderr.toString();
  if (result.exitCode !== 0) {
    console.error(`${command.join(" ")} failed:\n${output}`);
    process.exit(1);
  }
  if (!quiet) process.stdout.write(output);
  return result.stdout.toString();
}

run(["bunx", "--bun", "wagmi", "generate"], true);
// " M" changed in the tree, "??" not in git: anything whose second column is not a space.
const stale = run(["git", "status", "--porcelain=v1", "--untracked-files=all", "--", GENERATED], true)
  .split("\n")
  .filter((line) => line.length > 0 && line[1] !== " ");
if (stale.length > 0) {
  run(["git", "--no-pager", "diff", "--stat", "--", GENERATED]);
  console.error(
    `packages/abi/${GENERATED} is stale or not in git (${stale.join(", ")}): it now holds what contracts/out ` +
      "and contracts/deployments give; review it and commit it.",
  );
  process.exit(1);
}
console.log(`packages/abi/${GENERATED} is up to date with contracts/out and contracts/deployments`);
