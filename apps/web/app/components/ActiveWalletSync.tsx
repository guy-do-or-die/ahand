import { useEffect } from "react";
import { useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";

/**
 * Routes the Privy embedded wallet (if any) through wagmi as the active
 * account, so useAccount/useSignMessage — and therefore the XMTP layer —
 * see the embedded EOA. Sessions without an embedded wallet (external
 * wallets) are untouched: this renders nothing and does nothing.
 */
export function ActiveWalletSync() {
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const embeddedAddress = embedded?.address;

  useEffect(() => {
    if (embedded) void setActiveWallet(embedded);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wallets array identity churns; address is the real key
  }, [embeddedAddress, setActiveWallet]);

  return null;
}
