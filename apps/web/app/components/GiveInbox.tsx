import { Emoji } from "./Emoji";
import { FLAGS } from "../config/flags";
import { useGiveInbox } from "../hooks/useGiveInbox";
import { thankPathFor } from "../lib/giveLink";
import type { InboxGive, InboxReply } from "../lib/xmtpClient";
import { truncateMiddle } from "../lib/format";
import { t } from "../i18n";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function preview(text: string, max = 64): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * What the pocket heard over XMTP: incoming gives (each row deep-links
 * into the existing thank flow on the current origin — plain anchor so the
 * proof fragment is there before the page reads it) and the word that came
 * back on threads this pocket started. Renders nothing when there's
 * nothing to show.
 */
export function GiveInbox({ className = "" }: { className?: string }) {
  const { status, inbox, loading, refresh } = useGiveInbox();

  if (!FLAGS.xmtpDelivery || status !== "ready") return null;
  if (inbox === null) {
    return <p className={`ah-label ah-label--dim ${className}`}>{t("checking for replies…")}</p>;
  }
  if (inbox.gives.length === 0 && inbox.replies.length === 0) return null;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <p className="ah-label ah-label--dim">
          {inbox.gives.length > 0 ? t("hands reaching back") : t("word back")}
        </p>
        <button
          type="button"
          className="text-[12px] font-bold text-ink/40 hover:text-ink cursor-pointer bg-transparent border-0 p-0"
          onClick={() => void refresh()}
        >
          {loading ? t("checking…") : t("check again")}
        </button>
      </div>
      <div className="mt-2" style={{ borderTop: "var(--bw-emph) solid var(--ink)" }}>
        {inbox.gives.map((item: InboxGive) => (
          <a
            key={item.messageId}
            href={thankPathFor(item)}
            className="flex items-center justify-between py-[13px] no-underline text-inherit"
            style={{ borderBottom: "var(--bw-hair) solid var(--ink-a10)" }}
          >
            <div className="min-w-0">
              <p className="font-bold" style={{ fontSize: 14.5 }}>
                <Emoji>🙌</Emoji> {t("A reply to your hand #{id}", { id: item.handId })}
              </p>
              <p className="ah-label ah-label--dim mt-[3px] truncate" style={{ fontSize: 12 }}>
                <span className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)" }}>
                  {dateFmt.format(item.sentAt)}
                </span>
                {item.note ? ` · ${preview(item.note)}` : ` · ${t("no note — just the give")}`}
              </p>
            </div>
            <span className="ah-linkrow__action shrink-0 pl-3">{t("open")}</span>
          </a>
        ))}
        {inbox.replies.map((item: InboxReply) => (
          <div
            key={item.messageId}
            className="flex items-center justify-between py-[13px]"
            style={{ borderBottom: "var(--bw-hair) solid var(--ink-a10)" }}
          >
            <div className="min-w-0">
              <p className="font-bold" style={{ fontSize: 14.5 }}>
                <Emoji>💬</Emoji> {preview(item.text)}
              </p>
              <p className="ah-label ah-label--dim mt-[3px]" style={{ fontSize: 12 }}>
                <span className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)" }}>
                  {dateFmt.format(item.sentAt)}
                </span>
                {" · "}
                {item.peerAddress
                  ? t("word back from {who}", { who: truncateMiddle(item.peerAddress, 6, 4) })
                  : t("word back")}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
