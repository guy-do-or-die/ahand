import { Helmet } from 'react-helmet'

import { useLocation } from 'wouter'

import { MetaHeadEmbed } from '@phntms/react-share'

import { createCanvas, loadImage } from 'canvas'

import satori from 'satori'


const MyImageComponent = ({ title }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', width: '100vw', backgroundColor: '#f0f0f0' }}>
    <h1>{title}</h1>
  </div>
)


export const generateImage = async (title) => {
  const canvas = createCanvas(1200, 630)
  const ctx = canvas.getContext('2d')

  const svg = await satori(<MyImageComponent title={title} />, {
    width: 1200,
    height: 630,
  })

  const image = await loadImage(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
  ctx.drawImage(image, 0, 0)

  return canvas.toBuffer('image/png')
}


export const ShareMeta = ({title, children}) => {
  return <>
    <MetaHeadEmbed
      render={meta => <Helmet>{meta}</Helmet>}
      siteTitle='aHand'
      pageTitle={title}
      titleTemplate='[pageTitle] | [siteTitle]'
      description='A hand is near. Shake or give it and get rewarded!'
      baseSiteUrl={`${window.origin}`}
      pagePath='hand'
      keywords={['creative-agency', 'phantom', 'work']}
      imageUrl='https://bit.ly/3wiUOuk'
      imageAlt='aHand logo'
      twitter={{
        cardSize: 'large',
        siteUsername: '@phntmLDN',
        creatorUsername: '@phntmLDN',
      }} />
    {children}
  </>
}
