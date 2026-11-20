import { findBlockAt, findLaterHands, handLogsAt, receiptOf, type ReceiptRow } from "@ahand/sdk";
import { useEffect, useRef, useState } from "react";
import { isAddressEqual, type Address } from "viem";

import { clientOf, useNow } from "../../chain";
import { config } from "../../config";
import { t } from "../../i18n";
import { navigate } from "../../router";
import { TID } from "../../testids";
import { Mark, QuietButton, ReceiptTable } from "../../ui";
import { laterPlan } from "./held";

/**
 * A closed Hand (UX-SPEC §8.2 "Closed"): how it ended, read from Core's own events in the block
 * that closed it, then the bounded look for a newer Hand by the same asker (R-27, D-64) and,
 * always, the line that sends the reader back to whoever sent the link.
 */

type ReceiptRead = { status: "reading" } | { status: "read"; rows: ReceiptRow[]; endedBlock: bigint } | { status: "failed"; endedBlock?: bigint };

/** The Hand's closing events: every log of this Hand in the blocks that carry its `closedAt` second. */
function useReceipt(core: Address, handId: bigint, closedAt: number): ReceiptRead {
  const [read, setRead] = useState<{ key: string; value: ReceiptRead }>();
  const key = `${core}:${handId}:${closedAt}`;
  useEffect(() => {
    let live = true;
    const client = clientOf(config.chain.id);
    (async (): Promise<ReceiptRead> => {
      const logs = await handLogsAt(client, core, handId, closedAt);
      if (logs.length === 0) return { status: "failed", endedBlock: await findBlockAt(client, closedAt) };
      const rows = receiptOf(logs).rows;
      return { status: "read", rows, endedBlock: logs[0]!.blockNumber };
    })().then(
      (value) => live && setRead({ key, value }),
      () => live && setRead({ key, value: { status: "failed" } }),
    );
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` carries core, hand and time
  return read?.key === key ? read.value : { status: "reading" };
}

export interface ClosedProps {
  core: Address;
  handId: bigint;
  raiser: Address;
  closedAt: number;
  state: "thanked" | "refunded";
  decimals: number;
}

export function Closed({ core, handId, raiser, closedAt, state, decimals }: ClosedProps) {
  const receipt = useReceipt(core, handId, closedAt);
  const ended = receipt.status === "reading" ? undefined : receipt.endedBlock;
  return (
    <div className="flex flex-col gap-5" data-testid={TID.hand.closed} data-value={state}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-tight tracking-[-0.02em]">{t("hand.closed")}</p>
        {receipt.status === "reading" ? <p className="ah-meta m-0">{t("hand.receipt.reading")}</p> : null}
        {receipt.status === "read" ? (
          <>
            <ReceiptTable rows={receipt.rows} decimals={decimals} />
            <span className="flex flex-wrap items-center gap-2">
              <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{`block ${receipt.endedBlock} · tx ${receipt.rows[0]!.log.transactionHash}`}</span>} />
            </span>
          </>
        ) : null}
        {receipt.status === "failed" ? <p className="ah-label m-0">{t("hand.receipt.failed")}</p> : null}
      </div>
      {ended !== undefined ? <Newer core={core} handId={handId} raiser={raiser} endedBlock={ended} /> : null}
      <p className="ah-label m-0" data-testid={TID.hand.askSender}>
        {t("hand.askSender")}
      </p>
    </div>
  );
}

/** The public view's path of a Hand: the main contract is left out of the path, any other is named. */
function handPath(core: Address, id: bigint): string {
  const canonical = config.cores.canonical;
  const named = canonical && isAddressEqual(canonical, core) ? "" : `${core.toLowerCase()}/`;
  return `/${config.chain.id}/${named}${id}`;
}

type Look =
  | { status: "idle" }
  | { status: "reading"; done: number; of: number; found: bigint[] }
  | { status: "done"; of: number; found: bigint[] }
  | { status: "stopped"; done: number; of: number; found: bigint[] }
  | { status: "failed"; found: bigint[] };

/**
 * "Look for a newer hand by this asker": `Raised` logs filtered by the asker's address, from the
 * block where this Hand ended to the latest, in at most 216 windows of 2 000 blocks. The number
 * of requests is said before the button is pressed, and the read made is the one announced. It
 * can be stopped; what was found stays. A Hand found opens its public view only: it has its own
 * link, which this page does not have.
 */
function Newer({ core, handId, raiser, endedBlock }: { core: Address; handId: bigint; raiser: Address; endedBlock: bigint }) {
  const now = useNow();
  const [look, setLook] = useState<Look>({ status: "idle" });
  const stop = useRef(false);
  if (!now) return null;
  const plan = laterPlan(endedBlock, now.number, config.chain.blockTimeMs);
  const finder = findLaterHands(clientOf(config.chain.id), core, raiser, { fromBlock: plan.fromBlock, toBlock: plan.toBlock });
  const span = plan.minutes < 120 ? t("hand.newer.minutes", { n: plan.minutes }) : t("hand.newer.hours", { n: Math.round(plan.minutes / 60) });

  async function run() {
    stop.current = false;
    const of = finder.requests;
    setLook({ status: "reading", done: 0, of, found: [] });
    let found: bigint[] = [];
    let read = 0;
    try {
      const hands = await finder.run((sofar, done) => {
        read = done;
        found = sofar.map((hand) => hand.handId).filter((id) => id !== handId);
        setLook({ status: "reading", done, of, found });
        return !stop.current;
      });
      found = hands.map((hand) => hand.handId).filter((id) => id !== handId);
      setLook(stop.current && read < of ? { status: "stopped", done: read, of, found } : { status: "done", of, found });
    } catch {
      setLook({ status: "failed", found });
    }
  }

  const found = look.status === "idle" ? [] : look.found;
  return (
    <div className="flex flex-col gap-3">
      {look.status === "idle" ? (
        <>
          <QuietButton data-testid={TID.hand.newerLook} onClick={() => void run()} className="self-start">
            {t("hand.newer.look")}
          </QuietButton>
          <p className="ah-meta m-0" data-testid={TID.hand.newerCount} data-value={finder.requests}>
            {t("hand.newer.meta", { span, n: finder.requests })}
          </p>
        </>
      ) : null}
      {look.status === "reading" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="ah-meta m-0" role="status">
            {t("hand.newer.reading", { done: look.done, n: look.of })}
          </p>
          <QuietButton compact variant="text" onClick={() => (stop.current = true)}>
            {t("hand.newer.stop")}
          </QuietButton>
        </div>
      ) : null}
      {look.status === "stopped" ? <p className="ah-label m-0">{t("hand.newer.stopped", { done: look.done, n: look.of })}</p> : null}
      {look.status === "failed" ? <p className="ah-label m-0">{t("hand.newer.failed")}</p> : null}
      {found.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid={TID.hand.newerFound} data-value={found.map(String).join(",")}>
          <p className="ah-label m-0 font-bold">{found.length === 1 ? t("hand.newer.found", { number: found[0]!.toString() }) : t("hand.newer.foundMany", { count: found.length })}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {found.map((id) => (
              <li key={id.toString()}>
                <QuietButton compact className="ah-exact" onClick={() => navigate(handPath(core, id))}>
                  {t("hand.newer.open", { number: id.toString() })}
                </QuietButton>
              </li>
            ))}
          </ul>
          <p className="ah-label m-0">{t("hand.newer.ownLink")}</p>
        </div>
      ) : null}
      {look.status === "done" && found.length === 0 ? (
        <p className="ah-label m-0" data-testid={TID.hand.newerNone}>
          {t("hand.newer.none")}
        </p>
      ) : null}
    </div>
  );
}
