import { useEffect } from 'react'

import { useClient, useWaitForTransactionReceipt } from 'wagmi'

import { notify, hide, parseError } from './Notification'

import { useAccount, chain } from '../wallet'


export const Button = ({simulateHook, writeHook, params, emoji, text}) => {

  const account = useAccount()

  const txLink = (hash, text) => <a href={`${chain.blockExplorers?.default.url}/tx/${hash}`} className="font-bold underline" target="_blank">{text}</a>

  const {
    data: simulateData,
    isError: isSimulateError,
    isPending: isSimulatePending,
    isSuccess: isSimulateSuccess,
    error: simulateError,
  } = simulateHook({
    query: {
      enabled: account.connected && params.enabled
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
      enabled: account.connected && params.enabled && isSimulateSuccess
    },
    ...params
  })

  const {
    data: confirmationData,
    error: confirmationError,
    isError: isConfirmationError,
    isLoading: isConfirmationLoading,
    isSuccess: isConfirmationSuccess,
  } = useWaitForTransactionReceipt({
    confirmations: 1,
    hash: writeData,
    query: {
      enabled: account.connected && params.enabled && writeData
    },
    ...params,
  })

  useEffect(() => {
    params.enabled && isSimulatePending ? notify('Loading', 'loading', {id: 'simulating'}) : hide('simulating')
  })

  useEffect(() => {
    isSimulateError && (params.onSimulateError?.(simulateError) || notify(parseError(simulateError), 'error'))
    isSimulateSuccess && (params.onSimulateSuccess?.(simulateData) || notify(simulateData?.result, 'success'))

    if (isSimulateError || isSimulateSuccess) {
      params.simulateCallback?.({data: simulateData, error: simulateError})
    }
  }, [isSimulateError, isSimulateSuccess])

  useEffect(() => {
    isWriteError && (params.onWriteError?.(writeError) || notify(parseError(writeError), 'error'))
    isWriteSuccess && (params.onWriteSuccess?.(writeData) || notify(<span>{txLink(writeData, 'Transaction')} sent</span>, 'success'), {id: writeData})

    if (isWriteError || isWriteSuccess) {
      params.writeCallback?.({data: writeData, error: writeError})
    }
  }, [isWriteError, isWriteSuccess])

  useEffect(() => {
    params.enabled && writeData && isConfirmationLoading ? notify(<span>Confirming {txLink(writeData, 'Transaction')}</span>, 'loading', {id: 'confirming'}) : hide('confirming')
  }, [isConfirmationLoading])

  useEffect(() => {
    isConfirmationError && (params.onConfirmationError?.(confirmationError) || notify(parseError(confirmationError), 'error'))
    isConfirmationSuccess && (params.onConfirmationSuccess?.(confirmationData) || notify(<span>{txLink(confirmationData?.transactionHash, 'Transaction')} confirmed</span>, 'success'))

    if (isConfirmationError || isConfirmationSuccess) {
      params.confirmationCallback?.({data: confirmationData, error: confirmationError})
    }
  }, [isConfirmationError, isConfirmationSuccess])

  return <div>
    <button className="btn btn-ghost w-32"
            disabled={!account?.connected || !params?.enabled || !Boolean(simulateData?.request)}
            onClick={() => writeContract({...simulateData!.request, account: undefined})}>
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
