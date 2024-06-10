import { useEffect } from "react"

import { useAccount, useWaitForTransactionReceipt } from "wagmi"

import { notify } from "./Notification"


export const parseError = (error) => {

  const templates = [
    /following reason:\n(.*?)\n/s,
    /(The total cost (.+?) exceeds the balance of the account)/,
    /(User rejected the request)/,
    /(Execution reverted for an unknown reason)/,
    /(Invalid UserOp signature or paymaster signature)/,
    /(RPC Error)/,
  ]

  let msg = ""

  if (error) {
    templates.forEach(template => {
      const matches = error.message.match(template)

      if (matches && matches[1]) {
        msg = matches[1].trim()
      }
    })
  }

  return msg
}


export const Button = ({simulateHook, writeHook, params, emoji, text}) => {

  const account = useAccount()
  const chain = account.chain;

  const txLink = (hash, text) => <a href={`${chain?.blockExplorers?.default.url}/tx/${hash}`} className="font-bold underline" target="_blank">{text}</a>

  const {
    data: simulateData,
    isError: isSimulateError,
    isPending: isSimulatePending,
    isSuccess: isSimulateSuccess,
    error: simulateError,
  } = simulateHook({
    query: {
      enabled: params.enabled
    },
    ...params
  })

  const {
    writeContract,
    data: writeData,
    error: writeError,
    isError: isWriteError,
    isIdle: isWriteIdle,
    isPending: isWritePending,
    isSuccess: isWriteSuccess,
  } = writeHook({
    query: {
      enabled: params.enabled
    },
    ...params
  })

  const {
    data: confirmationData,
    error: confirmationError,
    isError: isConfirmationError,
    isPending: isConfirmationPending,
    isSuccess: isConfirmationSuccess,
  } = useWaitForTransactionReceipt({
    confirmations: 1,
    hash: writeData,
    query: {
      enabled: params.enabled
    },
    ...params,
  })

  useEffect(() => {
    isSimulateError && (params.onSimulateError?.(simulateError) || notify(parseError(simulateError), "error"))
    isSimulateSuccess && (params.onSimulateSuccess?.(simulateData) || notify(simulateData?.result, "success"))
  }, [isSimulateError, isSimulateSuccess])

  useEffect(() => {
    isWriteError && (params.onWriteError?.(writeError) || notify(parseError(writeError), "error"))
    isWriteSuccess && (params.onWriteSuccess?.(writeData) || notify(<span>{txLink(writeData, "Transaction")} sent</span>, "success"))
  }, [isWriteError, isWriteSuccess])

  useEffect(() => {
    isConfirmationError && (params.onConfirmationError?.(confirmationError) || notify(parseError(confirmationError), "error"))
    isConfirmationSuccess && (params.onConfirmationSuccess?.(confirmationData) || notify(<span>{txLink(confirmationData?.transactionHash, "Transaction")} confirmed</span>, "success"))
  }, [isConfirmationError, isConfirmationSuccess])

  return <div>
    <button className="btn btn-ghost w-32"
            disabled={!params?.enabled || !Boolean(simulateData?.request)}
            onClick={() => writeContract(simulateData!.request)}>
      {
        isWritePending ? 
          <span className="loading loading-spinner"></span>
        : 
          <span className="text-2xl">{emoji}</span>
      }
      {text}
    </button>
  </div>
}
