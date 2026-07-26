import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Sheet } from "./Sheet";
import { QuietButton } from "./QuietButton";
import { useThread } from "../hooks/useThread";
import { thankPathFor, type GiveMessage } from "../lib/giveLink";
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
 * Fresh words arrive on their own (useThread polls); the column follows
 * them only while the reader is already at the bottom.
 */
export function ThreadSheet(props: {
  conversationId: string;
  title: string;
  /** Present when this thread carries a give (raiser side) — unlocks the
   *  thank shortcut into the acceptance screen, plus the tip stub. */
  give?: Pick<GiveMessage, "handId" | "fragment">;
  onClose: () => void;
}) {
  const thread = useThread(props.conversationId);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLTextAreaElement>(null);
  // Pinned to the newest word until the reader scrolls up to re-read.
  const stickRef = useRef(true);

  const messages = thread.messages;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
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
    stickRef.current = true; // your own words always come into view
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
    <Sheet label={props.title} tall onClose={props.onClose}>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="ah-scroll flex-1 min-h-[140px] mt-2 flex flex-col gap-1.5 overflow-y-auto pr-2 -mr-2"
      >
        {/* Chat gravity: the column sticks to the composer, not the header. */}
        <div className="flex-1 shrink-0" aria-hidden="true" />
        {messages === null ? (
          <p className="ah-label ah-label--dim">{t("checking for replies…")}</p>
        ) : messages.length === 0 ? (
          <p className="ah-label ah-label--dim">{t("nothing said yet — start it off")}</p>
        ) : (
          messages.map((m: ThreadMessage, i: number) => (
            <div
              key={m.id}
              className={m.mine ? "self-end" : "self-start"}
              style={{
                maxWidth: "84%",
                // A breath between runs, tight inside one voice's run.
                marginTop: i > 0 && messages[i - 1].mine !== m.mine ? 8 : 0,
              }}
            >
              <p
                style={{
                  background: m.mine ? "var(--amber)" : "var(--card)",
                  color: m.mine ? "var(--on-amber)" : "var(--ink)",
                  border: m.mine
                    ? "none"
                    : m.isGive
                      ? "var(--bw-emph) solid var(--amber)" // the give wears its accent
                      : "var(--bw-hair) solid var(--ink-a10)",
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

      {/* The talk can end in the thank — the shortcut lives where the
          conversation does. Tip is a promise for now, not a payment. */}
      {props.give && (
        <div className="mt-3 flex gap-2">
          <QuietButton compact disabled className="ah-quiet--soon flex-1">
            {t("tip")}
            <span className="ah-meta" style={{ fontSize: "var(--fs-mono-xs)", letterSpacing: "var(--track-mono-sm)" }}>
              {t("soon")}
            </span>
          </QuietButton>
          {/* Plain anchor on purpose: the proof rides the #fragment, which
              must be in the URL before the thank page reads it. */}
          <a href={thankPathFor(props.give)} className="ah-quiet ah-quiet--compact flex-1 no-underline">
            {t("thank")}
          </a>
        </div>
      )}

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
