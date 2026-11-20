import {
  askSigner,
  BPS,
  checkRouteOnChain,
  decodeCoreError,
  domain,
  runSteps,
  type CoreRefusal,
  type Step,
  type StepResult,
} from "@ahand/sdk";
import { useEffect, useState, type ReactNode } from "react";
import { zeroAddress, type Address, type PublicClient } from "viem";

import { clientOf } from "../chain/hooks";
import type { RailRoute } from "./ChainRail";
import { refusalSentence, useTicks, useTwistWords, type TwistWords } from "./Flip";
import { count, money, percent } from "./format";
import { useLang, type Lang } from "./ambient";
import { TID } from "../testids";

/**
 * The back of a pass on the ChainRail (UX-SPEC §3): in mono, the share it kept as a percentage
 * and as money at today's reward, where that share lands, the key that held the link, then
 * the checks of the SDK's `runSteps` for this pass ticking one by one in Core's order, and last
 * Core's own answer from `checkRouteOnChain`, read at a named block.
 *
 * Everything here is computed when the card turns: the steps from the signatures the link
 * carries, the answer by one `eth_call` pinned to the block it names.
 */

export interface ShakeBackProps {
  route: RailRoute;
  /** The pass's position on the route, from 0. */
  position: number;
}

export function ShakeBack({ route, position }: ShakeBackProps) {
  const words = useTwistWords();
  const lang = useLang();
  const { shake } = route.signedShakes[position]!;
  const margin = shake.claimBps - shake.nextClaimBps;
  const heldBy = position === 0 ? route.hand.rootKey : route.signedShakes[position - 1]!.shake.nextKey;
  const proof = useProof(
    `shake:${route.chainId}:${route.core}:${route.hand.handId}:${position}:${route.signedShakes[position]!.keySig}`,
    async (client) => {
      const shakes = route.signedShakes.slice(0, position + 1);
      const all = await runSteps(domain(route.chainId, route.core), route.hand, shakes, undefined, askSigner(client));
      const steps = all.filter((step) => step.of === "shake" && step.position === position);
      const answer = await coreAnswer(client, "checkRoute", async (pinned) => {
        const end = await checkRouteOnChain(pinned, route.core, route.hand.handId, shakes);
        return `lastKey ${end.lastKey} · claimBps ${count(end.claimBps)}`;
      });
      return { steps, answer };
    },
    route.chainId,
  );

  return (
    <div className="ah-back" lang={lang}>
      <dl className="ah-back__facts">
        <Fact label={words.share} testId={TID.twist.share} value={String(margin)}>
          {margin === 0 ? words.noShare : shareText(margin, route.reward, route.decimals, lang, words)}
        </Fact>
        <Fact label={words.lands} testId={TID.twist.payee} value={shake.payee}>
          {shake.payee === zeroAddress ? words.landsNowhere : <Exact>{shake.payee}</Exact>}
        </Fact>
        <Fact label={words.heldBy} testId={TID.twist.key} value={heldBy}>
          <Exact>{heldBy}</Exact>
        </Fact>
        <Fact label={words.nextKey}>
          <Exact>{shake.nextKey}</Exact>
        </Fact>
      </dl>
      <ProofBody proof={proof} sentence={(step) => shakeSentence(step, margin, words)} />
    </div>
  );
}

/** "2% · $0.80 at today's reward"; for a Hand with no reward (or none known), the percentage alone. */
export function shareText(bps: number, reward: bigint | undefined, decimals: number | undefined, lang: Lang, words: TwistWords): string {
  const pct = percent(bps, lang);
  if (reward === undefined || reward === 0n || decimals === undefined) return words.sharePct(pct);
  return words.shareOf(pct, money(mulDiv(reward, bps), decimals, lang, { cents: true }));
}

/** Core's `Math.mulDiv(reward, bps, BPS)`: rounded down. */
export function mulDiv(reward: bigint, bps: number): bigint {
  return (reward * BigInt(bps)) / BigInt(BPS);
}

function shakeSentence(step: Step, margin: number, words: TwistWords): string {
  const say = words.steps.shake;
  if (step.check === "InvalidClaim") return say.claim;
  if (step.check === "AnonymousMargin") return margin === 0 ? say.noMargin : say.margin;
  return say.key;
}

// ── Shared by the backs ─────────────────────────────────────────────────────

/** What Core said, at which block. */
export type CoreAnswer =
  | { kind: "ok"; fn: string; block: bigint; detail?: string }
  | { kind: "refused"; fn: string; block: bigint; refusal: CoreRefusal }
  | { kind: "offline" };

export interface ProofRun {
  steps: StepResult[];
  answer: CoreAnswer;
  /** Lines shown after Core's answer (the giveHash comparison). */
  after?: ReactNode;
}

export type ProofState = { status: "running" } | { status: "done"; run: ProofRun } | { status: "offline" };

/**
 * A client whose reads all happen at one block, so "block n" on the card is the block the answer
 * was read at, not a block read beside it.
 */
export function pinnedTo(client: PublicClient, blockNumber: bigint): PublicClient {
  return {
    ...client,
    readContract: ((args: Parameters<PublicClient["readContract"]>[0]) => client.readContract({ ...args, blockNumber } as never)) as PublicClient["readContract"],
    call: ((args: Parameters<PublicClient["call"]>[0]) => client.call({ ...args, blockNumber } as never)) as PublicClient["call"],
    getCode: ((args: Parameters<PublicClient["getCode"]>[0]) => client.getCode({ ...args, blockNumber } as never)) as PublicClient["getCode"],
  } as PublicClient;
}

/**
 * Asks Core one question at the latest block. A refusal is Core's answer, said with its name; a
 * network that does not answer is "offline", never a refusal.
 */
export async function coreAnswer(client: PublicClient, fn: string, ask: (pinned: PublicClient, block: bigint) => Promise<string | undefined>): Promise<CoreAnswer> {
  let block: bigint;
  try {
    block = await client.getBlockNumber({ cacheTime: 0 });
  } catch {
    return { kind: "offline" };
  }
  try {
    const detail = await ask(pinnedTo(client, block), block);
    return detail === undefined ? { kind: "ok", fn, block } : { kind: "ok", fn, block, detail };
  } catch (error) {
    const refusal = decodeCoreError(error);
    if (refusal) return { kind: "refused", fn, block, refusal };
    return { kind: "offline" };
  }
}

/** Runs a back's checks once per `key`, when the back is shown. */
export function useProof(key: string, run: (client: PublicClient) => Promise<ProofRun>, chainId: number): ProofState {
  const [state, setState] = useState<ProofState>({ status: "running" });
  useEffect(() => {
    let live = true;
    setState({ status: "running" });
    let client: PublicClient;
    try {
      client = clientOf(chainId);
    } catch {
      setState({ status: "offline" });
      return;
    }
    run(client).then(
      (done) => live && setState({ status: "done", run: done }),
      () => live && setState({ status: "offline" }),
    );
    return () => {
      live = false;
    };
    // `run` is rebuilt every render; `key` names what it checks.
  }, [key, chainId]);
  return state;
}

/** The ticking checks, then Core's answer once the last check has ticked. */
export function ProofBody({ proof, sentence, checks = true }: { proof: ProofState; sentence: (step: Step) => string; checks?: boolean }) {
  const words = useTwistWords();
  const lang = useLang();
  const steps = proof.status === "done" ? proof.run.steps : [];
  const shown = useTicks(steps.length, proof.status === "done");
  const ticked = proof.status === "done" && shown >= steps.length;

  if (proof.status === "offline") {
    return (
      <p className="ah-back__line" data-testid={TID.twist.core} data-status="offline">
        {words.offline}
      </p>
    );
  }
  return (
    <>
      {checks && (proof.status === "running" || steps.length > 0) ? <p className="ah-back__label">{words.inOrder}</p> : null}
      {proof.status === "running" ? (
        <p className="ah-back__line" aria-live="polite">
          {words.checking}
        </p>
      ) : (
        <ol className="ah-back__steps">
          {steps.map((step, index) => (
            <li
              key={`${step.of}-${step.check}`}
              className="ah-back__step"
              data-testid={TID.twist.step}
              data-check={step.check}
              data-status={index < shown ? step.status : "pending"}
              data-shown={String(index < shown)}
            >
              <span aria-hidden="true" className="ah-back__tick">
                {index < shown ? (step.status === "pass" ? "✓" : step.status === "fail" ? "✗" : "–") : "·"}
              </span>
              <span>
                {step.status === "fail" ? (refusalSentence(step.check, lang) ?? sentence(step)) : sentence(step)}
                {step.status === "not-reached" ? ` · ${words.notReached}` : null}
                <span className="ah-back__name"> · {step.check}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {ticked && proof.status === "done" ? <AnswerLine answer={proof.run.answer} /> : null}
      {ticked && proof.status === "done" ? proof.run.after : null}
    </>
  );
}

function AnswerLine({ answer }: { answer: CoreAnswer }) {
  const words = useTwistWords();
  const lang = useLang();
  if (answer.kind === "offline") {
    return (
      <p className="ah-back__answer" data-testid={TID.twist.core} data-status="offline">
        {words.offline}
      </p>
    );
  }
  const name = answer.kind === "ok" ? words.ok : `${answer.refusal.name}${answer.refusal.position === undefined ? "" : `(${answer.refusal.position})`}`;
  return (
    <div className="ah-back__core" data-testid={TID.twist.core} data-status={answer.kind} data-block={answer.block.toString()}>
      <p className="ah-back__label">{words.coreAnswer}</p>
      <p className="ah-back__answer">
        <span aria-hidden="true">{answer.kind === "ok" ? "⛓️ " : "✗ "}</span>
        {words.callLine(answer.fn, count(answer.block), name)}
      </p>
      {answer.kind === "ok" && answer.detail ? <p className="ah-back__line ah-back__exact">{answer.detail}</p> : null}
      {answer.kind === "refused" ? <p className="ah-back__line">{refusalSentence(answer.refusal.name, lang) ?? answer.refusal.name}</p> : null}
    </div>
  );
}

export function Fact({ label, children, testId, value }: { label: string; children: ReactNode; testId?: string; value?: string }) {
  return (
    <div className="ah-back__fact" data-testid={testId} data-value={value}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** An address or a hash: exact letters, may break anywhere. */
export function Exact({ children }: { children: Address | string }) {
  return <span className="ah-back__exact">{children}</span>;
}
