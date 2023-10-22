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
    inputs: [{ name: 'ref', internalType: 'address', type: 'address' }],
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export const aHandBaseABI = [
  { stateMutability: 'nonpayable', type: 'constructor', inputs: [] },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
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
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'ids',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'TransferBatch',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferSingle',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'value', internalType: 'string', type: 'string', indexed: false },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'URI',
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
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
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
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
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'amounts', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
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
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
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
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
  },
] as const

/**
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export const aHandBaseAddress = {
  137: '0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D',
  31337: '0xb609D06B30481d9c8f220e3051d3BA41f48DDb2A',
  80001: '0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29',
} as const

/**
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export const aHandBaseConfig = {
  address: aHandBaseAddress,
  abi: aHandBaseABI,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155ABI = [
  {
    stateMutability: 'nonpayable',
    type: 'constructor',
    inputs: [{ name: 'uri_', internalType: 'string', type: 'string' }],
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'ids',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'TransferBatch',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferSingle',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'value', internalType: 'string', type: 'string', indexed: false },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'URI',
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'amounts', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155Supply
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155SupplyABI = [
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'ids',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'TransferBatch',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferSingle',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'value', internalType: 'string', type: 'string', indexed: false },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'URI',
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'exists',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'amounts', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC165
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc165ABI = [
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155ABI = [
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'ids',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'TransferBatch',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferSingle',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'value', internalType: 'string', type: 'string', indexed: false },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'URI',
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'amounts', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155MetadataURI
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155MetadataUriABI = [
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'ids',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'TransferBatch',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferSingle',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'value', internalType: 'string', type: 'string', indexed: false },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'URI',
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'amounts', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155Receiver
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155ReceiverABI = [
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155BatchReceived',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
  },
  {
    stateMutability: 'nonpayable',
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
  },
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC165
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc165ABI = [
  {
    stateMutability: 'view',
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
  },
] as const

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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"balanceOf"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseBalanceOf<
  TFunctionName extends 'balanceOf',
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
    functionName: 'balanceOf',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"balanceOfBatch"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseBalanceOfBatch<
  TFunctionName extends 'balanceOfBatch',
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
    functionName: 'balanceOfBatch',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"getProblem"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"isApprovedForAll"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseIsApprovedForAll<
  TFunctionName extends 'isApprovedForAll',
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
    functionName: 'isApprovedForAll',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"supportsInterface"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseSupportsInterface<
  TFunctionName extends 'supportsInterface',
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
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"uri"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseUri<
  TFunctionName extends 'uri',
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
    functionName: 'uri',
    ...config,
  } as UseContractReadConfig<typeof aHandBaseABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseSafeBatchTransferFrom<
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          'safeBatchTransferFrom'
        >['request']['abi'],
        'safeBatchTransferFrom',
        TMode
      > & {
        address?: Address
        chainId?: TChainId
        functionName?: 'safeBatchTransferFrom'
      }
    : UseContractWriteConfig<
        typeof aHandBaseABI,
        'safeBatchTransferFrom',
        TMode
      > & {
        abi?: never
        address?: never
        chainId?: TChainId
        functionName?: 'safeBatchTransferFrom'
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, 'safeBatchTransferFrom', TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"safeTransferFrom"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseSafeTransferFrom<
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          'safeTransferFrom'
        >['request']['abi'],
        'safeTransferFrom',
        TMode
      > & {
        address?: Address
        chainId?: TChainId
        functionName?: 'safeTransferFrom'
      }
    : UseContractWriteConfig<typeof aHandBaseABI, 'safeTransferFrom', TMode> & {
        abi?: never
        address?: never
        chainId?: TChainId
        functionName?: 'safeTransferFrom'
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, 'safeTransferFrom', TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'safeTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"setApprovalForAll"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseSetApprovalForAll<
  TMode extends WriteContractMode = undefined,
  TChainId extends number = keyof typeof aHandBaseAddress,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof aHandBaseABI,
          'setApprovalForAll'
        >['request']['abi'],
        'setApprovalForAll',
        TMode
      > & {
        address?: Address
        chainId?: TChainId
        functionName?: 'setApprovalForAll'
      }
    : UseContractWriteConfig<
        typeof aHandBaseABI,
        'setApprovalForAll',
        TMode
      > & {
        abi?: never
        address?: never
        chainId?: TChainId
        functionName?: 'setApprovalForAll'
      } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractWrite<typeof aHandBaseABI, 'setApprovalForAll', TMode>({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'setApprovalForAll',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"shake"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function usePrepareAHandBaseSafeBatchTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, 'safeBatchTransferFrom'>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof aHandBaseABI,
    'safeBatchTransferFrom'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"safeTransferFrom"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function usePrepareAHandBaseSafeTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, 'safeTransferFrom'>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'safeTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandBaseABI, 'safeTransferFrom'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"setApprovalForAll"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function usePrepareAHandBaseSetApprovalForAll(
  config: Omit<
    UsePrepareContractWriteConfig<typeof aHandBaseABI, 'setApprovalForAll'>,
    'abi' | 'address' | 'functionName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return usePrepareContractWrite({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    functionName: 'setApprovalForAll',
    ...config,
  } as UsePrepareContractWriteConfig<typeof aHandBaseABI, 'setApprovalForAll'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link aHandBaseABI}__ and `functionName` set to `"shake"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandBaseABI}__ and `eventName` set to `"ApprovalForAll"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseApprovalForAllEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandBaseABI, 'ApprovalForAll'>,
    'abi' | 'address' | 'eventName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractEvent({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    eventName: 'ApprovalForAll',
    ...config,
  } as UseContractEventConfig<typeof aHandBaseABI, 'ApprovalForAll'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandBaseABI}__ and `eventName` set to `"Raised"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
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

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandBaseABI}__ and `eventName` set to `"TransferBatch"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseTransferBatchEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandBaseABI, 'TransferBatch'>,
    'abi' | 'address' | 'eventName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractEvent({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    eventName: 'TransferBatch',
    ...config,
  } as UseContractEventConfig<typeof aHandBaseABI, 'TransferBatch'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandBaseABI}__ and `eventName` set to `"TransferSingle"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseTransferSingleEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandBaseABI, 'TransferSingle'>,
    'abi' | 'address' | 'eventName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractEvent({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    eventName: 'TransferSingle',
    ...config,
  } as UseContractEventConfig<typeof aHandBaseABI, 'TransferSingle'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link aHandBaseABI}__ and `eventName` set to `"URI"`.
 *
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0xa6c3a2003C43275Fb5F2d497BA258A2dEb39bF29)
 */
export function useAHandBaseUriEvent(
  config: Omit<
    UseContractEventConfig<typeof aHandBaseABI, 'URI'>,
    'abi' | 'address' | 'eventName'
  > & { chainId?: keyof typeof aHandBaseAddress } = {} as any,
) {
  const { chain } = useNetwork()
  const defaultChainId = useChainId()
  const chainId = config.chainId ?? chain?.id ?? defaultChainId
  return useContractEvent({
    abi: aHandBaseABI,
    address: aHandBaseAddress[chainId as keyof typeof aHandBaseAddress],
    eventName: 'URI',
    ...config,
  } as UseContractEventConfig<typeof aHandBaseABI, 'URI'>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155ABI}__.
 */
export function useErc1155Read<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof erc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>,
    'abi'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155ABI,
    ...config,
  } as UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"balanceOf"`.
 */
export function useErc1155BalanceOf<
  TFunctionName extends 'balanceOf',
  TSelectData = ReadContractResult<typeof erc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155ABI,
    functionName: 'balanceOf',
    ...config,
  } as UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"balanceOfBatch"`.
 */
export function useErc1155BalanceOfBatch<
  TFunctionName extends 'balanceOfBatch',
  TSelectData = ReadContractResult<typeof erc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155ABI,
    functionName: 'balanceOfBatch',
    ...config,
  } as UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"isApprovedForAll"`.
 */
export function useErc1155IsApprovedForAll<
  TFunctionName extends 'isApprovedForAll',
  TSelectData = ReadContractResult<typeof erc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155ABI,
    functionName: 'isApprovedForAll',
    ...config,
  } as UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"supportsInterface"`.
 */
export function useErc1155SupportsInterface<
  TFunctionName extends 'supportsInterface',
  TSelectData = ReadContractResult<typeof erc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155ABI,
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"uri"`.
 */
export function useErc1155Uri<
  TFunctionName extends 'uri',
  TSelectData = ReadContractResult<typeof erc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155ABI,
    functionName: 'uri',
    ...config,
  } as UseContractReadConfig<typeof erc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155ABI}__.
 */
export function useErc1155Write<
  TFunctionName extends string,
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<typeof erc1155ABI, string>['request']['abi'],
        TFunctionName,
        TMode
      >
    : UseContractWriteConfig<typeof erc1155ABI, TFunctionName, TMode> & {
        abi?: never
      } = {} as any,
) {
  return useContractWrite<typeof erc1155ABI, TFunctionName, TMode>({
    abi: erc1155ABI,
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function useErc1155SafeBatchTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof erc1155ABI,
          'safeBatchTransferFrom'
        >['request']['abi'],
        'safeBatchTransferFrom',
        TMode
      > & { functionName?: 'safeBatchTransferFrom' }
    : UseContractWriteConfig<
        typeof erc1155ABI,
        'safeBatchTransferFrom',
        TMode
      > & {
        abi?: never
        functionName?: 'safeBatchTransferFrom'
      } = {} as any,
) {
  return useContractWrite<typeof erc1155ABI, 'safeBatchTransferFrom', TMode>({
    abi: erc1155ABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function useErc1155SafeTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof erc1155ABI,
          'safeTransferFrom'
        >['request']['abi'],
        'safeTransferFrom',
        TMode
      > & { functionName?: 'safeTransferFrom' }
    : UseContractWriteConfig<typeof erc1155ABI, 'safeTransferFrom', TMode> & {
        abi?: never
        functionName?: 'safeTransferFrom'
      } = {} as any,
) {
  return useContractWrite<typeof erc1155ABI, 'safeTransferFrom', TMode>({
    abi: erc1155ABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function useErc1155SetApprovalForAll<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof erc1155ABI,
          'setApprovalForAll'
        >['request']['abi'],
        'setApprovalForAll',
        TMode
      > & { functionName?: 'setApprovalForAll' }
    : UseContractWriteConfig<typeof erc1155ABI, 'setApprovalForAll', TMode> & {
        abi?: never
        functionName?: 'setApprovalForAll'
      } = {} as any,
) {
  return useContractWrite<typeof erc1155ABI, 'setApprovalForAll', TMode>({
    abi: erc1155ABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as any)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155ABI}__.
 */
export function usePrepareErc1155Write<TFunctionName extends string>(
  config: Omit<
    UsePrepareContractWriteConfig<typeof erc1155ABI, TFunctionName>,
    'abi'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155ABI,
    ...config,
  } as UsePrepareContractWriteConfig<typeof erc1155ABI, TFunctionName>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function usePrepareErc1155SafeBatchTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<typeof erc1155ABI, 'safeBatchTransferFrom'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155ABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof erc1155ABI,
    'safeBatchTransferFrom'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function usePrepareErc1155SafeTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<typeof erc1155ABI, 'safeTransferFrom'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155ABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<typeof erc1155ABI, 'safeTransferFrom'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155ABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function usePrepareErc1155SetApprovalForAll(
  config: Omit<
    UsePrepareContractWriteConfig<typeof erc1155ABI, 'setApprovalForAll'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155ABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as UsePrepareContractWriteConfig<typeof erc1155ABI, 'setApprovalForAll'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155ABI}__.
 */
export function useErc1155Event<TEventName extends string>(
  config: Omit<
    UseContractEventConfig<typeof erc1155ABI, TEventName>,
    'abi'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155ABI,
    ...config,
  } as UseContractEventConfig<typeof erc1155ABI, TEventName>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155ABI}__ and `eventName` set to `"ApprovalForAll"`.
 */
export function useErc1155ApprovalForAllEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155ABI, 'ApprovalForAll'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155ABI,
    eventName: 'ApprovalForAll',
    ...config,
  } as UseContractEventConfig<typeof erc1155ABI, 'ApprovalForAll'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155ABI}__ and `eventName` set to `"TransferBatch"`.
 */
export function useErc1155TransferBatchEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155ABI, 'TransferBatch'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155ABI,
    eventName: 'TransferBatch',
    ...config,
  } as UseContractEventConfig<typeof erc1155ABI, 'TransferBatch'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155ABI}__ and `eventName` set to `"TransferSingle"`.
 */
export function useErc1155TransferSingleEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155ABI, 'TransferSingle'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155ABI,
    eventName: 'TransferSingle',
    ...config,
  } as UseContractEventConfig<typeof erc1155ABI, 'TransferSingle'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155ABI}__ and `eventName` set to `"URI"`.
 */
export function useErc1155UriEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155ABI, 'URI'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155ABI,
    eventName: 'URI',
    ...config,
  } as UseContractEventConfig<typeof erc1155ABI, 'URI'>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__.
 */
export function useErc1155SupplyRead<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"balanceOf"`.
 */
export function useErc1155SupplyBalanceOf<
  TFunctionName extends 'balanceOf',
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    functionName: 'balanceOf',
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"balanceOfBatch"`.
 */
export function useErc1155SupplyBalanceOfBatch<
  TFunctionName extends 'balanceOfBatch',
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    functionName: 'balanceOfBatch',
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"exists"`.
 */
export function useErc1155SupplyExists<
  TFunctionName extends 'exists',
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    functionName: 'exists',
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"isApprovedForAll"`.
 */
export function useErc1155SupplyIsApprovedForAll<
  TFunctionName extends 'isApprovedForAll',
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    functionName: 'isApprovedForAll',
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"supportsInterface"`.
 */
export function useErc1155SupplySupportsInterface<
  TFunctionName extends 'supportsInterface',
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"totalSupply"`.
 */
export function useErc1155SupplyTotalSupply<
  TFunctionName extends 'totalSupply',
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    functionName: 'totalSupply',
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"uri"`.
 */
export function useErc1155SupplyUri<
  TFunctionName extends 'uri',
  TSelectData = ReadContractResult<typeof erc1155SupplyABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc1155SupplyABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc1155SupplyABI,
    functionName: 'uri',
    ...config,
  } as UseContractReadConfig<
    typeof erc1155SupplyABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__.
 */
export function useErc1155SupplyWrite<
  TFunctionName extends string,
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof erc1155SupplyABI,
          string
        >['request']['abi'],
        TFunctionName,
        TMode
      >
    : UseContractWriteConfig<typeof erc1155SupplyABI, TFunctionName, TMode> & {
        abi?: never
      } = {} as any,
) {
  return useContractWrite<typeof erc1155SupplyABI, TFunctionName, TMode>({
    abi: erc1155SupplyABI,
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function useErc1155SupplySafeBatchTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof erc1155SupplyABI,
          'safeBatchTransferFrom'
        >['request']['abi'],
        'safeBatchTransferFrom',
        TMode
      > & { functionName?: 'safeBatchTransferFrom' }
    : UseContractWriteConfig<
        typeof erc1155SupplyABI,
        'safeBatchTransferFrom',
        TMode
      > & {
        abi?: never
        functionName?: 'safeBatchTransferFrom'
      } = {} as any,
) {
  return useContractWrite<
    typeof erc1155SupplyABI,
    'safeBatchTransferFrom',
    TMode
  >({
    abi: erc1155SupplyABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function useErc1155SupplySafeTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof erc1155SupplyABI,
          'safeTransferFrom'
        >['request']['abi'],
        'safeTransferFrom',
        TMode
      > & { functionName?: 'safeTransferFrom' }
    : UseContractWriteConfig<
        typeof erc1155SupplyABI,
        'safeTransferFrom',
        TMode
      > & {
        abi?: never
        functionName?: 'safeTransferFrom'
      } = {} as any,
) {
  return useContractWrite<typeof erc1155SupplyABI, 'safeTransferFrom', TMode>({
    abi: erc1155SupplyABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function useErc1155SupplySetApprovalForAll<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof erc1155SupplyABI,
          'setApprovalForAll'
        >['request']['abi'],
        'setApprovalForAll',
        TMode
      > & { functionName?: 'setApprovalForAll' }
    : UseContractWriteConfig<
        typeof erc1155SupplyABI,
        'setApprovalForAll',
        TMode
      > & {
        abi?: never
        functionName?: 'setApprovalForAll'
      } = {} as any,
) {
  return useContractWrite<typeof erc1155SupplyABI, 'setApprovalForAll', TMode>({
    abi: erc1155SupplyABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as any)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__.
 */
export function usePrepareErc1155SupplyWrite<TFunctionName extends string>(
  config: Omit<
    UsePrepareContractWriteConfig<typeof erc1155SupplyABI, TFunctionName>,
    'abi'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155SupplyABI,
    ...config,
  } as UsePrepareContractWriteConfig<typeof erc1155SupplyABI, TFunctionName>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function usePrepareErc1155SupplySafeBatchTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<
      typeof erc1155SupplyABI,
      'safeBatchTransferFrom'
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155SupplyABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof erc1155SupplyABI,
    'safeBatchTransferFrom'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function usePrepareErc1155SupplySafeTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<typeof erc1155SupplyABI, 'safeTransferFrom'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155SupplyABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof erc1155SupplyABI,
    'safeTransferFrom'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link erc1155SupplyABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function usePrepareErc1155SupplySetApprovalForAll(
  config: Omit<
    UsePrepareContractWriteConfig<typeof erc1155SupplyABI, 'setApprovalForAll'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: erc1155SupplyABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof erc1155SupplyABI,
    'setApprovalForAll'
  >)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155SupplyABI}__.
 */
export function useErc1155SupplyEvent<TEventName extends string>(
  config: Omit<
    UseContractEventConfig<typeof erc1155SupplyABI, TEventName>,
    'abi'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155SupplyABI,
    ...config,
  } as UseContractEventConfig<typeof erc1155SupplyABI, TEventName>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155SupplyABI}__ and `eventName` set to `"ApprovalForAll"`.
 */
export function useErc1155SupplyApprovalForAllEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155SupplyABI, 'ApprovalForAll'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155SupplyABI,
    eventName: 'ApprovalForAll',
    ...config,
  } as UseContractEventConfig<typeof erc1155SupplyABI, 'ApprovalForAll'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155SupplyABI}__ and `eventName` set to `"TransferBatch"`.
 */
export function useErc1155SupplyTransferBatchEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155SupplyABI, 'TransferBatch'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155SupplyABI,
    eventName: 'TransferBatch',
    ...config,
  } as UseContractEventConfig<typeof erc1155SupplyABI, 'TransferBatch'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155SupplyABI}__ and `eventName` set to `"TransferSingle"`.
 */
export function useErc1155SupplyTransferSingleEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155SupplyABI, 'TransferSingle'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155SupplyABI,
    eventName: 'TransferSingle',
    ...config,
  } as UseContractEventConfig<typeof erc1155SupplyABI, 'TransferSingle'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link erc1155SupplyABI}__ and `eventName` set to `"URI"`.
 */
export function useErc1155SupplyUriEvent(
  config: Omit<
    UseContractEventConfig<typeof erc1155SupplyABI, 'URI'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: erc1155SupplyABI,
    eventName: 'URI',
    ...config,
  } as UseContractEventConfig<typeof erc1155SupplyABI, 'URI'>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc165ABI}__.
 */
export function useErc165Read<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof erc165ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc165ABI, TFunctionName, TSelectData>,
    'abi'
  > = {} as any,
) {
  return useContractRead({ abi: erc165ABI, ...config } as UseContractReadConfig<
    typeof erc165ABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link erc165ABI}__ and `functionName` set to `"supportsInterface"`.
 */
export function useErc165SupportsInterface<
  TFunctionName extends 'supportsInterface',
  TSelectData = ReadContractResult<typeof erc165ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof erc165ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: erc165ABI,
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<typeof erc165ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155ABI}__.
 */
export function useIerc1155Read<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof ierc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>,
    'abi'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155ABI,
    ...config,
  } as UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"balanceOf"`.
 */
export function useIerc1155BalanceOf<
  TFunctionName extends 'balanceOf',
  TSelectData = ReadContractResult<typeof ierc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155ABI,
    functionName: 'balanceOf',
    ...config,
  } as UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"balanceOfBatch"`.
 */
export function useIerc1155BalanceOfBatch<
  TFunctionName extends 'balanceOfBatch',
  TSelectData = ReadContractResult<typeof ierc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155ABI,
    functionName: 'balanceOfBatch',
    ...config,
  } as UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"isApprovedForAll"`.
 */
export function useIerc1155IsApprovedForAll<
  TFunctionName extends 'isApprovedForAll',
  TSelectData = ReadContractResult<typeof ierc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155ABI,
    functionName: 'isApprovedForAll',
    ...config,
  } as UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"supportsInterface"`.
 */
export function useIerc1155SupportsInterface<
  TFunctionName extends 'supportsInterface',
  TSelectData = ReadContractResult<typeof ierc1155ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155ABI,
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<typeof ierc1155ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155ABI}__.
 */
export function useIerc1155Write<
  TFunctionName extends string,
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155ABI,
          string
        >['request']['abi'],
        TFunctionName,
        TMode
      >
    : UseContractWriteConfig<typeof ierc1155ABI, TFunctionName, TMode> & {
        abi?: never
      } = {} as any,
) {
  return useContractWrite<typeof ierc1155ABI, TFunctionName, TMode>({
    abi: ierc1155ABI,
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function useIerc1155SafeBatchTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155ABI,
          'safeBatchTransferFrom'
        >['request']['abi'],
        'safeBatchTransferFrom',
        TMode
      > & { functionName?: 'safeBatchTransferFrom' }
    : UseContractWriteConfig<
        typeof ierc1155ABI,
        'safeBatchTransferFrom',
        TMode
      > & {
        abi?: never
        functionName?: 'safeBatchTransferFrom'
      } = {} as any,
) {
  return useContractWrite<typeof ierc1155ABI, 'safeBatchTransferFrom', TMode>({
    abi: ierc1155ABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function useIerc1155SafeTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155ABI,
          'safeTransferFrom'
        >['request']['abi'],
        'safeTransferFrom',
        TMode
      > & { functionName?: 'safeTransferFrom' }
    : UseContractWriteConfig<typeof ierc1155ABI, 'safeTransferFrom', TMode> & {
        abi?: never
        functionName?: 'safeTransferFrom'
      } = {} as any,
) {
  return useContractWrite<typeof ierc1155ABI, 'safeTransferFrom', TMode>({
    abi: ierc1155ABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function useIerc1155SetApprovalForAll<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155ABI,
          'setApprovalForAll'
        >['request']['abi'],
        'setApprovalForAll',
        TMode
      > & { functionName?: 'setApprovalForAll' }
    : UseContractWriteConfig<typeof ierc1155ABI, 'setApprovalForAll', TMode> & {
        abi?: never
        functionName?: 'setApprovalForAll'
      } = {} as any,
) {
  return useContractWrite<typeof ierc1155ABI, 'setApprovalForAll', TMode>({
    abi: ierc1155ABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as any)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155ABI}__.
 */
export function usePrepareIerc1155Write<TFunctionName extends string>(
  config: Omit<
    UsePrepareContractWriteConfig<typeof ierc1155ABI, TFunctionName>,
    'abi'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155ABI,
    ...config,
  } as UsePrepareContractWriteConfig<typeof ierc1155ABI, TFunctionName>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function usePrepareIerc1155SafeBatchTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<typeof ierc1155ABI, 'safeBatchTransferFrom'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155ABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof ierc1155ABI,
    'safeBatchTransferFrom'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function usePrepareIerc1155SafeTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<typeof ierc1155ABI, 'safeTransferFrom'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155ABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<typeof ierc1155ABI, 'safeTransferFrom'>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155ABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function usePrepareIerc1155SetApprovalForAll(
  config: Omit<
    UsePrepareContractWriteConfig<typeof ierc1155ABI, 'setApprovalForAll'>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155ABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as UsePrepareContractWriteConfig<typeof ierc1155ABI, 'setApprovalForAll'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155ABI}__.
 */
export function useIerc1155Event<TEventName extends string>(
  config: Omit<
    UseContractEventConfig<typeof ierc1155ABI, TEventName>,
    'abi'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155ABI,
    ...config,
  } as UseContractEventConfig<typeof ierc1155ABI, TEventName>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155ABI}__ and `eventName` set to `"ApprovalForAll"`.
 */
export function useIerc1155ApprovalForAllEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155ABI, 'ApprovalForAll'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155ABI,
    eventName: 'ApprovalForAll',
    ...config,
  } as UseContractEventConfig<typeof ierc1155ABI, 'ApprovalForAll'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155ABI}__ and `eventName` set to `"TransferBatch"`.
 */
export function useIerc1155TransferBatchEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155ABI, 'TransferBatch'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155ABI,
    eventName: 'TransferBatch',
    ...config,
  } as UseContractEventConfig<typeof ierc1155ABI, 'TransferBatch'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155ABI}__ and `eventName` set to `"TransferSingle"`.
 */
export function useIerc1155TransferSingleEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155ABI, 'TransferSingle'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155ABI,
    eventName: 'TransferSingle',
    ...config,
  } as UseContractEventConfig<typeof ierc1155ABI, 'TransferSingle'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155ABI}__ and `eventName` set to `"URI"`.
 */
export function useIerc1155UriEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155ABI, 'URI'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155ABI,
    eventName: 'URI',
    ...config,
  } as UseContractEventConfig<typeof ierc1155ABI, 'URI'>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155MetadataUriABI}__.
 */
export function useIerc1155MetadataUriRead<
  TFunctionName extends string,
  TSelectData = ReadContractResult<
    typeof ierc1155MetadataUriABI,
    TFunctionName
  >,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155MetadataUriABI,
      TFunctionName,
      TSelectData
    >,
    'abi'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155MetadataUriABI,
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155MetadataUriABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"balanceOf"`.
 */
export function useIerc1155MetadataUriBalanceOf<
  TFunctionName extends 'balanceOf',
  TSelectData = ReadContractResult<
    typeof ierc1155MetadataUriABI,
    TFunctionName
  >,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155MetadataUriABI,
      TFunctionName,
      TSelectData
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155MetadataUriABI,
    functionName: 'balanceOf',
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155MetadataUriABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"balanceOfBatch"`.
 */
export function useIerc1155MetadataUriBalanceOfBatch<
  TFunctionName extends 'balanceOfBatch',
  TSelectData = ReadContractResult<
    typeof ierc1155MetadataUriABI,
    TFunctionName
  >,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155MetadataUriABI,
      TFunctionName,
      TSelectData
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155MetadataUriABI,
    functionName: 'balanceOfBatch',
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155MetadataUriABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"isApprovedForAll"`.
 */
export function useIerc1155MetadataUriIsApprovedForAll<
  TFunctionName extends 'isApprovedForAll',
  TSelectData = ReadContractResult<
    typeof ierc1155MetadataUriABI,
    TFunctionName
  >,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155MetadataUriABI,
      TFunctionName,
      TSelectData
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155MetadataUriABI,
    functionName: 'isApprovedForAll',
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155MetadataUriABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"supportsInterface"`.
 */
export function useIerc1155MetadataUriSupportsInterface<
  TFunctionName extends 'supportsInterface',
  TSelectData = ReadContractResult<
    typeof ierc1155MetadataUriABI,
    TFunctionName
  >,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155MetadataUriABI,
      TFunctionName,
      TSelectData
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155MetadataUriABI,
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155MetadataUriABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"uri"`.
 */
export function useIerc1155MetadataUriUri<
  TFunctionName extends 'uri',
  TSelectData = ReadContractResult<
    typeof ierc1155MetadataUriABI,
    TFunctionName
  >,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155MetadataUriABI,
      TFunctionName,
      TSelectData
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155MetadataUriABI,
    functionName: 'uri',
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155MetadataUriABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__.
 */
export function useIerc1155MetadataUriWrite<
  TFunctionName extends string,
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155MetadataUriABI,
          string
        >['request']['abi'],
        TFunctionName,
        TMode
      >
    : UseContractWriteConfig<
        typeof ierc1155MetadataUriABI,
        TFunctionName,
        TMode
      > & {
        abi?: never
      } = {} as any,
) {
  return useContractWrite<typeof ierc1155MetadataUriABI, TFunctionName, TMode>({
    abi: ierc1155MetadataUriABI,
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function useIerc1155MetadataUriSafeBatchTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155MetadataUriABI,
          'safeBatchTransferFrom'
        >['request']['abi'],
        'safeBatchTransferFrom',
        TMode
      > & { functionName?: 'safeBatchTransferFrom' }
    : UseContractWriteConfig<
        typeof ierc1155MetadataUriABI,
        'safeBatchTransferFrom',
        TMode
      > & {
        abi?: never
        functionName?: 'safeBatchTransferFrom'
      } = {} as any,
) {
  return useContractWrite<
    typeof ierc1155MetadataUriABI,
    'safeBatchTransferFrom',
    TMode
  >({
    abi: ierc1155MetadataUriABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function useIerc1155MetadataUriSafeTransferFrom<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155MetadataUriABI,
          'safeTransferFrom'
        >['request']['abi'],
        'safeTransferFrom',
        TMode
      > & { functionName?: 'safeTransferFrom' }
    : UseContractWriteConfig<
        typeof ierc1155MetadataUriABI,
        'safeTransferFrom',
        TMode
      > & {
        abi?: never
        functionName?: 'safeTransferFrom'
      } = {} as any,
) {
  return useContractWrite<
    typeof ierc1155MetadataUriABI,
    'safeTransferFrom',
    TMode
  >({
    abi: ierc1155MetadataUriABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function useIerc1155MetadataUriSetApprovalForAll<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155MetadataUriABI,
          'setApprovalForAll'
        >['request']['abi'],
        'setApprovalForAll',
        TMode
      > & { functionName?: 'setApprovalForAll' }
    : UseContractWriteConfig<
        typeof ierc1155MetadataUriABI,
        'setApprovalForAll',
        TMode
      > & {
        abi?: never
        functionName?: 'setApprovalForAll'
      } = {} as any,
) {
  return useContractWrite<
    typeof ierc1155MetadataUriABI,
    'setApprovalForAll',
    TMode
  >({
    abi: ierc1155MetadataUriABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as any)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__.
 */
export function usePrepareIerc1155MetadataUriWrite<
  TFunctionName extends string,
>(
  config: Omit<
    UsePrepareContractWriteConfig<typeof ierc1155MetadataUriABI, TFunctionName>,
    'abi'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155MetadataUriABI,
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof ierc1155MetadataUriABI,
    TFunctionName
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"safeBatchTransferFrom"`.
 */
export function usePrepareIerc1155MetadataUriSafeBatchTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<
      typeof ierc1155MetadataUriABI,
      'safeBatchTransferFrom'
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155MetadataUriABI,
    functionName: 'safeBatchTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof ierc1155MetadataUriABI,
    'safeBatchTransferFrom'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"safeTransferFrom"`.
 */
export function usePrepareIerc1155MetadataUriSafeTransferFrom(
  config: Omit<
    UsePrepareContractWriteConfig<
      typeof ierc1155MetadataUriABI,
      'safeTransferFrom'
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155MetadataUriABI,
    functionName: 'safeTransferFrom',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof ierc1155MetadataUriABI,
    'safeTransferFrom'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `functionName` set to `"setApprovalForAll"`.
 */
export function usePrepareIerc1155MetadataUriSetApprovalForAll(
  config: Omit<
    UsePrepareContractWriteConfig<
      typeof ierc1155MetadataUriABI,
      'setApprovalForAll'
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155MetadataUriABI,
    functionName: 'setApprovalForAll',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof ierc1155MetadataUriABI,
    'setApprovalForAll'
  >)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriABI}__.
 */
export function useIerc1155MetadataUriEvent<TEventName extends string>(
  config: Omit<
    UseContractEventConfig<typeof ierc1155MetadataUriABI, TEventName>,
    'abi'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155MetadataUriABI,
    ...config,
  } as UseContractEventConfig<typeof ierc1155MetadataUriABI, TEventName>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `eventName` set to `"ApprovalForAll"`.
 */
export function useIerc1155MetadataUriApprovalForAllEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155MetadataUriABI, 'ApprovalForAll'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155MetadataUriABI,
    eventName: 'ApprovalForAll',
    ...config,
  } as UseContractEventConfig<typeof ierc1155MetadataUriABI, 'ApprovalForAll'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `eventName` set to `"TransferBatch"`.
 */
export function useIerc1155MetadataUriTransferBatchEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155MetadataUriABI, 'TransferBatch'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155MetadataUriABI,
    eventName: 'TransferBatch',
    ...config,
  } as UseContractEventConfig<typeof ierc1155MetadataUriABI, 'TransferBatch'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `eventName` set to `"TransferSingle"`.
 */
export function useIerc1155MetadataUriTransferSingleEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155MetadataUriABI, 'TransferSingle'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155MetadataUriABI,
    eventName: 'TransferSingle',
    ...config,
  } as UseContractEventConfig<typeof ierc1155MetadataUriABI, 'TransferSingle'>)
}

/**
 * Wraps __{@link useContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriABI}__ and `eventName` set to `"URI"`.
 */
export function useIerc1155MetadataUriUriEvent(
  config: Omit<
    UseContractEventConfig<typeof ierc1155MetadataUriABI, 'URI'>,
    'abi' | 'eventName'
  > = {} as any,
) {
  return useContractEvent({
    abi: ierc1155MetadataUriABI,
    eventName: 'URI',
    ...config,
  } as UseContractEventConfig<typeof ierc1155MetadataUriABI, 'URI'>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155ReceiverABI}__.
 */
export function useIerc1155ReceiverRead<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof ierc1155ReceiverABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155ReceiverABI,
      TFunctionName,
      TSelectData
    >,
    'abi'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155ReceiverABI,
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155ReceiverABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc1155ReceiverABI}__ and `functionName` set to `"supportsInterface"`.
 */
export function useIerc1155ReceiverSupportsInterface<
  TFunctionName extends 'supportsInterface',
  TSelectData = ReadContractResult<typeof ierc1155ReceiverABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<
      typeof ierc1155ReceiverABI,
      TFunctionName,
      TSelectData
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc1155ReceiverABI,
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<
    typeof ierc1155ReceiverABI,
    TFunctionName,
    TSelectData
  >)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155ReceiverABI}__.
 */
export function useIerc1155ReceiverWrite<
  TFunctionName extends string,
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155ReceiverABI,
          string
        >['request']['abi'],
        TFunctionName,
        TMode
      >
    : UseContractWriteConfig<
        typeof ierc1155ReceiverABI,
        TFunctionName,
        TMode
      > & {
        abi?: never
      } = {} as any,
) {
  return useContractWrite<typeof ierc1155ReceiverABI, TFunctionName, TMode>({
    abi: ierc1155ReceiverABI,
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155ReceiverABI}__ and `functionName` set to `"onERC1155BatchReceived"`.
 */
export function useIerc1155ReceiverOnErc1155BatchReceived<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155ReceiverABI,
          'onERC1155BatchReceived'
        >['request']['abi'],
        'onERC1155BatchReceived',
        TMode
      > & { functionName?: 'onERC1155BatchReceived' }
    : UseContractWriteConfig<
        typeof ierc1155ReceiverABI,
        'onERC1155BatchReceived',
        TMode
      > & {
        abi?: never
        functionName?: 'onERC1155BatchReceived'
      } = {} as any,
) {
  return useContractWrite<
    typeof ierc1155ReceiverABI,
    'onERC1155BatchReceived',
    TMode
  >({
    abi: ierc1155ReceiverABI,
    functionName: 'onERC1155BatchReceived',
    ...config,
  } as any)
}

/**
 * Wraps __{@link useContractWrite}__ with `abi` set to __{@link ierc1155ReceiverABI}__ and `functionName` set to `"onERC1155Received"`.
 */
export function useIerc1155ReceiverOnErc1155Received<
  TMode extends WriteContractMode = undefined,
>(
  config: TMode extends 'prepared'
    ? UseContractWriteConfig<
        PrepareWriteContractResult<
          typeof ierc1155ReceiverABI,
          'onERC1155Received'
        >['request']['abi'],
        'onERC1155Received',
        TMode
      > & { functionName?: 'onERC1155Received' }
    : UseContractWriteConfig<
        typeof ierc1155ReceiverABI,
        'onERC1155Received',
        TMode
      > & {
        abi?: never
        functionName?: 'onERC1155Received'
      } = {} as any,
) {
  return useContractWrite<
    typeof ierc1155ReceiverABI,
    'onERC1155Received',
    TMode
  >({
    abi: ierc1155ReceiverABI,
    functionName: 'onERC1155Received',
    ...config,
  } as any)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155ReceiverABI}__.
 */
export function usePrepareIerc1155ReceiverWrite<TFunctionName extends string>(
  config: Omit<
    UsePrepareContractWriteConfig<typeof ierc1155ReceiverABI, TFunctionName>,
    'abi'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155ReceiverABI,
    ...config,
  } as UsePrepareContractWriteConfig<typeof ierc1155ReceiverABI, TFunctionName>)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155ReceiverABI}__ and `functionName` set to `"onERC1155BatchReceived"`.
 */
export function usePrepareIerc1155ReceiverOnErc1155BatchReceived(
  config: Omit<
    UsePrepareContractWriteConfig<
      typeof ierc1155ReceiverABI,
      'onERC1155BatchReceived'
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155ReceiverABI,
    functionName: 'onERC1155BatchReceived',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof ierc1155ReceiverABI,
    'onERC1155BatchReceived'
  >)
}

/**
 * Wraps __{@link usePrepareContractWrite}__ with `abi` set to __{@link ierc1155ReceiverABI}__ and `functionName` set to `"onERC1155Received"`.
 */
export function usePrepareIerc1155ReceiverOnErc1155Received(
  config: Omit<
    UsePrepareContractWriteConfig<
      typeof ierc1155ReceiverABI,
      'onERC1155Received'
    >,
    'abi' | 'functionName'
  > = {} as any,
) {
  return usePrepareContractWrite({
    abi: ierc1155ReceiverABI,
    functionName: 'onERC1155Received',
    ...config,
  } as UsePrepareContractWriteConfig<
    typeof ierc1155ReceiverABI,
    'onERC1155Received'
  >)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc165ABI}__.
 */
export function useIerc165Read<
  TFunctionName extends string,
  TSelectData = ReadContractResult<typeof ierc165ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof ierc165ABI, TFunctionName, TSelectData>,
    'abi'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc165ABI,
    ...config,
  } as UseContractReadConfig<typeof ierc165ABI, TFunctionName, TSelectData>)
}

/**
 * Wraps __{@link useContractRead}__ with `abi` set to __{@link ierc165ABI}__ and `functionName` set to `"supportsInterface"`.
 */
export function useIerc165SupportsInterface<
  TFunctionName extends 'supportsInterface',
  TSelectData = ReadContractResult<typeof ierc165ABI, TFunctionName>,
>(
  config: Omit<
    UseContractReadConfig<typeof ierc165ABI, TFunctionName, TSelectData>,
    'abi' | 'functionName'
  > = {} as any,
) {
  return useContractRead({
    abi: ierc165ABI,
    functionName: 'supportsInterface',
    ...config,
  } as UseContractReadConfig<typeof ierc165ABI, TFunctionName, TSelectData>)
}
