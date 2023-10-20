import {useWaitForTransaction} from "wagmi";


export const Button = ({prepareHook, writeHook, onReceipt, params, emoji, text}) => {

  const { config, isLoading: isPreparing, error: prepareError } = prepareHook({
    onSettled: (data, error) => {
    },

    ...params,
  })

  const {data, write, isLoading: isWriting } = writeHook(config);

  const {isLoading: isConfirmating} = useWaitForTransaction({
    confirmations: 1,
    hash: data?.hash,

    onSuccess: data => {
      params.onReceipt?.(data);
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
