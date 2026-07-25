import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config as wagmiConfig, activeChain } from "../config/web3";
import appCss from "../index.css?url";

const queryClient = new QueryClient();

export const Route = createRootRoute({
  meta: () => [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: "a🙌and — Ask your people" },
  ],
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <link rel="stylesheet" href={appCss} />
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🙌</text></svg>" />
      </head>
      <body className="bg-paper text-ink selection:bg-gold selection:text-paper antialiased">
        <PrivyProvider
          appId="clt69jwp204btq1o3q72cupji"
          config={{
            loginMethods: ["wallet"],
            defaultChain: activeChain,
            supportedChains: [activeChain],
            appearance: {
              theme: "light",
              accentColor: "#D4AF37",
            },
          }}
        >
          <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
              <div className="min-h-screen bg-paper text-ink selection:bg-gold selection:text-paper font-sans flex items-center justify-center p-4">
                <div className="w-full max-w-md bg-paper border-2 border-ink rounded-2xl shadow-xl overflow-hidden flex flex-col min-h-[550px]">
                  
                  {/* Header */}
                  <header className="border-b-2 border-ink px-6 py-4 flex justify-between items-center bg-paper">
                    <span className="text-xl font-black tracking-tighter flex items-center space-x-1 select-none">
                      <span>a🙌and</span>
                    </span>
                    <div className="text-[10px] font-bold uppercase tracking-widest bg-gold/20 text-ink/80 px-2 py-0.5 rounded border border-ink/20 font-mono">
                      v0.1
                    </div>
                  </header>

                  {/* Main Content Area */}
                  <main className="flex-grow flex flex-col justify-between">
                    <Outlet />
                  </main>

                  {/* Footer */}
                  <footer className="border-t border-ink/10 px-6 py-3 text-center text-[10px] text-ink/40 font-mono">
                    a🙌and Protocol • positive-sum routing
                  </footer>
                </div>
              </div>
            </QueryClientProvider>
          </WagmiProvider>
        </PrivyProvider>
        <Scripts />
      </body>
    </html>
  );
}
