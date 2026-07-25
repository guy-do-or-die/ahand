import { createRootRoute, Outlet, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@lingui/react";
import { i18n } from "../i18n";
import { config as wagmiConfig, activeChain } from "../config/web3";
import { AMBER_HEX } from "../styles/tokens";
import { AppHeader } from "../components/AppHeader";
import { GlobalFooter } from "../components/GlobalFooter";
import appCss from "../index.css?url";

const queryClient = new QueryClient();

export const Route = createRootRoute({
  meta: () => [{ title: "aHand — Ask your people" }],
  component: RootComponent,
});

function RootComponent() {
  const matches = useRouterState({ select: (s) => s.matches });
  const origin = typeof window !== "undefined" ? window.location.origin : "https://welcome-primate-specifically.ngrok-free.app";
  const isHome = useRouterState({
    select: (s) => s.location.pathname === "/",
  });

  const dynamicMeta = matches.map((match) => {
    if (match.id.startsWith('/h/') && match.loaderData) {
      const data: any = match.loaderData;
      return [
        { title: data.title },
        { property: "og:title", content: data.title },
        { property: "og:description", content: data.desc },
        { property: "og:image", content: data.e ? `${origin}/api/og/${data.id}.png?e=${data.e}` : `${origin}/api/og/${data.id}.png` }
      ];
    }
    return match.meta || [];
  }).flat();

  // Deduplicate title tags: pick the LAST title defined in the match tree (leaf overrides parent)
  const titleMeta = dynamicMeta.filter((m: any) => m.title);
  const finalTitle = titleMeta.length > 0 ? titleMeta[titleMeta.length - 1].title : "aHand — Ask your people";
  const otherMeta = dynamicMeta.filter((m: any) => !m.title);

  return (
    <html lang="en">
      <head>
        {/* Static, universal — never route these through the meta() system:
            a missing viewport tag makes phones render at 980px and shrink. */}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{finalTitle}</title>
        {otherMeta.map((m: any, i: number) => {
          if (m.charSet) return <meta key={`meta-${i}`} charSet={m.charSet} />;
          return <meta key={`meta-${i}`} {...m} />;
        })}
        <HeadContent />
        <link rel="stylesheet" href={appCss} />
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🙌</text></svg>" />
      </head>
      <body className="antialiased">
        <I18nProvider i18n={i18n}>
        <PrivyProvider
          appId="clt69jwp204btq1o3q72cupji"
          config={{
            loginMethods: ["wallet"],
            defaultChain: activeChain,
            supportedChains: [activeChain],
            appearance: {
              theme: "light",
              accentColor: AMBER_HEX,
            },
          }}
        >
          <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
              {/* One shell for every screen: global header + footer, page
                  content fills the middle. */}
              <div className="flex flex-col min-h-dvh">
                <AppHeader />
                <div className="flex-1 flex flex-col">
                  <Outlet />
                </div>
                <GlobalFooter />
              </div>
            </QueryClientProvider>
          </WagmiProvider>
        </PrivyProvider>
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}
