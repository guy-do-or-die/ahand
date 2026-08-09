import { createRootRoute, Outlet, HeadContent, Scripts, useRouterState } from "@tanstack/react-router";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@lingui/react";
import { i18n } from "../i18n";
import { config as wagmiConfig, activeChain, PRIVY_APP_ID } from "../config/web3";
import { AA } from "../config/aa";
import { AMBER_HEX } from "../styles/tokens";
import { AppHeader } from "../components/AppHeader";
import { GlobalFooter } from "../components/GlobalFooter";
import { ActiveWalletSync } from "../components/ActiveWalletSync";
import appCss from "../index.css?url";

const queryClient = new QueryClient();

export const Route = createRootRoute({
  meta: () => [{ title: "aHand — Ask your people" }],
  component: RootComponent,
});

function RootComponent() {
  const matches = useRouterState({ select: (s) => s.matches });
  // SSR fallback origin: what scrapers see in og:image URLs — must be the
  // PUBLIC host (ngrok in dev, real domain in prod), never localhost.
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : ((import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined) ??
        "https://welcome-primate-specially.ngrok-free.app");
  const isHome = useRouterState({
    select: (s) => s.location.pathname === "/",
  });

  const dynamicMeta = matches.map((match) => {
    if (match.id.startsWith('/h/') && match.loaderData) {
      const data: any = match.loaderData;
      const q = [data.e && `e=${data.e}`, data.th === "d" && "th=d"].filter(Boolean).join("&");
      const image = `${origin}/api/og/${data.id}.png${q ? `?${q}` : ""}`;
      return [
        { title: data.title },
        { property: "og:title", content: data.title },
        { property: "og:description", content: data.desc },
        { property: "og:image", content: image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: image }
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
        {/* Domain-ownership verification for the talent app listing. */}
        <meta name="talentapp:project_verification" content="null" />
        <title>{finalTitle}</title>
        {otherMeta.map((m: any, i: number) => {
          if (m.charSet) return <meta key={`meta-${i}`} charSet={m.charSet} />;
          return <meta key={`meta-${i}`} {...m} />;
        })}
        <HeadContent />
        {/* Apply the saved theme override before first paint — the toggle
            persists to localStorage; without a saved value the device
            preference (prefers-color-scheme) stays in charge. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("ahand-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}',
          }}
        />
        <link rel="stylesheet" href={appCss} />
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🙌</text></svg>" />
      </head>
      <body className="antialiased">
        <I18nProvider i18n={i18n}>
        <PrivyProvider
          appId={PRIVY_APP_ID}
          config={{
            // Social logins mint an embedded pocket; external wallets keep
            // the classic path. VITE_AA_ENABLED=false restores wallet-only.
            loginMethods: AA.enabled
              ? ["email", "google", "passkey", "farcaster", "twitter", "wallet"]
              : ["wallet"],
            defaultChain: activeChain,
            supportedChains: [activeChain],
            embeddedWallets: {
              ethereum: { createOnLogin: "users-without-wallets" },
              // App UI owns confirmations — signing (7702 authorization,
              // XMTP registration) stays silent, like the PoC's wallet flow.
              showWalletUIs: false,
            },
            appearance: {
              theme: "light",
              accentColor: AMBER_HEX,
            },
          }}
        >
          {/* @privy-io/wagmi requires QueryClient ABOVE WagmiProvider. */}
          <QueryClientProvider client={queryClient}>
            <WagmiProvider config={wagmiConfig}>
              <ActiveWalletSync />
              {/* One shell for every screen: global header + footer, page
                  content fills the middle. */}
              <div className="flex flex-col min-h-dvh">
                <AppHeader />
                <div className="flex-1 flex flex-col">
                  <Outlet />
                </div>
                <GlobalFooter />
              </div>
            </WagmiProvider>
          </QueryClientProvider>
        </PrivyProvider>
        </I18nProvider>
        <Scripts />
      </body>
    </html>
  );
}
