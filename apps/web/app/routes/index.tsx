import { createFileRoute, Link } from "@tanstack/react-router";
import { usePrivy } from "@privy-io/react-auth";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  const { login, authenticated, logout, user } = usePrivy();

  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 space-y-8">
      <div className="space-y-4">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Ask your people.
          <br />
          Reward the chain that helps.
        </h1>
        <p className="text-ink/60 text-sm max-w-xs mx-auto leading-relaxed">
          Word of mouth, made fair. Every hand in the chain shares the thanks.
        </p>
      </div>

      <div className="flex flex-col space-y-3 w-full">
        {authenticated ? (
          <>
            <Link
              to="/raise"
              className="w-full bg-ink text-paper py-3 px-6 rounded-lg font-bold hover:bg-ink/90 transition text-center cursor-pointer"
            >
              ✋ Raise a hand
            </Link>
            <button
              onClick={() => logout()}
              className="w-full border border-ink/20 text-ink py-2 px-6 rounded-lg font-medium hover:bg-ink/5 transition text-sm text-center"
            >
              Disconnect {user?.wallet?.address ? `${user.wallet.address.slice(0, 6)}...` : ""}
            </button>
          </>
        ) : (
          <button
            onClick={() => login()}
            className="w-full bg-ink text-paper py-3 px-6 rounded-lg font-bold hover:bg-ink/90 transition text-center"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </div>
  );
}
