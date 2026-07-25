import { useState } from "react";
import { useConnection, useReadContract } from "wagmi";
import { AHandCoreAbi, DeployedAddresses } from "@ahand/abi";
import { useSender } from "./useSender";
import { humanizeChainError } from "../lib/errors";

/**
 * Pull-payment claims: what PayoutAllocated has credited to the connected
 * address, straight from claims(token, beneficiary), and the one action that
 * moves it — withdraw(token, beneficiary). Withdraw is permissionless and
 * fixed-destination, so "Take out" can never send the money anywhere else;
 * on an embedded pocket it rides a sponsored userOp (gasless).
 */
export function useClaims() {
  const { address, isConnected } = useConnection();
  const { send } = useSender();

  const [takingOut, setTakingOut] = useState(false);
  const [error, setError] = useState("");

  const { data: claimableRaw, refetch } = useReadContract({
    address: DeployedAddresses.AHandCore,
    abi: AHandCoreAbi,
    functionName: "claims",
    args: address ? [DeployedAddresses.mockUSD, address] : undefined,
  });

  const claimable = claimableRaw !== undefined ? (claimableRaw as bigint) : null;

  const takeOut = async () => {
    if (!address) return;
    setTakingOut(true);
    setError("");
    try {
      await send([
        {
          address: DeployedAddresses.AHandCore,
          abi: AHandCoreAbi,
          functionName: "withdraw",
          args: [DeployedAddresses.mockUSD, address],
        },
      ]);
      await refetch();
    } catch (err: any) {
      console.error(err);
      const human = humanizeChainError(err);
      setError(human.message);
    } finally {
      setTakingOut(false);
    }
  };

  return { isConnected, address, claimable, takeOut, takingOut, error, refetch };
}
