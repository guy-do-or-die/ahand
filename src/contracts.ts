import {
  useContractRead,
  UseContractReadConfig,
  useContractWrite,
  UseContractWriteConfig,
  usePrepareContractWrite,
  UsePrepareContractWriteConfig,
  useContractEvent,
  UseContractEventConfig,
  useNetwork,
  useChainId,
  Address,
} from 'wagmi'
import {
  ReadContractResult,
  WriteContractMode,
  PrepareWriteContractResult,
} from 'wagmi/actions'

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AHand
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const aHandABI = [
  {
    stateMutability: 'payable',
    type: 'constructor',
    inputs: [
      { name: '_raiser', internalType: 'address', type: 'address' },
      { name: '_problem', internalType: 'string', type: 'string' },
      { name: 'ref', internalType: 'address', type: 'address' },
    ],
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'solutionIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'ref', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'giver',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Given',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'ref', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'shaker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Shaken',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'solutionIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'thanker',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'receiver',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Thanked',
  },
  { stateMutability: 'payable', type: 'fallback' },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [],
    name: 'base',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'giver', internalType: 'address', type: 'address' },
      { name: 'solution', internalType: 'string', type: 'string' },
    ],
    name: 'give',
    outputs: [],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [],
    name: 'problem',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [],
    name: 'raiser',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'refs',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'shaker', internalType: 'address', type: 'address' },
    ],
    name: 'shake',
    outputs: [],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'shakes',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'shaker', internalType: 'address', type: 'address' }],
    name: 'shakesChain',
    outputs: [{ name: 'chain', internalType: 'address[]', type: 'address[]' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'solutions',
    outputs: [
      { name: 'giver', internalType: 'address', type: 'address' },
      { name: 'solution', internalType: 'string', type: 'string' },
    ],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [],
    name: 'solutionsNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [],
    name: 'solved',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'thanker', internalType: 'address', type: 'address' },
      { name: 'solutionIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'thank',
    outputs: [],
  },
  { stateMutability: 'payable', type: 'receive' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AHandBase
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export const aHandBaseABI = [
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'raiser',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Raised',
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'hand', internalType: 'address', type: 'address' }],
    name: 'getProblem',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address' },
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'solution', internalType: 'string', type: 'string' },
    ],
    name: 'give',
    outputs: [],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'hands',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [],
    name: 'handsNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'payable',
    type: 'function',
    inputs: [
      { name: 'problem', internalType: 'string', type: 'string' },
      { name: 'ref', internalType: 'address', type: 'address' },
    ],
    name: 'raise',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address' },
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
    ],
    name: 'shake',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address' },
      { name: 'solutionIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'thank',
    outputs: [],
  },
] as const

/**
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export const aHandBaseAddress = {
  137: '0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D',
  31337: '0xb609D06B30481d9c8f220e3051d3BA41f48DDb2A',
  80001: '0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36',
} as const

/**
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export const aHandBaseConfig = {
  address: aHandBaseAddress,
  abi: aHandBaseABI,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// React
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__.
 */
export function useAHandRead<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi'
  > = {} as any,
) {
  return useContractRead({ abi: aHandABI, ...config } as UseContractReadConfig<
    typeof aHandABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"base"`.
 */
export function useAHandBase<
  TFunctionName extends 'base',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'base',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"problem"`.
 */
export function useAHandProblem<
  TFunctionName extends 'problem',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'problem',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"raiser"`.
 */
export function useAHandRaiser<
  TFunctionName extends 'raiser',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'raiser',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"refs"`.
 */
export function useAHandRefs<
  TFunctionName extends 'refs',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'refs',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"shakes"`.
 */
export function useAHandShakes<
  TFunctionName extends 'shakes',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'shakes',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"shakesChain"`.
 */
export function useAHandShakesChain<
  TFunctionName extends 'shakesChain',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'shakesChain',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"solutions"`.
 */
export function useAHandSolutions<
  TFunctionName extends 'solutions',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'solutions',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"solutionsNumber"`.
 */
export function useAHandSolutionsNumber<
  TFunctionName extends 'solutionsNumber',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'solutionsNumber',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"solved"`.
 */
export function useAHandSolved<
  TFunctionName extends 'solved',
  TSelectData = ReadContractResult<typeof aHandABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: aHandABI,
    functionName: 'solved',
    ...config,
  } as UseContractReadConfig<typeof aHandABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandABI}__.
 */
export function useAHandWrite<
  TFunctionName extends string,
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<typeof aHandABI, string>['request']['abi'],
        TFunctionName,
        TMode
      >
    : UseContractWriteConfig<typeof aHandABI, TFunctionName, TMode> & {
        abi?: never
      } = {} as any,
) {
  return useContractWrite<typeof aHandABI, TFunctionName, TMode>({
    abi: aHandABI,
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"give"`.
 */
export function useAHandGive<TMode extends WriteContractMode = undefined>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<typeof aHandABI, 'give'>['request']['abi'],
        'give',
        TMode
      > & { functionName?: 'give' }
    : UseContractWriteConfig<typeof aHandABI, 'give', TMode> & {
        abi?: never
        functionName?: 'give'
      } = {} as any,
) {
  return useContractWrite<typeof aHandABI, 'give', TMode>({
    abi: aHandABI,
    functionName: 'give',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"shake"`.
 */
export function useAHandShake<TMode extends WriteContractMode = undefined>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<typeof aHandABI, 'shake'>['request']['abi'],
        'shake',
        TMode
      > & { functionName?: 'shake' }
    : UseContractWriteConfig<typeof aHandABI, 'shake', TMode> & {
        abi?: never
        functionName?: 'shake'
      } = {} as any,
) {
  return useContractWrite<typeof aHandABI, 'shake', TMode>({
    abi: aHandABI,
    functionName: 'shake',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"thank"`.
 */
export function useAHandThank<TMode extends WriteContractMode = undefined>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<typeof aHandABI, 'thank'>['request']['abi'],
        'thank',
        TMode
      > & { functionName?: 'thank' }
    : UseContractWriteConfig<typeof aHandABI, 'thank', TMode> & {
        abi?: never
        functionName?: 'thank'
      } = {} as any,
) {
  return useContractWrite<typeof aHandABI, 'thank', TMode>({
    abi: aHandABI,
    functionName: 'thank',
    ...config,
  } as any)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandABI}__.
 */
export function usePrepareAHandWrite<TFunctionName extends string>(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandABI, TFunctionName>,
    'abi'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: aHandABI,
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandABI, TFunctionName>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"give"`.
 */
export function usePrepareAHandGive(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandABI, 'give'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: aHandABI,
    functionName: 'give',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandABI, 'give'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"shake"`.
 */
export function usePrepareAHandShake(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandABI, 'shake'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: aHandABI,
    functionName: 'shake',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandABI, 'shake'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandABI}__ and `functionName` set to `"thank"`.
 */
export function usePrepareAHandThank(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandABI, 'thank'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: aHandABI,
    functionName: 'thank',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandABI, 'thank'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandABI}__.
 */
export function useAHandEvent<TEventName extends string>(
  config: Omit<
    UseContractEventConfig<typeof aHandABI, TEventName>,
    'abi'
  > = {} as any,
) {
  return useContractEvent({
    abi: aHandABI,
    ...config,
  } as UseContractEventConfig<typeof aHandABI, TEventName>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandABI}__ and `eventName` set to `"Given"`.
 */
export function useAHandGivenEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandABI, 'Given'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: aHandABI,
    eventName: 'Given',
    ...config,
  } as UseContractEventConfig<typeof aHandABI, 'Given'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandABI}__ and `eventName` set to `"Shaken"`.
 */
export function useAHandShakenEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandABI, 'Shaken'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: aHandABI,
    eventName: 'Shaken',
    ...config,
  } as UseContractEventConfig<typeof aHandABI, 'Shaken'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandABI}__ and `eventName` set to `"Thanked"`.
 */
export function useAHandThankedEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandABI, 'Thanked'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: aHandABI,
    eventName: 'Thanked',
    ...config,
  } as UseContractEventConfig<typeof aHandABI, 'Thanked'>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseRead<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof aHandBaseABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>,
    'abi' | 'address'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractRead({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"getProblem"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseGetProblem<
  TFunctionName extends 'getProblem',
  TSelectData = ReadContractResult<typeof aHandBaseABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractRead({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'getProblem',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"hands"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseHands<
  TFunctionName extends 'hands',
  TSelectData = ReadContractResult<typeof aHandBaseABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractRead({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'hands',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"handsNumber"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseHandsNumber<
  TFunctionName extends 'handsNumber',
  TSelectData = ReadContractResult<typeof aHandBaseABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractRead({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'handsNumber',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseWrite<
  TFunctionName extends string,
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          string
        >['request']['abi'],
        TFunctionName,
        TMode
      > & { address?: Address; chainId?: TChainId }
    : UseContractWriteConfig<typeof aHandBaseABI, TFunctionName, TMode> & {
        abi?: never
        address?: never
        chainId?: TChainId
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, TFunctionName, TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"give"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseGive<
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          'give'
        >['request']['abi'],
        'give',
        TMode
      > & { address?: Address; chainId?: TChainId; functionName?: 'give' }
    : UseContractWriteConfig<typeof aHandBaseABI, 'give', TMode> & {
        abi?: never
        address?: never
        chainId?: TChainId
        functionName?: 'give'
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, 'give', TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'give',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"raise"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseRaise<
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          'raise'
        >['request']['abi'],
        'raise',
        TMode
      > & { address?: Address; chainId?: TChainId; functionName?: 'raise' }
    : UseContractWriteConfig<typeof aHandBaseABI, 'raise', TMode> & {
        abi?: never
        address?: never
        chainId?: TChainId
        functionName?: 'raise'
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, 'raise', TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'raise',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"shake"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseShake<
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          'shake'
        >['request']['abi'],
        'shake',
        TMode
      > & { address?: Address; chainId?: TChainId; functionName?: 'shake' }
    : UseContractWriteConfig<typeof aHandBaseABI, 'shake', TMode> & {
        abi?: never
        address?: never
        chainId?: TChainId
        functionName?: 'shake'
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, 'shake', TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'shake',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"thank"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseThank<
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          'thank'
        >['request']['abi'],
        'thank',
        TMode
      > & { address?: Address; chainId?: TChainId; functionName?: 'thank' }
    : UseContractWriteConfig<typeof aHandBaseABI, 'thank', TMode> & {
        abi?: never
        address?: never
        chainId?: TChainId
        functionName?: 'thank'
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, 'thank', TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'thank',
    ...config,
  } as any)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function usePrepareAHandBaseWrite<TFunctionName extends string>(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, TFunctionName>,
    'abi' | 'address'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandBaseABI, TFunctionName>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"give"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function usePrepareAHandBaseGive(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, 'give'>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'give',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandBaseABI, 'give'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"raise"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function usePrepareAHandBaseRaise(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, 'raise'>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'raise',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandBaseABI, 'raise'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"shake"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function usePrepareAHandBaseShake(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, 'shake'>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'shake',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandBaseABI, 'shake'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"thank"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function usePrepareAHandBaseThank(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, 'thank'>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'thank',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandBaseABI, 'thank'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandBaseABI}__.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseEvent<TEventName extends string>(
  config: Omit<
    UseContractEventConfig<typeof aHandBaseABI, TEventName>,
    'abi' | 'address'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractEvent({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    ...config,
  } as UseContractEventConfig<typeof aHandBaseABI, TEventName>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandBaseABI}__ and `eventName` set to `"Raised"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xfd19cEb982455c22E901d559B1BDD9e5b5dCBc36)
 */
export function useAHandBaseRaisedEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandBaseABI, 'Raised'>,
    'abi' | 'address' | 'eventName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractEvent({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    eventName: 'Raised',
    ...config,
  } as UseContractEventConfig<typeof aHandBaseABI, 'Raised'>)
}
