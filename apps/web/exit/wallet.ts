/**
 * Wallets for the exit page, with no library: EIP-6963 discovery, then `window.ethereum` for a
 * wallet that does not announce itself. A wallet only signs and sends; every read goes to the RPC
 * the person typed, and every receipt is read back from it.
 */
import { numberToHex, type Address, type Hex } from "viem";

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface FoundWallet {
  /** EIP-6963's uuid, or "window.ethereum". */
  id: string;
  name: string;
  /** A data: URI per EIP-6963; absent for window.ethereum. */
  icon?: string;
  provider: Eip1193;
}

interface AnnounceDetail {
  info: { uuid: string; name: string; icon?: string; rdns?: string };
  provider: Eip1193;
}

/**
 * Lists the wallets this page can see, calling `onChange` with the whole list each time one
 * announces itself. Wallets that announce later (extensions load at their own pace) still arrive.
 */
export function discoverWallets(onChange: (wallets: FoundWallet[]) => void): void {
  const found = new Map<string, FoundWallet>();
  const publish = () => {
    const list = [...found.values()];
    const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (injected && !list.some((wallet) => wallet.provider === injected)) {
      list.push({ id: "window.ethereum", name: "window.ethereum", provider: injected });
    }
    onChange(list);
  };
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent<AnnounceDetail>).detail;
    if (!detail?.info?.uuid || typeof detail.provider?.request !== "function") return;
    const icon = typeof detail.info.icon === "string" && detail.info.icon.startsWith("data:image/") ? detail.info.icon : undefined;
    found.set(detail.info.uuid, { id: detail.info.uuid, name: String(detail.info.name || "Wallet"), icon, provider: detail.provider });
    publish();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  publish();
}

/** Asks the wallet for its account. */
export async function connectWallet(wallet: FoundWallet): Promise<Address> {
  const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
  const first = accounts?.[0];
  if (!first) throw new Error("the wallet gave no account");
  return first as Address;
}

/** The chain the wallet is on. */
export async function walletChain(wallet: FoundWallet): Promise<number> {
  return Number(await wallet.provider.request({ method: "eth_chainId" }));
}

/**
 * Puts the wallet on `chainId`, asking it to switch when it is elsewhere. Throws `WrongChain`
 * when it stays elsewhere: a transaction is never sent to a chain this page did not read.
 */
export async function ensureChain(wallet: FoundWallet, chainId: number): Promise<void> {
  if ((await walletChain(wallet)) === chainId) return;
  try {
    await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] });
  } catch {
    // the wallet refused or does not know the chain: said below
  }
  const now = await walletChain(wallet);
  if (now !== chainId) throw new WrongChain(now, chainId);
}

export class WrongChain extends Error {
  constructor(
    readonly walletChainId: number,
    readonly wantedChainId: number,
  ) {
    super(`the wallet is on chain ${walletChainId}, this page reads chain ${wantedChainId}`);
    this.name = "WrongChain";
  }
}

/** Hands the call to the wallet; returns the transaction's hash. The wallet signs and sends. */
export async function sendWithWallet(
  wallet: FoundWallet,
  from: Address,
  call: { to: Address; data: Hex },
  gasLimit?: bigint,
): Promise<Hex> {
  const tx: Record<string, string> = { from, to: call.to, data: call.data };
  if (gasLimit !== undefined) tx.gas = numberToHex(gasLimit);
  return (await wallet.provider.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
}

/** Whether the wallet's error is the person saying no (EIP-1193 code 4001). */
export function isUserRejection(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 4001;
}
