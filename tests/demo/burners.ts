/**
 * The engine's burner wallets for Base Sepolia (tests/demo/engine/burners.ts):
 *
 *   bun tests/demo/burners.ts new [count]           make burners 1..count (never replaces one); prints addresses
 *   bun tests/demo/burners.ts list                  their addresses
 *   bun tests/demo/burners.ts status [--rpc URL]    ETH and test USDC of each, read from Base Sepolia (or URL)
 *   bun tests/demo/burners.ts need                  what each burner needs to play every site scenario once
 *
 * Keys stay in ~/.config/ahand-demo/burners.json (0600) and are never printed. Fund them from the
 * faucets the app lists (Circle for USDC, Base's list for ETH): that is the owner's step.
 */
import { createPublicClient, erc20Abi, formatEther, formatUnits, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

import { burnerAddresses, burnersFile, ensureBurners } from "./engine/burners";

const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const command = process.argv[2];

if (command === "new") {
  const addresses = ensureBurners(Number(process.argv[3] ?? 5));
  console.log(`${burnersFile()} (0600)`);
  addresses.forEach((a, i) => console.log(`burner ${i + 1}  ${a}`));
} else if (command === "list") {
  burnerAddresses().forEach((a, i) => console.log(`burner ${i + 1}  ${a}`));
} else if (command === "status") {
  const at = process.argv.indexOf("--rpc");
  const url = at >= 0 ? process.argv[at + 1]! : "https://sepolia.base.org";
  const client = createPublicClient({ chain: baseSepolia, transport: http(url) });
  if ((await client.getChainId()) !== 84532) throw new Error(`${url} is not Base Sepolia`);
  for (const [i, address] of burnerAddresses().entries()) {
    const [eth, usdc] = await Promise.all([client.getBalance({ address }), client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] })]);
    console.log(`burner ${i + 1}  ${address}  ${formatEther(eth)} ETH  ${formatUnits(usdc, 6)} USDC`);
  }
} else if (command === "need") {
  const { SCENARIOS } = await import("./scenarios");
  const { spendOf, ETH_FLOOR, FAUCETS } = await import("./engine/preflight");
  const { walletOnTarget } = await import("./engine/wallets");
  const total = new Map<number, { usd: bigint; gas: boolean; scenarios: number }>();
  for (const scenario of SCENARIOS.filter((s) => s.targets.includes("site"))) {
    for (const [key, { usd, gas }] of spendOf(scenario)) {
      const wallet = walletOnTarget(scenario.personas[key]!.wallet, "site");
      if (wallet.kind !== "burner") continue;
      const now = total.get(wallet.index) ?? { usd: 0n, gas: false, scenarios: 0 };
      total.set(wallet.index, { usd: now.usd + usd, gas: now.gas || gas, scenarios: now.scenarios + 1 });
    }
  }
  const addresses = burnerAddresses();
  for (const [n, need] of [...total].sort((a, b) => a[0] - b[0])) {
    console.log(`burner ${n}  ${addresses[n - 1] ?? "(not made yet)"}  ${formatUnits(need.usd, 6)} USDC${need.gas ? `, ${formatEther(ETH_FLOOR)} ETH` : ""}  (${need.scenarios} scenarios)`);
  }
  console.log(`Every site scenario once. Faucets: ${FAUCETS}.`);
} else {
  console.error("usage: bun tests/demo/burners.ts new [count] | list | status [--rpc URL] | need");
  process.exit(2);
}
