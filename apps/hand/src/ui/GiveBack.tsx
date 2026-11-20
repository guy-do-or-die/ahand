import {
  askSigner,
  checkGiveOnChain,
  domain,
  giveHash,
  isErc6492,
  readThank,
  runSteps,
  unwrap6492,
  type AccountSetup,
  type Step,
} from "@ahand/sdk";
import { zeroHash, type PublicClient } from "viem";

import { config } from "../config";
import type { RailRoute } from "./ChainRail";
import { useTwistWords, type TwistWords } from "./Flip";
import { count, money, percent } from "./format";
import { useLang } from "./ambient";
import { coreAnswer, Exact, Fact, mulDiv, ProofBody, shareText, useProof, type CoreAnswer } from "./ShakeBack";
import { TID } from "../testids";

/**
 * The back of the helper's card (UX-SPEC §3): the Give's claim, who confirmed it and where the
 * money lands, the same ticking of Core's checks (the Give's own fields, then the Give after the
 * route), and Core's answer. While the Hand is open that answer is `checkGive`. Once the Hand is
 * thanked it is `thanks(id)`: the giveHash rebuilt here from the Give's fields is compared with
 * the one Core stored, and the card says "giveHash matches Core" only when they are equal.
 */

export interface GiveBackProps {
  route: RailRoute;
}

export function GiveBack({ route }: GiveBackProps) {
  const words = useTwistWords();
  const lang = useLang();
  const signed = route.signedGive!;
  const { give } = signed;
  const lastKey = route.signedShakes.length === 0 ? route.hand.rootKey : route.signedShakes[route.signedShakes.length - 1]!.shake.nextKey;
  const rebuilt = giveHash(route.hand, give);

  const proof = useProof(
    `give:${route.chainId}:${route.core}:${route.hand.handId}:${signed.keySig}:${signed.giverSig}`,
    async (client) => {
      const all = await runSteps(domain(route.chainId, route.core), route.hand, route.signedShakes, signed, askSigner(client));
      const steps = all.filter((step) => step.of === "give");
      // A thanked Hand answers through `thanks(id)`; an open one through `checkGive`.
      const thanked = await readThank(client, route.core, route.hand.handId).then((read) => read.giveHash, () => undefined);
      if (thanked !== undefined && thanked !== zeroHash) {
        const answer = await coreAnswer(client, "thanks(id)", async (pinned) => {
          const stored = (await readThank(pinned, route.core, route.hand.handId)).giveHash;
          return `giveHash ${stored}`;
        });
        const stored = answer.kind === "ok" ? answer.detail!.slice("giveHash ".length) : undefined;
        return { steps, answer, after: <HashMatch rebuilt={rebuilt} stored={stored} answer={answer} words={words} /> };
      }
      const setup = setupOf(signed.giverSig);
      const answer = await coreAnswer(client, "checkGive", async (pinned) => {
        await checkGiveOnChain(pinned, route.core, route.hand.handId, route.signedShakes, signed, setup);
        return undefined;
      });
      return { steps, answer, after: <RebuiltLine rebuilt={rebuilt} words={words} /> };
    },
    route.chainId,
  );

  // What the route left the helper, at today's reward: Core's own sum, the reward less every margin.
  const margins = route.signedShakes.reduce((sum, { shake }) => sum + (route.reward === undefined ? 0n : mulDiv(route.reward, shake.claimBps - shake.nextClaimBps)), 0n);
  const claim =
    route.reward === undefined || route.reward === 0n || route.decimals === undefined
      ? shareText(give.claimBps, undefined, undefined, lang, words)
      : words.shareOf(percent(give.claimBps, lang), money(route.reward - margins, route.decimals, lang, { cents: true }));

  return (
    <div className="ah-back" lang={lang}>
      <dl className="ah-back__facts">
        <Fact label={words.claimLeft} testId={TID.twist.share} value={String(give.claimBps)}>
          {claim}
        </Fact>
        <Fact label={words.confirmedBy} testId={TID.twist.signer} value={give.signer}>
          <Exact>{give.signer}</Exact>
        </Fact>
        <Fact label={words.lands} testId={TID.twist.payee} value={give.payee}>
          <Exact>{give.payee}</Exact>
        </Fact>
        <Fact label={words.heldBy} testId={TID.twist.key} value={lastKey}>
          <Exact>{lastKey}</Exact>
        </Fact>
      </dl>
      <ProofBody proof={proof} sentence={(step) => giveSentence(step, words)} />
    </div>
  );
}

/** The forwarder's setup for an account not deployed yet, as the thank screen asks Core (D-62). */
function setupOf(giverSig: `0x${string}`): AccountSetup | undefined {
  if (!isErc6492(giverSig) || !config.forwarder) return undefined;
  const wrapped = unwrap6492(giverSig);
  return wrapped ? { forwarder: config.forwarder, factory: wrapped.factory, factoryData: wrapped.factoryData } : undefined;
}

function giveSentence(step: Step, words: TwistWords): string {
  const say = words.steps.give;
  switch (step.check) {
    case "GiverIsRaiser":
      return say.notRaiser;
    case "ZeroPayee":
      return say.payee;
    case "InvalidClaim":
      return say.claim;
    case "InvalidRouteHash":
      return say.route;
    case "BelowMinClaim":
      return say.min;
    case "InvalidKeySig":
      return say.key;
    default:
      return say.giver;
  }
}

function RebuiltLine({ rebuilt, words }: { rebuilt: `0x${string}`; words: TwistWords }) {
  return (
    <p className="ah-back__line ah-back__exact" data-testid={TID.twist.givehash} data-value={rebuilt}>
      {words.rebuilt}: {rebuilt}
    </p>
  );
}

function HashMatch({ rebuilt, stored, answer, words }: { rebuilt: `0x${string}`; stored: string | undefined; answer: CoreAnswer; words: TwistWords }) {
  if (answer.kind !== "ok" || stored === undefined) return <RebuiltLine rebuilt={rebuilt} words={words} />;
  const same = stored.toLowerCase() === rebuilt.toLowerCase();
  return (
    <>
      <RebuiltLine rebuilt={rebuilt} words={words} />
      <p className="ah-back__verdict" data-testid={TID.twist.match} data-status={same ? "match" : "differ"} data-block={count(answer.block)}>
        <span aria-hidden="true">{same ? "✓ " : "✗ "}</span>
        {same ? words.match : words.differ}
      </p>
    </>
  );
}
