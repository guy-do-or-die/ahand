import { spawn } from "bun";
import { writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT_DIR = join(import.meta.dirname, "../../");
const ABI_SRC_DIR = join(ROOT_DIR, "packages/abi/src");

async function waitRpc(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      });
      if (res.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  console.log("Starting anvil --chain-id 31337...");
  const anvil = spawn(["anvil", "--chain-id", "31337"], {
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  process.on("SIGINT", () => {
    console.log("Killing anvil...");
    anvil.kill();
    process.exit(0);
  });

  const rpcUrl = "http://127.0.0.1:8545";
  console.log("Waiting for RPC to become available...");
  if (!(await waitRpc(rpcUrl))) {
    console.error("RPC did not become available in time");
    anvil.kill();
    process.exit(1);
  }
  console.log("RPC is up. Deploying contracts...");

  // Run forge script
  const deployProc = spawn([
    "forge", "script", "script/Deploy.s.sol",
    "--rpc-url", rpcUrl,
    "--private-key", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "--broadcast"
  ], {
    cwd: join(ROOT_DIR, "contracts"),
  });

  const deployOutput = await new Response(deployProc.stdout).text();
  console.log(deployOutput);

  // Parse addresses
  const addresses: Record<string, string> = {};
  const lines = deployOutput.split("\n");
  for (const line of lines) {
    if (line.includes("AHandCore :")) {
      addresses.AHandCore = line.split("AHandCore :")[1].trim();
    } else if (line.includes("Signals   :")) {
      addresses.AHandSignals = line.split("Signals   :")[1].trim();
    } else if (line.includes("Anchor    :")) {
      addresses.StaticAnchor = line.split("Anchor    :")[1].trim();
    } else if (line.includes("Witness   :")) {
      addresses.AHandWitness = line.split("Witness   :")[1].trim();
    } else if (line.includes("mockUSD   :")) {
      addresses.mockUSD = line.split("mockUSD   :")[1].trim();
    } else if (line.includes("charity   :")) {
      addresses.charity = line.split("charity   :")[1].trim();
    } else if (line.includes("maintainer:")) {
      addresses.maintainer = line.split("maintainer   :")[1]?.trim() || line.split("maintainer:")[1].trim();
    }
  }

  console.log("Parsed Deployed Addresses:", addresses);
  if (!addresses.AHandCore || !addresses.AHandSignals) {
    console.error("Failed to parse deployed addresses from deploy output");
    anvil.kill();
    process.exit(1);
  }

  writeFileSync(join(ABI_SRC_DIR, "addresses.json"), JSON.stringify(addresses, null, 2));
  console.log("Written addresses to packages/abi/src/addresses.json");

  // Re-run ABI generation to include addresses
  console.log("Updating ABI packages...");
  const genProc = spawn(["bun", "run", "generate"], { cwd: join(ROOT_DIR, "packages/abi") });
  await genProc.exited;

  const buildProc = spawn(["bunx", "tsc", "--project", "packages/abi/tsconfig.json"], { cwd: ROOT_DIR });
  await buildProc.exited;

  console.log("ABI packages compiled successfully. Stand is fully ready and running!");

  // Keep process alive and wait for anvil exit
  await anvil.exited;
}

main().catch(console.error);
