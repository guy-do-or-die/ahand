import { useEffect, useRef, useState } from "react";
import { ArrowUp, RotateCw } from "lucide-react";
import { Sheet } from "./Sheet";
import { useThread } from "../hooks/useThread";
import type { ThreadMessage } from "../lib/xmtpClient";
import { t } from "../i18n";

const stampFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * The place raiser and giver talk it over — one conversation, plain words.
 * The context rides the sheet's top bar, the column anchors to the bottom
 * like any chat, Enter sends (Shift+Enter for a new line). Stamps mark the
 * end of a run (sender change or a 15-minute pause), not every bubble.
 */
export function ThreadSheet(props: { conversationId: string; title: string; onClose: () => void }) {
  const thread = useThread(props.conversationId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLTextAreaElement>(null);

  const messages = thread.messages;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** Grow with the words (46 → 120px), scroll only past that. */
  const autoGrow = () => {
    const el = lineRef.current;
    if (!el) return;
    el.style.height = "46px";
    const next = Math.min(el.scrollHeight, 120);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > 120 ? "auto" : "hidden";
  };

  const send = async () => {
    if (await thread.send(draft)) {
      setDraft("");
      requestAnimationFrame(autoGrow);
    }
  };

  const stampAfter = (i: number): boolean => {
    if (!messages) return false;
    if (i === messages.length - 1) return true;
    const cur = messages[i];
    const next = messages[i + 1];
    return cur.isGive || next.mine !== cur.mine || next.sentAt.getTime() - cur.sentAt.getTime() > 15 * 60_000;
  };

  const canSend = !thread.sending && Boolean(draft.trim());

  return (
    <Sheet
      label={props.title}
      tall
      onClose={props.onClose}
      actions={
        <button
          type="button"
          aria-label={t("check again")}
          title={t("check again")}
          onClick={() => void thread.refresh()}
          className="flex items-center justify-center w-11 h-11 bg-transparent border-0 cursor-pointer text-ink/50 hover:text-ink"
        >
          <RotateCw size={17} strokeWidth={2.2} className={thread.refreshing ? "animate-spin" : undefined} />
        </button>
      }
    >
      <div ref={scrollRef} className="ah-scroll flex-1 min-h-[140px] mt-2 flex flex-col gap-1.5 overflow-y-auto pr-2 -mr-2">
        {/* Chat gravity: the column sticks to the composer, not the header. */}
        <div className="flex-1 shrink-0" aria-hidden="true" />
        {messages === null ? (
          <p className="ah-label ah-label--dim">{t("checking for replies…")}</p>
        ) : messages.length === 0 ? (
          <p className="ah-label ah-label--dim">{t("nothing said yet — start it off")}</p>
        ) : (
          messages.map((m: ThreadMessage, i: number) => (
            <div key={m.id} className={m.mine ? "self-end" : "self-start"} style={{ maxWidth: "84%" }}>
              <p
                style={{
                  background: m.mine ? "var(--amber)" : "var(--card)",
                  color: m.mine ? "var(--on-amber)" : "var(--ink)",
                  border: m.mine ? "none" : "var(--bw-hair) solid var(--ink-a10)",
                  borderRadius: m.mine ? "16px 16px 5px 16px" : "16px 16px 16px 5px",
                  padding: "9px 14px",
                  fontSize: 14.5,
                  fontWeight: 500,
                  lineHeight: 1.45,
                  overflowWrap: "anywhere",
                }}
              >
                {m.text}
              </p>
              {stampAfter(i) && (
                <p
                  className="ah-meta mt-1 mb-1"
                  style={{
                    fontSize: "var(--fs-mono-xs)",
                    letterSpacing: "var(--track-mono-sm)",
                    color: "var(--ink-a45)",
                    textAlign: m.mine ? "right" : "left",
                  }}
                >
                  {stampFmt.format(m.sentAt)}
                  {m.isGive ? ` · ${t("the give")}` : ""}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          ref={lineRef}
          className="ah-chatline ah-scroll flex-1"
          rows={1}
          style={{ height: 46 }}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) void send();
            }
          }}
          placeholder={t("Say it plainly — it lands right in their pocket.")}
          aria-label={t("talk it over")}
        />
        <button
          type="button"
          aria-label={t("Send")}
          title={t("Send")}
          disabled={!canSend}
          onClick={() => void send()}
          className="shrink-0 grid place-items-center border-0 cursor-pointer disabled:cursor-default"
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: canSend ? "var(--amber)" : "var(--ink-a08)",
            color: canSend ? "var(--on-amber)" : "var(--ink-a40)",
            transition: "background 140ms ease, color 140ms ease",
          }}
        >
          <ArrowUp size={20} strokeWidth={2.4} />
        </button>
      </div>
    </Sheet>
  );
}
