import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getFrameHtmlResponse } from '@coinbase/onchainkit/frame'

export default async function handler(request: VercelRequest, response: VercelResponse) {
  console.log('Full request body:', JSON.stringify(request.body, null, 2))

  const { untrustedData } = request.body

  const { url, buttonIndex, inputText } = untrustedData

  const txHash = new URL(url).searchParams.get('txHash')

  if (!txHash) {
    return response.status(400).send('Missing transaction hash')
  }

  const urlParts = url.split('/')
  const hand = urlParts[urlParts.length - 3]
  const ref = urlParts[urlParts.length - 2]
  const newRef = urlParts[urlParts.length - 1].split('?')[0]

  console.log('Extracted data:', { hand, ref, newRef, txHash, buttonIndex, inputText })

  const protocol = request.headers['x-forwarded-proto'] ? request.headers['x-forwarded-proto'].split(',')[0] : 'http'
  const host = request.headers['host']

  return response.status(200).send(
    getFrameHtmlResponse({
      buttons: [
        {
          label: '🔍 View Transaction',
          action: 'link',
          target: `https://explorer.base.org/tx/${txHash}`
        },
        {
          label: '🔙 Back to App',
          action: 'post',
          target: `${protocol}://${host}/api/frame/hand/${hand}/${newRef}`
        }
      ],
      image: {
        src: `${protocol}://${host}/api/og/tx_success?hand=${hand}&ref=${ref}&newRef=${newRef}`,
        aspectRatio: '1:1'
      },
      postUrl: `${protocol}://${host}/api/frame/hand/${hand}/${newRef}`,
      state: {
        hand,
        ref: newRef,
        txHash
      }
    })
  )
}
