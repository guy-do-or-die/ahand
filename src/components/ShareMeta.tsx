import { Helmet } from "react-helmet";

import { MetaHeadEmbed } from "@phntms/react-share";

import { useLocation } from "wouter";


export const ShareMeta = ({title, children}) => {
  return <>
    <MetaHeadEmbed
      render={meta => <Helmet>{meta}</Helmet>}
      siteTitle="aHand"
      pageTitle={title}
      titleTemplate="[pageTitle] | [siteTitle]"
      description="A hand is near. Shake or give it and get rewarded!"
      baseSiteUrl={`${window.origin}`}
      pagePath="hand"
      keywords={["creative-agency", "phantom", "work"]}
      imageUrl="https://bit.ly/3wiUOuk"
      imageAlt="aHand logo"
      twitter={{
        cardSize: "large",
        siteUsername: "@phntmLDN",
        creatorUsername: "@phntmLDN",
      }} />
    {children}
  </>
}
