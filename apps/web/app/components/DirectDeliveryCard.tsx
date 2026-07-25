import { Emoji } from "./Emoji";
import { QuietButton } from "./QuietButton";
import { FLAGS } from "../config/flags";
import { useXmtp } from "../hooks/useXmtp";
import { t } from "../i18n";

/**
 * Opt-in for direct give delivery: once switched on, a helper's reply can
 * land straight in the raiser's pocket instead of riding a pasted link.
 * Renders nothing until it has something true to say (SSR, flag off,
 * disconnected).
 */
export function DirectDeliveryCard({ className = "" }: { className?: string }) {
  const xmtp = useXmtp();

  if (!FLAGS.xmtpDelivery) return null;
  if (xmtp.status === "idle" || xmtp.status === "disconnected") return null;

  // "On" means this device can actually read replies — a client is live.
  // Reachable-but-not-here (registered from another device, or a wiped
  // local db) still shows the switch, phrased for the second device.
  const on = xmtp.status === "ready";
  const elsewhere = !on && xmtp.reachable === true;

  return (
    <div
      className={`px-4 py-3.5 ${className}`}
      style={{
        border: "var(--bw-emph) solid var(--ink)",
        borderRadius: "var(--r-chip-lg)",
        background: "var(--card)",
      }}
    >
      {on ? (
        <div className="flex items-center gap-3">
          <Emoji size={22}>📬</Emoji>
          <div>
            <p className="font-bold" style={{ fontSize: 14.5 }}>
              {t("Direct replies are on.")}
            </p>
            <p className="ah-label ah-label--dim mt-[3px]" style={{ fontSize: 12 }}>
              {t("when someone helps, their answer lands in your pocket")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Emoji size={22}>📬</Emoji>
            <div>
              <p className="font-bold" style={{ fontSize: 14.5 }}>
                {elsewhere ? t("Read replies on this screen too.") : t("Let replies land right here.")}
              </p>
              <p className="ah-label ah-label--dim mt-[3px]" style={{ fontSize: 12 }}>
                {xmtp.status === "busy"
                  ? t("your messages are open in another tab — close it there first")
                  : xmtp.status === "error"
                    ? t("the message post isn't answering — the link still works")
                    : elsewhere
                      ? t("replies land only where it's on — one OK adds this screen")
                      : t("one OK from your pocket, once")}
              </p>
            </div>
          </div>
          <QuietButton
            compact
            disabled={xmtp.status === "connecting"}
            onClick={() => void xmtp.enable()}
          >
            {xmtp.status === "connecting" ? t("switching on…") : t("Switch it on")}
          </QuietButton>
        </div>
      )}
    </div>
  );
}
