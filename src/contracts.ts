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
      { name: '_link', internalType: 'string', type: 'string' },
      { name: 'ref', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'payable',
  },
  { type: 'fallback', stateMutability: 'payable' },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CHARITY_RATE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_MAINT_RATE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_RATE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_SHAKES_CHAIN_LEN',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MIN_CHARITY_RATE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
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
    name: 'link',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
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
    inputs: [
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'shaker', internalType: 'address', type: 'address' },
      { name: 'comment', internalType: 'string', type: 'string' },
    ],
    name: 'shake',
    outputs: [],
    stateMutability: 'nonpayable',
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
    inputs: [{ name: 'ref', internalType: 'address', type: 'address' }],
    name: 'shakesChainLen',
    outputs: [{ name: 'length', internalType: 'uint256', type: 'uint256' }],
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
      { name: 'thankRate', internalType: 'uint256', type: 'uint256' },
      { name: 'charity', internalType: 'address', type: 'address' },
      { name: 'charityRate', internalType: 'uint256', type: 'uint256' },
      { name: 'maint', internalType: 'address', type: 'address' },
      { name: 'maintRate', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'thank',
    outputs: [
      { name: 'thankAmount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'shaker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'comment',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'Comment',
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
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AHandBase
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const aHandBaseAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MINIMUM_REWARD',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'charityAddress', internalType: 'address', type: 'address' },
    ],
    name: 'addCharity',
    outputs: [],
    stateMutability: 'nonpayable',
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
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'charities',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
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
    inputs: [],
    name: 'givesNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
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
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'problem', internalType: 'string', type: 'string' },
      { name: 'link', internalType: 'string', type: 'string' },
      { name: 'ref', internalType: 'address', type: 'address' },
    ],
    name: 'raise',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'raisedHandsNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'charityAddress', internalType: 'address', type: 'address' },
    ],
    name: 'removeCharity',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'rewardsDistributed',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
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
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address' },
      { name: 'ref', internalType: 'address', type: 'address' },
      { name: 'newRef', internalType: 'address', type: 'address' },
      { name: 'comment', internalType: 'string', type: 'string' },
    ],
    name: 'shake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'shakesNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'solvedHandsNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
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
      { name: 'thankRate', internalType: 'uint256', type: 'uint256' },
      { name: 'charity', internalType: 'address', type: 'address' },
      { name: 'charityRate', internalType: 'uint256', type: 'uint256' },
      { name: 'maint', internalType: 'address', type: 'address' },
      { name: 'maintRate', internalType: 'uint256', type: 'uint256' },
      { name: 'comment', internalType: 'string', type: 'string' },
    ],
    name: 'thank',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'thanksNumber',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'thumbDown',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'thumbUp',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'trust',
    outputs: [{ name: '', internalType: 'int256', type: 'int256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'uri',
    outputs: [{ name: 'data', internalType: 'string', type: 'string' }],
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
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'Down',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
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
      { name: 'hand', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'solutionIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'story', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'SuccessStory',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'hand', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'solutionIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'comment',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'Thanked',
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
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'Up',
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
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
] as const

/**
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const aHandBaseAddress = {
  8453: '0x5253BDB502be3D85c3932292AcCAf16233058e7F',
  31337: '0xb609D06B30481d9c8f220e3051d3BA41f48DDb2A',
  84532: '0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1',
} as const

/**
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
// Ownable
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ownableAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
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
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"MAX_CHARITY_RATE"`
 */
export const useReadAHandMaxCharityRate = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'MAX_CHARITY_RATE',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"MAX_MAINT_RATE"`
 */
export const useReadAHandMaxMaintRate = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'MAX_MAINT_RATE',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"MAX_RATE"`
 */
export const useReadAHandMaxRate = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'MAX_RATE',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"MAX_SHAKES_CHAIN_LEN"`
 */
export const useReadAHandMaxShakesChainLen =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandAbi,
    functionName: 'MAX_SHAKES_CHAIN_LEN',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"MIN_CHARITY_RATE"`
 */
export const useReadAHandMinCharityRate = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'MIN_CHARITY_RATE',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"link"`
 */
export const useReadAHandLink = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'link',
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
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"shakesChain"`
 */
export const useReadAHandShakesChain = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'shakesChain',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandAbi}__ and `functionName` set to `"shakesChainLen"`
 */
export const useReadAHandShakesChainLen = /*#__PURE__*/ createUseReadContract({
  abi: aHandAbi,
  functionName: 'shakesChainLen',
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
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandAbi}__ and `eventName` set to `"Comment"`
 */
export const useWatchAHandCommentEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandAbi,
    eventName: 'Comment',
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
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBase = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"MINIMUM_REWARD"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseMinimumReward =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'MINIMUM_REWARD',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"balanceOf"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseBalanceOf = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'balanceOf',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"balanceOfBatch"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseBalanceOfBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'balanceOfBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"charities"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseCharities = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'charities',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"givesNumber"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseGivesNumber = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'givesNumber',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"hands"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseHands = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'hands',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"isApprovedForAll"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseIsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"name"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseName = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'name',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"owner"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseOwner = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"raisedHandsNumber"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseRaisedHandsNumber =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'raisedHandsNumber',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"rewardsDistributed"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseRewardsDistributed =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'rewardsDistributed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"shakesNumber"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseShakesNumber = /*#__PURE__*/ createUseReadContract(
  {
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'shakesNumber',
  },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"solvedHandsNumber"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseSolvedHandsNumber =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'solvedHandsNumber',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"supportsInterface"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseSupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thanksNumber"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseThanksNumber = /*#__PURE__*/ createUseReadContract(
  {
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'thanksNumber',
  },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"trust"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseTrust = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'trust',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"uri"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useReadAHandBaseUri = /*#__PURE__*/ createUseReadContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'uri',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBase = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"addCharity"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseAddCharity = /*#__PURE__*/ createUseWriteContract(
  { abi: aHandBaseAbi, address: aHandBaseAddress, functionName: 'addCharity' },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"give"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseGive = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'give',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"raise"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseRaise = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'raise',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"removeCharity"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseRemoveCharity =
  /*#__PURE__*/ createUseWriteContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'removeCharity',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"renounceOwnership"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseShake = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'shake',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thank"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseThank = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'thank',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thumbDown"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseThumbDown = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'thumbDown',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thumbUp"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseThumbUp = /*#__PURE__*/ createUseWriteContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
  functionName: 'thumbUp',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"transferOwnership"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWriteAHandBaseTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBase = /*#__PURE__*/ createUseSimulateContract({
  abi: aHandBaseAbi,
  address: aHandBaseAddress,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"addCharity"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseAddCharity =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'addCharity',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"give"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseGive = /*#__PURE__*/ createUseSimulateContract(
  { abi: aHandBaseAbi, address: aHandBaseAddress, functionName: 'give' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"raise"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseRaise =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'raise',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"removeCharity"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseRemoveCharity =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'removeCharity',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"renounceOwnership"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseThank =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'thank',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thumbDown"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseThumbDown =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'thumbDown',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"thumbUp"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseThumbUp =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'thumbUp',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link aHandBaseAbi}__ and `functionName` set to `"transferOwnership"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useSimulateAHandBaseTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseEvent = /*#__PURE__*/ createUseWatchContractEvent(
  { abi: aHandBaseAbi, address: aHandBaseAddress },
)

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"ApprovalForAll"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"Down"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseDownEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'Down',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"OwnershipTransferred"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"Raised"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseRaisedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'Raised',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"SuccessStory"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseSuccessStoryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'SuccessStory',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"Thanked"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseThankedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'Thanked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"TransferBatch"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
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
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseUriEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'URI',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link aHandBaseAbi}__ and `eventName` set to `"Up"`
 *
 * - [__View Contract on Base Basescan__](https://basescan.org/address/0x5253BDB502be3D85c3932292AcCAf16233058e7F)
 * -
 * - [__View Contract on Base Sepolia Basescan__](https://sepolia.basescan.org/address/0x3D229C66Ad4Bbd8826467EAA2093FA307d0b3aB1)
 */
export const useWatchAHandBaseUpEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: aHandBaseAbi,
    address: aHandBaseAddress,
    eventName: 'Up',
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

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ownableAbi}__
 */
export const useReadOwnable = /*#__PURE__*/ createUseReadContract({
  abi: ownableAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ownableAbi}__ and `functionName` set to `"owner"`
 */
export const useReadOwnableOwner = /*#__PURE__*/ createUseReadContract({
  abi: ownableAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ownableAbi}__
 */
export const useWriteOwnable = /*#__PURE__*/ createUseWriteContract({
  abi: ownableAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ownableAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteOwnableRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: ownableAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ownableAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteOwnableTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: ownableAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ownableAbi}__
 */
export const useSimulateOwnable = /*#__PURE__*/ createUseSimulateContract({
  abi: ownableAbi,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ownableAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateOwnableRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ownableAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ownableAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateOwnableTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ownableAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ownableAbi}__
 */
export const useWatchOwnableEvent = /*#__PURE__*/ createUseWatchContractEvent({
  abi: ownableAbi,
})

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link ownableAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchOwnableOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: ownableAbi,
    eventName: 'OwnershipTransferred',
  })
