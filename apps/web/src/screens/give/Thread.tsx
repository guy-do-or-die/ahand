import type { HandRef, Hex } from "@ahand/deliver";
import { useState } from "react";

import { t } from "../../i18n";
import { TID } from "../../testids";
import { QuietButton } from "../../ui";
import { relayCount, sendToInbox, useReplies, useThreadSent } from "./deliver";
import { awaitsDelivery, MAX_WORDS, wordsOf } from "./flow";

/**
 * The giver's thread with the asker: the giver's own words and notes, read from
 * the outbox (each keeps the Give's chat key), and the asker's replies over that chat key, read
 * again from the relays. Shown on /give once the answer is written, and on /my for every answer
 * this device sent, so it survives a reload and a closed tab.
 */
export function AnswerThread(props: {
  /** The Give's chat key (the outbox entry's), or undefined when nothing was written down. */
  chatKey: Hex | undefined;
  /** The Hand's inbox key, the only sender whose messages are the asker's. */
  inbox: Hex | undefined;
  hand: HandRef;
  /** The give's own time (seconds): replies are read from then on. */
  since: number | undefined;
  /** The list's test id: `give-thread` on /give, `my-answer-thread` on /my. */
  testId: string;
  /** The heading's element id, unique on the page. */
  titleId: string;
}) {
  const { chatKey, inbox, hand, since } = props;
  const sent = useThreadSent(chatKey);
  const replies = useReplies(chatKey, inbox, hand, since);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  if (!inbox || relayCount() === 0) {
    return <p className="ah-label ah-label--dim m-0">{t("give.thread.noInbox")}</p>;
  }

  const lines = [
    ...sent.filter((entry) => entry.envelope.text).map((entry) => ({ id: entry.key, at: entry.at, mine: true, text: entry.envelope.text!, first: entry.envelope.kind === "give", queued: awaitsDelivery(inbox, relayCount(), entry) })),
    ...replies.map((reply) => ({ id: reply.id, at: reply.at, mine: false, text: reply.text, first: false, queued: false })),
  ].sort((a, b) => a.at - b.at);

  async function answer() {
    const words = wordsOf(draft);
    if (!words || !chatKey || !inbox) return;
    setSending(true);
    try {
      // Answers go to the Hand's inbox, the key the asker writes from.
      await sendToInbox(inbox, { v: 1, kind: "note", hand, text: words }, chatKey);
      setDraft("");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby={props.titleId}>
      <h2 id={props.titleId} className="ah-meta ah-meta--ink m-0">
        {t("give.thread.title")}
      </h2>
      <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid={props.testId} data-count={String(lines.length)} data-replies={String(replies.length)}>
        {lines.map((line) => (
          <li key={line.id} className={line.mine ? "ah-panel self-end" : "ah-card self-start px-4 py-3"} data-from={line.mine ? "you" : "asker"} style={{ maxWidth: "88%" }}>
            <span className="ah-meta block pb-1">
              {line.mine ? (line.first ? t("give.thread.yourWords") : t("give.thread.you")) : t("give.thread.asker")}
              {line.queued ? ` · ${t("give.thread.queued")}` : ""}
            </span>
            <span className="whitespace-pre-wrap break-words">{line.text}</span>
          </li>
        ))}
      </ol>
      {replies.length === 0 ? <p className="ah-label ah-label--dim m-0">{t("give.thread.empty")}</p> : null}
      {chatKey ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void answer();
          }}
        >
          <input
            className="ah-chatline min-h-[44px] flex-1"
            data-testid={TID.give.replyInput}
            aria-label={t("give.thread.reply")}
            placeholder={t("give.thread.reply")}
            value={draft}
            maxLength={MAX_WORDS}
            onChange={(event) => setDraft(event.target.value)}
          />
          <QuietButton type="submit" compact data-testid={TID.give.replySend} disabled={sending || wordsOf(draft) === ""}>
            {t("give.thread.send")}
          </QuietButton>
        </form>
      ) : null}
    </section>
  );
}
