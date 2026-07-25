import { Link } from "@tanstack/react-router";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { Emoji } from "./Emoji";
import { POCKET_EMOJI } from "../styles/tokens";
import { t } from "../i18n";
import { useEffect, useState } from "react";

/**
 * The header's account slot — the one contextual element that's useful on
 * every screen. Connected → a pocket chip (→ /pocket); otherwise → Connect,
 * which opens Privy's login modal directly.
 */
export function AccountButton() {
  const [mounted, setMounted] = useState(false);
  const { authenticated, login } = usePrivy();
  // The pocket page keys off wagmi's connection; the header must agree —
  // an injected wallet can be wagmi-connected without a live Privy session.
  const { isConnected } = useAccount();
  const connected = authenticated || isConnected;

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        className="flex items-center h-10 px-[18px] font-bold text-[14px] bg-transparent cursor-pointer"
        style={{ border: "var(--bw-emph) solid var(--ink)", borderRadius: "var(--r-control)", color: "var(--ink)" }}
      >
        {t("Connect")}
      </button>
    );
  }

  if (connected) {
    return (
      <Link
        to="/pocket"
        aria-label={t("your pocket")}
        className="flex items-center justify-center h-10 px-[14px]"
        style={{ border: "var(--bw-emph) solid var(--ink)", borderRadius: "var(--r-control)" }}
      >
        <Emoji size={15}>{POCKET_EMOJI}</Emoji>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => login()}
      className="flex items-center h-10 px-[18px] font-bold text-[14px] bg-transparent cursor-pointer"
      style={{ border: "var(--bw-emph) solid var(--ink)", borderRadius: "var(--r-control)", color: "var(--ink)" }}
    >
      {t("Connect")}
    </button>
  );
}

