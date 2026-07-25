import {
  createPublicClient,
  createWalletClient,
  getCreate2Address,
  http,
  parseEther,
  size,
  slice,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AA_CONTRACTS,
  ANVIL_KEY_0,
  DEPLOYER_RAW_TX,
  DEPLOYER_SIGNER,
  DETERMINISTIC_DEPLOYER,
} from "./constants";

/**
 * Idempotently deploys the ERC-4337 base contracts (EntryPoint v0.6/0.7/0.8 +
 * Simple7702Account implementation) at their canonical cross-chain addresses.
 * The mock paymaster deposits into ALL THREE EntryPoints on startup, so all
 * of them must exist even though the app only uses v0.8.
 */
export async function deployAaContracts(rpcUrl: string) {
  const account = privateKeyToAccount(ANVIL_KEY_0);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });
  const chainId = await publicClient.getChainId();

  // The deterministic deployer ships in anvil's genesis; deploy it via
  // Nick's presigned tx on chains that lack it.
  if (!(await publicClient.getCode({ address: DETERMINISTIC_DEPLOYER }))) {
    const fund = await walletClient.sendTransaction({
      chain: null,
      to: DEPLOYER_SIGNER,
      value: parseEther("0.1"),
    });
    await publicClient.waitForTransactionReceipt({ hash: fund });
    const hash = await publicClient.request({
      method: "eth_sendRawTransaction",
      params: [DEPLOYER_RAW_TX],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    if (!(await publicClient.getCode({ address: DETERMINISTIC_DEPLOYER }))) {
      throw new Error("failed to deploy the deterministic deployment proxy");
    }
  }

  for (const { name, createcall, canonical } of AA_CONTRACTS) {
    if (size(createcall) <= 32) throw new Error(`${name}: malformed createcall`);
    const salt = slice(createcall, 0, 32);
    const bytecode = slice(createcall, 32);
    const expected = getCreate2Address({ from: DETERMINISTIC_DEPLOYER, salt, bytecode });
    if (expected.toLowerCase() !== canonical.toLowerCase()) {
      throw new Error(
        `${name}: CREATE2 address ${expected} != canonical ${canonical} — vendored blob drifted`,
      );
    }
    if (await publicClient.getCode({ address: canonical })) {
      console.log(`[aa] ${name} already at ${canonical}`);
      continue;
    }
    const hash = await walletClient.sendTransaction({
      chain: null,
      to: DETERMINISTIC_DEPLOYER,
      data: createcall,
      gas: 15_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !(await publicClient.getCode({ address: canonical }))) {
      throw new Error(`${name}: deployment tx ${hash} failed (chain ${chainId})`);
    }
    console.log(`[aa] deployed ${name} at ${canonical}`);
  }

  return {
    entryPoint06: AA_CONTRACTS[0].canonical,
    entryPoint07: AA_CONTRACTS[1].canonical,
    entryPoint08: AA_CONTRACTS[2].canonical,
    simple7702Implementation: AA_CONTRACTS[3].canonical,
  };
}
