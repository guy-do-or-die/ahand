import type { VercelRequest, VercelResponse } from '@vercel/node'

import { getFrameHtmlResponse } from '@coinbase/onchainkit/frame'


export default async function handler(request: VercelRequest, response: VercelResponse) {

  return response.send(
    getFrameHtmlResponse({
      buttons: [
        {
          label: `Test`,
        },
      ],
      image: 'https://assets.devfolio.co/hackathons/28ac103c2a0e4d29b02625d2b29b4d60/projects/c7ec5e2cbc9645ff942d2d138985e2c3/d3d983e2-fec5-4f41-8f1f-952a8ae882e2.jpeg',
      postUrl: 'https://build-onchain-apps.vercel.app/api/frame',
    })
  )
}
