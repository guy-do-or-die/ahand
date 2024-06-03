import { useAccount, useWaitForTransactionReceipt } from "wagmi";

import { notify } from "./Notification";


export const parseError = (error) => {

  const templates = [
    /following reason:\n(.*?)\n/s,
    /(The total cost (.+?) exceeds the balance of the account)/,
    /(User rejected the request)/,
    /(Execution reverted for an unknown reason)/,
    /(Invalid UserOp signature or paymaster signature)/,
    /(RPC Error)/,
  ]

  let msg = "";

  if (error) {
    templates.forEach(template => {
      const matches = error.message.match(template);

      if (matches && matches[1]) {
        msg = matches[1].trim();
      }
    })
  }

  return msg
}


export const Button = ({simulateHook, writeHook, params, emoji, text}) => {

  const { chain } = useAccount();

  const etherscan = chain?.blockExplorers?.etherscan;
  const txLink = (hash, msg) => <a href={`${etherscan.url}/tx/${hash}`} target="_blank">{msg}</a>

  const { data: simulateData, isLoading: isPreparing, error: simulateError } = simulateHook({

    onError: error => {
      params.onSimulateError?.(error) || notify(parseError(error), "error");
    },

    onSuccess: data => {
      params.onSimulateSuccess?.(data) || notify(data?.result, "success");
    },

    ...params,
  })

  const {data: writeData, writeContract, isLoading: isWriting } = writeHook({

    onError: error => {
      params.onWriteError?.(error) || notify(parseError(error), "error");
    },

    onSuccess: data => {
      params.onWriteSuccess?.(data) || notify(txLink(data?.hash, "Transaction sent"), "success");
    },

  });

  const {isLoading: isConfirmating} = useWaitForTransactionReceipt({
    confirmations: 1,
    hash: writeData?.hash,

    onError: error => {
      notify(parseError(error), "error");
    },

    onSuccess: data => {
      params.onReceipt?.(data) || notify(txLink(data?.transactionHash, "Transaction confirmed"), "success");
    }
  });

  return <div>
    <button className="btn btn-ghost w-32"
            disabled={!params.enabled || !Boolean(simulateData?.request)}
            onClick={() => writeContract(simulateData!.request)}>
      {
        isPreparing || isWriting || isConfirmating ? 
          <span className="loading loading-spinner"></span>
        : 
          <span className="text-2xl">{emoji}</span>
      }
      {text}
    </button>
  </div>
}
