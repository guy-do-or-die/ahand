import type { VercelRequest, VercelResponse } from '@vercel/node'

import { encodeFunctionData, parseAbiItem } from 'viem'

import {aHandBaseAbi, aHandBaseAddress} from '../../app/contracts.ts'
import {genRef} from '../../app/utils.ts'


export default async function handler(request: VercelRequest, response: VercelResponse) {

  const {fid, address, url, buttonIndex, inputText} = request.body.untrustedData

  const urlParts = url.split('/')
  const hand = urlParts[urlParts.length - 2]
  const ref = urlParts[urlParts.length - 1]

  const newRef = genRef()

  const comment = inputText || ''

  const data = { 
    1: encodeFunctionData({
      abi: aHandBaseAbi,
      functionName: 'shake',
      args: [hand, ref, newRef, comment]
    }),
    2: encodeFunctionData({
      abi: aHandBaseAbi,
      functionName: 'give',
      args: [hand, ref, newRef, comment]
    })
  }[buttonIndex]

  const value = '0'

  return response.send({
    chainId: 'eip155:84532',
    method: 'eth_sendTransaction',
    params: {
      abi: aHandBaseAbi,
      to: aHandBaseAddress[84532],
      data,
      value
    }
  })
}
