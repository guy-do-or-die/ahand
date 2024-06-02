import {
  createUseReadContract,
  createUseWriteContract,
  createUseSimulateContract,
  createUseWatchContractEvent,
} from 'wagmi/codegen'

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AHand
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const aHandAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_raiser', internalType: 'address', type: 'address' },
      { name: '_problem', internalType: 'string', type: 'string' },
      { name: 'ref', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'payable',
  },
  { type: 'fallback', stateMutability: 'payable' },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'giver', internalType: 'address', type: 'address' },
      { name: 'solution', internalType: 'string', type: 'string' },
    ],
    name: 'give',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'origin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'problem',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'raiser',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'refs',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'shaker', internalType: 'address', type: 'address' },
    ],
    name: 'shake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'shakes',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'ref', internalType: 'address', type: 'address' }],
    name: 'shakesChain',
    outputs: [{ name: 'chain', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'solutions',
    outputs: [
      { name: 'giver', internalType: 'address', type: 'address' },
      { name: 'solution', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'solutionsNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'solved',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'thanker', internalType: 'address', type: 'address' },
      { name: 'solutionIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'thank',
    outputs: [],
    stateMutability: 'nonpayable',
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
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AHandBase
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const aHandBaseAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'hand', internalType: 'address', type: 'address' }],
    name: 'getProblem',
    outputs: [],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address' },
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'solution', internalType: 'string', type: 'string' },
    ],
    name: 'give',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'hands',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'handsNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'problem', internalType: 'string', type: 'string' },
      { name: 'ref', internalType: 'address', type: 'address' },
    ],
    name: 'raise',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address' },
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
    ],
    name: 'shake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address' },
      { name: 'solutionIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'thank',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'thumbsDown',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'pure',
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
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC1155InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidApprover',
  },
  {
    type: 'error',
    inputs: [
      { name: 'idsLength', internalType: 'uint256', type: 'uint256' },
      { name: 'valuesLength', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC1155InvalidArrayLength',
  },
  {
    type: 'error',
    inputs: [{ name: 'operator', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidSender',
  },
  {
    type: 'error',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC1155MissingApprovalForAll',
  },
] as const

/**
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const aHandBaseAddress = {
  10: '0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab',
  137: '0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D',
  420: '0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7',
  8453: '0xE6cb0c675C8A532638d6a811559A48369F9f4DE8',
  31337: '0xb609D06B30481d9c8f220e3051d3BA41f48DDb2A',
  80001: '0x4e9642dfB5FAf70a512651DA1334DBfE5934D781',
  84531: '0xE6cb0c675C8A532638d6a811559A48369F9f4DE8',
  534351: '0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6',
  534352: '0xe8099DA63a29ac26E51bce9df7506333D739e438',
} as const

/**
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const aHandBaseConfig = {
  address: aHandBaseAddress,
  abi: aHandBaseAbi,
} as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155Abi = [
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
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
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC1155InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidApprover',
  },
  {
    type: 'error',
    inputs: [
      { name: 'idsLength', internalType: 'uint256', type: 'uint256' },
      { name: 'valuesLength', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC1155InvalidArrayLength',
  },
  {
    type: 'error',
    inputs: [{ name: 'operator', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidSender',
  },
  {
    type: 'error',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC1155MissingApprovalForAll',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155Supply
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155SupplyAbi = [
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
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'exists',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
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
    stateMutability: 'nonpayable',
  },
  {
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
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC165
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc165Abi = [
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155Abi = [
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
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
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155Errors
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155ErrorsAbi = [
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC1155InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidApprover',
  },
  {
    type: 'error',
    inputs: [
      { name: 'idsLength', internalType: 'uint256', type: 'uint256' },
      { name: 'valuesLength', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC1155InvalidArrayLength',
  },
  {
    type: 'error',
    inputs: [{ name: 'operator', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC1155InvalidSender',
  },
  {
    type: 'error',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC1155MissingApprovalForAll',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155MetadataURI
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155MetadataUriAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'balanceOfBatch',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
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
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155Receiver
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155ReceiverAbi = [
  {
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
    stateMutability: 'nonpayable',
  },
  {
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
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC165
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc165Abi = [
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC20Errors
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc20ErrorsAbi = [
  {
    type: 'error',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'allowance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientAllowance',
  },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'spender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSpender',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC721Errors
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc721ErrorsAbi = [
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC721IncorrectOwner',
  },
  {
    type: 'error',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC721InsufficientApproval',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'operator', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'ERC721NonexistentToken',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Math
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const mathAbi = [
  { type: 'error', inputs: [], name: 'MathOverflowedMulDiv' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Strings
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const stringsAbi = [
  {
    type: 'error',
    inputs: [
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'length', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'StringsInsufficientHexLength',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// React
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__
 */
export const useReadAHand = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"origin"`
 */
export const useReadAHandOrigin = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'origin',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"problem"`
 */
export const useReadAHandProblem = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'problem',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"raiser"`
 */
export const useReadAHandRaiser = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'raiser',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"refs"`
 */
export const useReadAHandRefs = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'refs',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"shakes"`
 */
export const useReadAHandShakes = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'shakes',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"shakesChain"`
 */
export const useReadAHandShakesChain = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'shakesChain',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"solutions"`
 */
export const useReadAHandSolutions = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'solutions',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"solutionsNumber"`
 */
export const useReadAHandSolutionsNumber = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'solutionsNumber',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"solved"`
 */
export const useReadAHandSolved = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'solved',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandAbi}__
 */
export const useWriteAHand = /*#__PURE__*/ createUseWriteContract({
  abi: aHandAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"give"`
 */
export const useWriteAHandGive = /*#__PURE__*/ createUseWriteContract({
  abi: aHandAbi,
  functionName: 'give',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"shake"`
 */
export const useWriteAHandShake = /*#__PURE__*/ createUseWriteContract({
  abi: aHandAbi,
  functionName: 'shake',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"thank"`
 */
export const useWriteAHandThank = /*#__PURE__*/ createUseWriteContract({
  abi: aHandAbi,
  functionName: 'thank',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandAbi}__
 */
export const useSimulateAHand = /*#__PURE__*/ createUseSimulateContract({
  abi: aHandAbi,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"give"`
 */
export const useSimulateAHandGive = /*#__PURE__*/ createUseSimulateContract({
  abi: aHandAbi,
  functionName: 'give',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"shake"`
 */
export const useSimulateAHandShake = /*#__PURE__*/ createUseSimulateContract({
  abi: aHandAbi,
  functionName: 'shake',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"thank"`
 */
export const useSimulateAHandThank = /*#__PURE__*/ createUseSimulateContract({
  abi: aHandAbi,
  functionName: 'thank',
})

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandAbi}__
 */
export const useWatchAHandEvent = /*#__PURE__*/ createUseWatchContractEvent({
  abi: aHandAbi,
})

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandAbi}__ and `eventName` set to `"Given"`
 */
export const useWatchAHandGivenEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandAbi,
    eventName: 'Given',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandAbi}__ and `eventName` set to `"Shaken"`
 */
export const useWatchAHandShakenEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandAbi,
    eventName: 'Shaken',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandAbi}__ and `eventName` set to `"Thanked"`
 */
export const useWatchAHandThankedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandAbi,
    eventName: 'Thanked',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBase = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"balanceOf"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseBalanceOf = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'balanceOf',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"balanceOfBatch"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseBalanceOfBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'balanceOfBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"getProblem"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseGetProblem = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'getProblem',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"hands"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseHands = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'hands',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"handsNumber"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseHandsNumber = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'handsNumber',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"isApprovedForAll"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseIsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"supportsInterface"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseSupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"uri"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useReadAHandBaseUri = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'uri',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBase = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"give"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseGive = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'give',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"raise"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseRaise = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'raise',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseSafeBatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"safeTransferFrom"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseSafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"setApprovalForAll"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseSetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"shake"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseShake = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'shake',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thank"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseThank = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'thank',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thumbsDown"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWriteAHandBaseThumbsDown = /*#__PURE__*/ createUseWriteContract(
  { abi: aHandBaseAbi, address: aHandBaseAddress, functionName: 'thumbsDown' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBase = /*#__PURE__*/ createUseSimulateContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"give"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseGive = /*#__PURE__*/ createUseSimulateContract(
  { abi: aHandBaseAbi, address: aHandBaseAddress, functionName: 'give' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"raise"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseRaise =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'raise',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseSafeBatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"safeTransferFrom"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseSafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"setApprovalForAll"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseSetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"shake"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseShake =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'shake',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thank"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseThank =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'thank',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thumbsDown"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useSimulateAHandBaseThumbsDown =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'thumbsDown',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWatchAHandBaseEvent = /*#__PURE__*/ createUseWatchContractEvent(
  { abi: aHandBaseAbi, address: aHandBaseAddress },
)

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"ApprovalForAll"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWatchAHandBaseApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"Raised"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWatchAHandBaseRaisedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'Raised',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"TransferBatch"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWatchAHandBaseTransferBatchEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'TransferBatch',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"TransferSingle"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWatchAHandBaseTransferSingleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'TransferSingle',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"URI"`
 *
 * - [__View Contract on Op Mainnet Optimism Explorer__](https://optimistic.etherscan.io/address/0xBD4Bac9f3D33800518C243173b4e5D3C34A8f9ab)
 * - [__View Contract on Polygon Polygon Scan__](https://polygonscan.com/address/0xE1443A1b6D9AF6893a61Aa4281200c2A16CFAc4D)
 * - [__View Contract on Optimism Goerli Etherscan__](https://goerli-optimism.etherscan.io/address/0x8CD0C31FaF26801b51Bc556eBCCbbB35A51927c7)
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * -
 * - [__View Contract on Polygon Mumbai Polygon Scan__](https://mumbai.polygonscan.com/address/0x4e9642dfB5FAf70a512651DA1334DBfE5934D781)
 * - [__View Contract on Base Goerli Basescan__](https://goerli.basescan.org/address/0xE6cb0c675C8A532638d6a811559A48369F9f4DE8)
 * - [__View Contract on Scroll Sepolia Blockscout__](https://sepolia-blockscout.scroll.io/address/0x9066E0f7097849B78f3b45c7C2F9fe69371bA6E6)
 * - [__View Contract on Scroll Scrollscan__](https://scrollscan.com/address/0xe8099DA63a29ac26E51bce9df7506333D739e438)
 */
export const useWatchAHandBaseUriEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'URI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155Abi}__
 */
export const useReadErc1155 = /*#__PURE__*/ createUseReadContract({
  abi: erc1155Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadErc1155BalanceOf = /*#__PURE__*/ createUseReadContract({
  abi: erc1155Abi,
  functionName: 'balanceOf',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"balanceOfBatch"`
 */
export const useReadErc1155BalanceOfBatch = /*#__PURE__*/ createUseReadContract(
  { abi: erc1155Abi, functionName: 'balanceOfBatch' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useReadErc1155IsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155Abi,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadErc1155SupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155Abi,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"uri"`
 */
export const useReadErc1155Uri = /*#__PURE__*/ createUseReadContract({
  abi: erc1155Abi,
  functionName: 'uri',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155Abi}__
 */
export const useWriteErc1155 = /*#__PURE__*/ createUseWriteContract({
  abi: erc1155Abi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useWriteErc1155SafeBatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155Abi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useWriteErc1155SafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155Abi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useWriteErc1155SetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155Abi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155Abi}__
 */
export const useSimulateErc1155 = /*#__PURE__*/ createUseSimulateContract({
  abi: erc1155Abi,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useSimulateErc1155SafeBatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155Abi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useSimulateErc1155SafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155Abi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155Abi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useSimulateErc1155SetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155Abi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155Abi}__
 */
export const useWatchErc1155Event = /*#__PURE__*/ createUseWatchContractEvent({
  abi: erc1155Abi,
})

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155Abi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useWatchErc1155ApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155Abi,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155Abi}__ and `eventName` set to `"TransferBatch"`
 */
export const useWatchErc1155TransferBatchEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155Abi,
    eventName: 'TransferBatch',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155Abi}__ and `eventName` set to `"TransferSingle"`
 */
export const useWatchErc1155TransferSingleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155Abi,
    eventName: 'TransferSingle',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155Abi}__ and `eventName` set to `"URI"`
 */
export const useWatchErc1155UriEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155Abi,
    eventName: 'URI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__
 */
export const useReadErc1155Supply = /*#__PURE__*/ createUseReadContract({
  abi: erc1155SupplyAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadErc1155SupplyBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155SupplyAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"balanceOfBatch"`
 */
export const useReadErc1155SupplyBalanceOfBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155SupplyAbi,
    functionName: 'balanceOfBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"exists"`
 */
export const useReadErc1155SupplyExists = /*#__PURE__*/ createUseReadContract({
  abi: erc1155SupplyAbi,
  functionName: 'exists',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useReadErc1155SupplyIsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155SupplyAbi,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadErc1155SupplySupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155SupplyAbi,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"totalSupply"`
 */
export const useReadErc1155SupplyTotalSupply =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155SupplyAbi,
    functionName: 'totalSupply',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"uri"`
 */
export const useReadErc1155SupplyUri = /*#__PURE__*/ createUseReadContract({
  abi: erc1155SupplyAbi,
  functionName: 'uri',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155SupplyAbi}__
 */
export const useWriteErc1155Supply = /*#__PURE__*/ createUseWriteContract({
  abi: erc1155SupplyAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useWriteErc1155SupplySafeBatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155SupplyAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useWriteErc1155SupplySafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155SupplyAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useWriteErc1155SupplySetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155SupplyAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155SupplyAbi}__
 */
export const useSimulateErc1155Supply = /*#__PURE__*/ createUseSimulateContract(
  { abi: erc1155SupplyAbi },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useSimulateErc1155SupplySafeBatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155SupplyAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useSimulateErc1155SupplySafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155SupplyAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useSimulateErc1155SupplySetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155SupplyAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155SupplyAbi}__
 */
export const useWatchErc1155SupplyEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc1155SupplyAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useWatchErc1155SupplyApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155SupplyAbi,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `eventName` set to `"TransferBatch"`
 */
export const useWatchErc1155SupplyTransferBatchEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155SupplyAbi,
    eventName: 'TransferBatch',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `eventName` set to `"TransferSingle"`
 */
export const useWatchErc1155SupplyTransferSingleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155SupplyAbi,
    eventName: 'TransferSingle',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155SupplyAbi}__ and `eventName` set to `"URI"`
 */
export const useWatchErc1155SupplyUriEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155SupplyAbi,
    eventName: 'URI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc165Abi}__
 */
export const useReadErc165 = /*#__PURE__*/ createUseReadContract({
  abi: erc165Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc165Abi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadErc165SupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: erc165Abi,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155Abi}__
 */
export const useReadIerc1155 = /*#__PURE__*/ createUseReadContract({
  abi: ierc1155Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadIerc1155BalanceOf = /*#__PURE__*/ createUseReadContract({
  abi: ierc1155Abi,
  functionName: 'balanceOf',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"balanceOfBatch"`
 */
export const useReadIerc1155BalanceOfBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155Abi,
    functionName: 'balanceOfBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useReadIerc1155IsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155Abi,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadIerc1155SupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155Abi,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155Abi}__
 */
export const useWriteIerc1155 = /*#__PURE__*/ createUseWriteContract({
  abi: ierc1155Abi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useWriteIerc1155SafeBatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155Abi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useWriteIerc1155SafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155Abi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useWriteIerc1155SetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155Abi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155Abi}__
 */
export const useSimulateIerc1155 = /*#__PURE__*/ createUseSimulateContract({
  abi: ierc1155Abi,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useSimulateIerc1155SafeBatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155Abi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useSimulateIerc1155SafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155Abi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155Abi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useSimulateIerc1155SetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155Abi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155Abi}__
 */
export const useWatchIerc1155Event = /*#__PURE__*/ createUseWatchContractEvent({
  abi: ierc1155Abi,
})

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155Abi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useWatchIerc1155ApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155Abi,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155Abi}__ and `eventName` set to `"TransferBatch"`
 */
export const useWatchIerc1155TransferBatchEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155Abi,
    eventName: 'TransferBatch',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155Abi}__ and `eventName` set to `"TransferSingle"`
 */
export const useWatchIerc1155TransferSingleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155Abi,
    eventName: 'TransferSingle',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155Abi}__ and `eventName` set to `"URI"`
 */
export const useWatchIerc1155UriEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155Abi,
    eventName: 'URI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__
 */
export const useReadIerc1155MetadataUri = /*#__PURE__*/ createUseReadContract({
  abi: ierc1155MetadataUriAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadIerc1155MetadataUriBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"balanceOfBatch"`
 */
export const useReadIerc1155MetadataUriBalanceOfBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'balanceOfBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useReadIerc1155MetadataUriIsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadIerc1155MetadataUriSupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"uri"`
 */
export const useReadIerc1155MetadataUriUri =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'uri',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__
 */
export const useWriteIerc1155MetadataUri = /*#__PURE__*/ createUseWriteContract(
  { abi: ierc1155MetadataUriAbi },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useWriteIerc1155MetadataUriSafeBatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useWriteIerc1155MetadataUriSafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useWriteIerc1155MetadataUriSetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__
 */
export const useSimulateIerc1155MetadataUri =
  /*#__PURE__*/ createUseSimulateContract({ abi: ierc1155MetadataUriAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useSimulateIerc1155MetadataUriSafeBatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useSimulateIerc1155MetadataUriSafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useSimulateIerc1155MetadataUriSetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155MetadataUriAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__
 */
export const useWatchIerc1155MetadataUriEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: ierc1155MetadataUriAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useWatchIerc1155MetadataUriApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155MetadataUriAbi,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `eventName` set to `"TransferBatch"`
 */
export const useWatchIerc1155MetadataUriTransferBatchEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155MetadataUriAbi,
    eventName: 'TransferBatch',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `eventName` set to `"TransferSingle"`
 */
export const useWatchIerc1155MetadataUriTransferSingleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155MetadataUriAbi,
    eventName: 'TransferSingle',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ierc1155MetadataUriAbi}__ and `eventName` set to `"URI"`
 */
export const useWatchIerc1155MetadataUriUriEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ierc1155MetadataUriAbi,
    eventName: 'URI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__
 */
export const useReadIerc1155Receiver = /*#__PURE__*/ createUseReadContract({
  abi: ierc1155ReceiverAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadIerc1155ReceiverSupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__
 */
export const useWriteIerc1155Receiver = /*#__PURE__*/ createUseWriteContract({
  abi: ierc1155ReceiverAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useWriteIerc1155ReceiverOnErc1155BatchReceived =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155BatchReceived',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useWriteIerc1155ReceiverOnErc1155Received =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155Received',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__
 */
export const useSimulateIerc1155Receiver =
  /*#__PURE__*/ createUseSimulateContract({ abi: ierc1155ReceiverAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useSimulateIerc1155ReceiverOnErc1155BatchReceived =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155BatchReceived',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useSimulateIerc1155ReceiverOnErc1155Received =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155Received',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc165Abi}__
 */
export const useReadIerc165 = /*#__PURE__*/ createUseReadContract({
  abi: ierc165Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc165Abi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadIerc165SupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc165Abi,
    functionName: 'supportsInterface',
  })
