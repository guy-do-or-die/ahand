import type { OutboxEntry } from "@ahand/deliver";

import { config } from "../../config";
import { t } from "../../i18n";
import { TID } from "../../testids";
import { CopyRow, Proof, QuietButton, minute, useLang } from "../../ui";
import { Line, Section } from "../my/parts";
import { relayCount, retryNow, useMyAnswers } from "./deliver";
import { deliveryState } from "./flow";
import { AnswerThread } from "./Thread";

/**
 * "Your answers" on /my (FINDINGS R-4): every answer this device sent, read from the giver's
 * outbox, which keeps each one's give link, words and chat key (ARCHITECTURE §8). After a reload
 * or in a new tab the giver finds the answer again, copies its link, and reads the asker's replies
 * and writes back in the same thread. Nothing here is on the chain; the list lives on this device.
 */
export function MyAnswers() {
  const { entries } = useMyAnswers();
  if (entries.length === 0) return null;
  return (
    <Section title={t("my.mine.title")} testId={TID.my.answersMine}>
      <Line dim>{t("my.mine.why")}</Line>
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {entries.map((entry) => (
          <MyAnswer key={entry.key} entry={entry} />
        ))}
      </ul>
    </Section>
  );
}

/** Where a Hand opens on this site: the short path for the canonical Core. */
export function handPath(chainId: number, core: string, handId: string): string {
  const canonical = config.cores.canonical;
  return canonical && canonical.toLowerCase() === core.toLowerCase() ? `/${chainId}/${handId}` : `/${chainId}/${core}/${handId}`;
}

function MyAnswer({ entry }: { entry: OutboxEntry }) {
  const lang = useLang();
  const { envelope } = entry;
  const hand = envelope.hand;
  const delivery = deliveryState(entry.to, relayCount(), entry);
  return (
    <li className="ah-card flex flex-col gap-4 p-4 md:p-5" data-testid={TID.my.answerMine} data-value={envelope.giveLink} data-delivery={delivery} data-acks={`${entry.acks}/${entry.of}`}>
      <div className="flex flex-col gap-1">
        <Proof>
          <span className="ah-meta ah-exact">{t("my.mine.hand", { id: hand.handId })}</span>
        </Proof>
        {envelope.text ? (
          <p className="m-0 whitespace-pre-wrap break-words text-[length:var(--fs-body-lg)] font-semibold leading-snug">“{envelope.text}”</p>
        ) : (
          <Line dim>{t("my.mine.noWords")}</Line>
        )}
        <span className="ah-meta ah-meta--dim">{t("my.mine.sent", { time: minute(entry.at, lang) })}</span>
      </div>

      {delivery === "delivered" ? (
        <Line>
          <Proof calm={t("my.mine.delivered.calm")}>{t("my.mine.delivered", { acks: entry.acks, of: entry.of })}</Proof>
        </Line>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Line>{t("my.mine.waiting")}</Line>
          <QuietButton compact variant="text" onClick={() => void retryNow()}>
            {t("give.retry")}
          </QuietButton>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="ah-field__label">{t("give.answer.label")}</span>
        <CopyRow value={envelope.giveLink!} />
        <a href={handPath(hand.chainId, hand.core, hand.handId)} className="ah-quiet ah-quiet--compact self-start">
          {t("my.openHand")}
        </a>
      </div>

      <AnswerThread chatKey={entry.chatKey} inbox={entry.to} hand={hand} since={entry.at} testId={TID.my.answerThread} titleId={`my-thread-${entry.key}`} />
    </li>
  );
}
