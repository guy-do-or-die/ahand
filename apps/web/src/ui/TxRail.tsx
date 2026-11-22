import { TID } from "../testids";
import { clsx } from "../lib/clsx";
import { useLens } from "./ambient";
import { Disclose } from "./Disclose";
import { useWords } from "./words";

/** How far a sent action has got. The last three are the SDK's `finalityOf` answers. */
export type TxReached = "sent" | "in-block" | "safe" | "final";

export interface TxRailProps {
  reached: TxReached;
  /**
   * The chain has no Ethereum behind it (the local stand). Steps three and four then carry the
   * tag LOCAL STAND-IN, and a disclosure says what they mean there.
   */
  local?: boolean;
  /**
   * The network can't be reached (or blocks stopped arriving): the rail is where it was last seen,
   * and a line beside it says so, instead of a "Sent (now)" that seems to be waiting calmly.
   */
  offline?: boolean;
  className?: string;
}

const ORDER: readonly TxReached[] = ["sent", "in-block", "safe", "final"];

/**
 * Four steps joined like the chain rail: SENT · IN A BLOCK · RECORDED ON ETHEREUM · FINAL.
 * A step that is behind is an ink dot, the one reached is amber, the ones ahead are hollow;
 * each also says "done", "now" or "not yet" to a screen reader, so the state is never told by
 * colour alone.
 *
 * That is the lens's view. The calm view says the same progress as one plain sentence ("It went
 * through. Making it final…"), with the offline line under it as ever.
 */
export function TxRail({ reached, local = false, offline = false, className }: TxRailProps) {
  const words = useWords();
  const lens = useLens();
  const at = ORDER.indexOf(reached);
  const offlineLine = offline ? (
    <p className="ah-note m-0" role="status" data-testid={TID.kit.txOffline}>
      {words.deal.noClock}
    </p>
  ) : null;
  if (!lens) {
    return (
      <div className={clsx("ah-stack", className)}>
        <p className="ah-label m-0" role="status" data-reached={reached}>
          {words.tx.calm[at]}
        </p>
        {offlineLine}
      </div>
    );
  }
  return (
    <div className={clsx("ah-stack", className)}>
      <ol className="ah-tx" aria-label={words.tx.label}>
        {ORDER.map((step, index) => {
          const state = index < at || at === ORDER.length - 1 ? "done" : index === at ? "now" : "todo";
          return (
            <li key={step} className="ah-tx__step" data-state={state} aria-current={index === at ? "step" : undefined}>
              <span aria-hidden="true" className="ah-tx__track">
                <span className="ah-tx__dot" />
                {index < ORDER.length - 1 ? <span className="ah-tx__line" data-done={index < at} /> : null}
              </span>
              <span className="ah-tx__label">
                {words.tx.steps[index]}
                <span className="sr-only">
                  {" "}
                  ({words.tx[state]}
                  {local && index >= 2 ? `, ${words.tx.localTag}` : ""})
                </span>
              </span>
            </li>
          );
        })}
        {/* One tag under steps three and four; a screen reader hears it with each step. */}
        {local ? (
          <li aria-hidden="true" className="ah-tx__local">
            {words.tx.localTag}
          </li>
        ) : null}
      </ol>
      {offlineLine}
      {local ? (
        <Disclose label={words.tx.localTag}>
          <span className="ah-label">{words.tx.localWhy}</span>
        </Disclose>
      ) : null}
    </div>
  );
}
