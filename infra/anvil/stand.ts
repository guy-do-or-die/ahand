import { spawn, type Subprocess } from "bun";
import { writeFileSync } from "fs";
import { join } from "path";
import { deployAaContracts } from "./aa/deploy";
import { startAaStack, type AaStack } from "./aa/stack";

const ROOT_DIR = join(import.meta.dirname, "../../");
const ABI_SRC_DIR = join(ROOT_DIR, "packages/abi/src");

async function rpcUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitRpc(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await rpcUp(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  const rpcUrl = "http://127.0.0.1:8545";
  let anvil: Subprocess | null = null;
  let aaStack: AaStack | null = null;

  // Adopt an already-running node on :8545 (e.g. an anvil the owner keeps in
  // their IDE); otherwise spawn our own. Never fight over the port.
  if (await rpcUp(rpcUrl)) {
    console.log("RPC already live on :8545 — adopting the running anvil.");
  } else {
    console.log("Starting anvil --chain-id 31337...");
    anvil = spawn(["anvil", "--chain-id", "31337"], {
      cwd: ROOT_DIR,
      stdout: "inherit",
      stderr: "inherit",
    });
    console.log("Waiting for RPC to become available...");
    if (!(await waitRpc(rpcUrl))) {
      console.error("RPC did not become available in time");
      anvil.kill();
      process.exit(1);
    }
  }

  const shutdown = () => {
    console.log("Shutting down stand...");
    const stack = aaStack;
    aaStack = null;
    void (stack ? stack.stop() : Promise.resolve()).finally(() => {
      anvil?.kill();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
    anvil?.kill();
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

  console.log("ABI packages compiled.");

  // ---- Account-abstraction stack (EntryPoints + Simple7702 + alto + paymaster) ----
  if (process.env.AHAND_AA === "off") {
    console.log("AHAND_AA=off — skipping the AA stack.");
  } else {
    const aa = await deployAaContracts(rpcUrl);
    aaStack = await startAaStack({ anvilRpc: rpcUrl });

    // Readiness: paymaster answers ping AND proxies alto's entrypoint list.
    const ping = await fetch(`${aaStack.paymasterUrl}/ping`).then((r) => r.json());
    const eps = await fetch(aaStack.paymasterUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_supportedEntryPoints", params: [] }),
    }).then((r) => r.json());
    const ep08 = aa.entryPoint08.toLowerCase();
    if (ping?.message !== "pong" || !eps?.result?.some((a: string) => a.toLowerCase() === ep08)) {
      console.error("AA stack failed readiness checks:", { ping, eps });
      shutdown();
      return;
    }
    console.log("AA stack ready:");
    console.log(`  bundler (alto):   ${aaStack.bundlerUrl}`);
    console.log(`  paymaster proxy:  ${aaStack.paymasterUrl}  <- point the app here`);
    console.log(`  EntryPoint v0.8:  ${aa.entryPoint08}`);
    console.log(`  Simple7702 impl:  ${aa.simple7702Implementation}`);
  }

  console.log("Stand is fully ready and running!");

  // Keep the process alive: wait on our anvil if we spawned one, else forever.
  if (anvil) await anvil.exited;
  else await new Promise(() => {});
}

main().catch(console.error);
