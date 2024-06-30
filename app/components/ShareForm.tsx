import { useEffect, useRef } from "react"

import { ShareSocial } from "react-share-social"

import { useConfig } from "../Store"

import farcasterUrl from '../../assets/farcaster.png'
import xUrl from '../../assets/x.png'


export const ShareForm = ({url}) => {

  const { config } = useConfig()

  const shareSocialRef = useRef(null)

  const textColor = config.theme === 'dark' ? 'light' : 'black'
  const backgroundColor = config.theme === 'dark' ? 'black' : 'white'

  const style = {
    root: {
      color: textColor,
      background: backgroundColor,
      maxWidth: "100%",
      width: "100%",
    },
    iconContainer: {
      textAlign: "center"   
    },
    copyContainer: {
      fontFamily: "AnonymousPro",
      background: backgroundColor,
      border: 0,
    },
    copyUrl: {
      maxWidth: "calc(100% - 70px)",
      fontFamily: "AnonymousPro",
      color: textColor,
      overflowX: "hidden",
    },
    copyIcon: {
      color: textColor,
    }
  }

  useEffect(() => {
    if (shareSocialRef.current) {
      const farcBtn = shareSocialRef.current.querySelector('[aria-label="whatsapp"]')
      const xBtn = shareSocialRef.current.querySelector('[aria-label="twitter"]')

      if (xBtn) {
        const svg = xBtn.querySelector('svg')

        if (svg) {
          const img = document.createElement('img')

          img.src = xUrl
          img.alt = 'X'

          img.style.maxWidth = '40px' 
          img.style.maxHeight = '40px' 

          svg.parentNode.replaceChild(img, svg);
        }
      }

      if (farcBtn) {
        const svg = farcBtn.querySelector('svg')

        if (svg) {
          const img = document.createElement('img')

          img.src = farcasterUrl
          img.alt = 'Farcaster'

          img.style.maxWidth = '40px' 
          img.style.maxHeight = '40px' 

          svg.parentNode.replaceChild(img, svg);
        }

        farcBtn.title = 'Farcaster'
        farcBtn.onclick = () => {
          window.open(`https://warpcast.com/~/compose?text=${url}`, '_blank')
        }
      }
    }
  }, [])
  
  return <div className="w-full" ref={shareSocialRef}>
    <ShareSocial url={url} style={style} socialTypes={["whatsapp", "telegram", "twitter", "reddit", "linkedin", "facebook"]} />
  </div>
}
