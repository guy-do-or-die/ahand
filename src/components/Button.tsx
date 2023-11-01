import { useNetwork, useWaitForTransaction } from "wagmi";

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


export const Button = ({prepareHook, writeHook, params, emoji, text}) => {

  const { chain } = useNetwork();

  const etherscan = chain?.blockExplorers?.etherscan;
  const txLink = (hash, msg) => <a href={`${etherscan.url}/tx/${hash}`} target="_blank">{msg}</a>

  const { config, isLoading: isPreparing, error: prepareError } = prepareHook({

    onError: error => {
      params.onPrepareError?.(error) || notify(parseError(error), "error");
    },

    onSuccess: data => {
      params.onPrepareSuccess?.(data) || notify(data?.result, "success");
    },

    ...params,
  })

  const {data, write, isLoading: isWriting } = writeHook({

    onError: error => {
      params.onWriteError?.(error) || notify(parseError(error), "error");
    },

    onSuccess: data => {
      params.onWriteSuccess?.(data) || notify(txLink(data?.hash, "Transaction sent"), "success");
    },

    ...config
  });

  const {isLoading: isConfirmating} = useWaitForTransaction({
    confirmations: 1,
    hash: data?.hash,

    onError: error => {
      notify(parseError(error), "error");
    },

    onSuccess: data => {
      params.onReceipt?.(data) || notify(txLink(data?.transactionHash, "Transaction confirmed"), "success");
    }
  });

  return <div>
    <button className="btn btn-ghost w-32" disabled={!params.enabled || !write} onClick={() => write?.()}>
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
