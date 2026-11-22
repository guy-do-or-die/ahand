import { findLaterHands, handLogsAt, receiptOf, type LaterLook, type ReceiptRow } from "@ahand/sdk";
import { useEffect, useRef, useState } from "react";
import { BaseError, isAddressEqual, type Address } from "viem";

import { clientOf } from "../../chain";
import { answerOf, isNetworkError } from "../../chain/errors";
import { config } from "../../config";
import { t } from "../../i18n";
import { navigate } from "../../router";
import { TID } from "../../testids";
import { Mark, Proof, QuietButton, ReceiptTable } from "../../ui";
import { proofPathOf } from "./held";
import { OnExplorer } from "../../shell/OnExplorer";

/**
 * A closed Hand: how it ended, read from Core's own events in the block
 * that closed it, then the bounded look for a newer Hand by the same asker and,
 * always, the line that sends the reader back to whoever sent the link. Under the receipt, the
 * way to the Hand's passport, where the receipt checks itself.
 */

type ReceiptRead = { status: "reading" } | { status: "read"; rows: ReceiptRow[]; endedBlock: bigint } | { status: "failed" };

/** The Hand's closing events: every log of this Hand in the blocks that carry its `closedAt` second. */
function useReceipt(core: Address, handId: bigint, closedAt: number): ReceiptRead {
  const [read, setRead] = useState<{ key: string; value: ReceiptRead }>();
  const key = `${core}:${handId}:${closedAt}`;
  useEffect(() => {
    let live = true;
    const client = clientOf(config.chain.id);
    (async (): Promise<ReceiptRead> => {
      const logs = await handLogsAt(client, core, handId, closedAt);
      if (logs.length === 0) return { status: "failed" };
      const rows = receiptOf(logs).rows;
      return { status: "read", rows, endedBlock: logs[0]!.blockNumber };
    })().then(
      (value) => live && setRead({ key, value }),
      () => live && setRead({ key, value: { status: "failed" } }),
    );
    return () => {
      live = false;
    };
  }, [key]); // `key` carries core, hand and time
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
  return (
    <div className="flex flex-col gap-5" data-testid={TID.hand.closed} data-value={state}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[length:var(--fs-card-title)] font-extrabold leading-tight tracking-[-0.02em]">{t("hand.closed")}</p>
        {receipt.status === "reading" ? <p className="ah-meta m-0">{t("hand.receipt.reading")}</p> : null}
        {receipt.status === "read" ? (
          <>
            <ReceiptTable rows={receipt.rows} decimals={decimals} />
            <Proof>
              <span className="flex flex-wrap items-center gap-2">
                <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">{`block ${receipt.endedBlock} · tx ${receipt.rows[0]!.log.transactionHash}`}</span>} />
                <OnExplorer tx={receipt.rows[0]!.log.transactionHash} />
              </span>
            </Proof>
          </>
        ) : null}
        {receipt.status === "failed" ? <p className="ah-label m-0">{t("hand.receipt.failed")}</p> : null}
        <Proof>
          <a
            href={proofPathOf(config.chain.id, core, handId, config.cores.canonical)}
            className="ah-label inline-flex min-h-[44px] items-center self-start font-bold"
            data-testid={TID.hand.proofLink}
          >
            {t("hand.proofLink")}
          </a>
        </Proof>
      </div>
      <Newer core={core} handId={handId} raiser={raiser} />
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

type Plan = { status: "counting" } | { status: "counted"; look: LaterLook } | { status: "failed"; offline: boolean; detail?: string };

type Look =
  | { status: "idle" }
  | { status: "reading"; done: number; of: number; found: bigint[] }
  | { status: "done"; of: number; found: bigint[] }
  | { status: "stopped"; done: number; of: number; found: bigint[] }
  | { status: "failed"; found: bigint[]; offline: boolean; detail?: string };

/**
 * What went wrong, said honestly: the network did not answer, or a node answered and refused. A
 * node's answer (an HTTP status such as 429 or 503, a JSON-RPC error) is a refusal even when it
 * arrived as one of viem's transport errors, and the detail is the node's own words, not viem's
 * sentence about them ("RPC Request failed.").
 */
function failureOf(error: unknown): { offline: boolean; detail?: string } {
  const answer = answerOf(error);
  if (!answer && isNetworkError(error)) return { offline: true };
  const said = answer?.words ?? (error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : undefined);
  const detail = [answer?.status === undefined ? undefined : `HTTP ${answer.status}`, said].filter(Boolean).join(": ");
  return detail ? { offline: false, detail: detail.split("\n")[0]!.slice(0, 200) } : { offline: false };
}

/**
 * "Look for a newer hand by this asker": Core numbers its Hands, so every Hand
 * raised after this one has a larger number, and `hands(id).raiser` says whose it is. Core's
 * `handsCount` is read first (one request); then the screen says how many Hands the look reads
 * and in how many requests (each reads up to 200 Hands in one call through the forwarder), and
 * the read made is the one announced. Any later Hand by the same address counts, even one raised
 * while this one was still open. At most the newest 20 000 are read. It can be stopped; what was
 * found stays. A Hand found opens its public view only: it has its own link, which this page
 * does not have. No log is read, so neither how long ago this Hand ended nor a node's limit on
 * log ranges changes it. The count is read when the screen opens, so a Hand raised after that is
 * in the look only once the page is opened again; reading it again at the press would make the
 * look differ from what was announced.
 */
function Newer({ core, handId, raiser }: { core: Address; handId: bigint; raiser: Address }) {
  const [plan, setPlan] = useState<Plan>({ status: "counting" });
  const [again, setAgain] = useState(0);
  const [look, setLook] = useState<Look>({ status: "idle" });
  const stop = useRef(false);

  useEffect(() => {
    let live = true;
    setPlan({ status: "counting" });
    findLaterHands(clientOf(config.chain.id), core, handId, raiser, { forwarder: config.forwarder }).then(
      (counted) => live && setPlan({ status: "counted", look: counted }),
      (error: unknown) => live && setPlan({ status: "failed", ...failureOf(error) }),
    );
    return () => {
      live = false;
    };
  }, [core, handId, raiser, again]);

  if (plan.status === "counting") return null;
  if (plan.status === "failed") {
    return (
      <div className="flex flex-col gap-2">
        <p className="ah-label m-0" data-testid={TID.hand.newerFailed} data-value={plan.offline ? "offline" : "refused"}>
          {t(plan.offline ? "hand.newer.countOffline" : "hand.newer.countRefused")}
        </p>
        {plan.detail ? (
          <Proof>
            <p className="ah-meta ah-meta--exact m-0">{plan.detail}</p>
          </Proof>
        ) : null}
        <QuietButton compact className="self-start" onClick={() => setAgain((n) => n + 1)}>
          {t("hand.newer.retry")}
        </QuietButton>
      </div>
    );
  }
  const finder = plan.look;
  if (finder.reads === 0) {
    return (
      <p className="ah-label m-0" data-testid={TID.hand.newerNone} data-value="none-after">
        {t("hand.newer.nothingAfter")}
      </p>
    );
  }

  async function run() {
    stop.current = false;
    const of = finder.requests;
    setLook({ status: "reading", done: 0, of, found: [] });
    let found: bigint[] = [];
    let read = 0;
    try {
      const hands = await finder.run((sofar, done) => {
        read = done;
        found = sofar.map((hand) => hand.handId);
        setLook({ status: "reading", done, of, found });
        return !stop.current;
      });
      found = hands.map((hand) => hand.handId);
      setLook(stop.current && read < of ? { status: "stopped", done: read, of, found } : { status: "done", of, found });
    } catch (error) {
      setLook({ status: "failed", found, ...failureOf(error) });
    }
  }

  const after = Number(finder.after);
  const meta = finder.capped
    ? t("hand.newer.metaCapped", { n: finder.reads, total: after, k: finder.requests })
    : t("hand.newer.meta", { n: finder.reads, k: finder.requests });
  const found = look.status === "idle" ? [] : look.found;
  return (
    <div className="flex flex-col gap-3">
      {look.status === "idle" ? (
        <>
          <QuietButton data-testid={TID.hand.newerLook} onClick={() => void run()} className="self-start">
            {t("hand.newer.look")}
          </QuietButton>
          <Proof>
            <p className="ah-meta m-0" data-testid={TID.hand.newerCount} data-value={finder.requests} data-hands={finder.reads}>
              {meta}
            </p>
          </Proof>
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
      {look.status === "failed" ? (
        <>
          <p className="ah-label m-0" data-testid={TID.hand.newerFailed} data-value={look.offline ? "offline" : "refused"}>
            {t(look.offline ? "hand.newer.failed" : "hand.newer.refused")}
          </p>
          {look.detail ? (
            <Proof>
              <p className="ah-meta ah-meta--exact m-0">{look.detail}</p>
            </Proof>
          ) : null}
        </>
      ) : null}
      {found.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid={TID.hand.newerFound} data-value={found.map(String).join(",")} data-look={look.status}>
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
          <p className="ah-label m-0">{t(found.length === 1 ? "hand.newer.ownLink" : "hand.newer.ownLinks")}</p>
        </div>
      ) : null}
      {look.status === "done" && found.length === 0 ? (
        <p className="ah-label m-0" data-testid={TID.hand.newerNone} data-value="none-by-asker">
          {t("hand.newer.none")}
        </p>
      ) : null}
    </div>
  );
}
