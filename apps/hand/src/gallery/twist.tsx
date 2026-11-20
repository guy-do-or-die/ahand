import {
  domain,
  routeHash,
  signGiveWithKey,
  signShake,
  type Give,
  type Hand,
  type HandEventName,
  type ReceiptRow,
  type Shake,
} from "@ahand/sdk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { keccak256, stringToHex, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { config } from "../config";
import { ChainRail, QuietButton, ReceiptTable, useLang, type RailHand, type RailRoute } from "../ui";
import { ASKER, BLOCK, CORE, DECIMALS, HELPER, HOLDER_A, HOLDER_B, TOKEN, dollars } from "./fixtures";
import { TID } from "../testids";

/**
 * The twist's place in the gallery (UX-SPEC §3: every hand turns over). Every route here is
 * signed in this browser when the gallery opens, with keys made from fixed words (sample keys,
 * nobody's money), for a Hand number that was never raised. So the checks on each back are real
 * checks of real signatures, and Core's answer is the real answer of this build's chain: that no
 * such Hand exists. A Hand that does exist turns over in the Hand view (tests/e2e/smoke/twist).
 *
 * The receipt rows below are sample events with the fields Core's events carry; the sweep's
 * flags are turned by the workbench, one by one, the way the thank screen turns them as it
 * finds each row's log on chain.
 */

/** A Hand number far above anything a stand raises. */
const SAMPLE_HAND = 4_242_424_242n;

/** Sample keys from fixed words: a key is `keccak256` of its word, never a secret. */
const keyOf = (word: string): Hex => keccak256(stringToHex(`aHand gallery sample key: ${word}`));

const KEYS = { root: keyOf("root"), first: keyOf("first holder"), second: keyOf("second holder"), giver: keyOf("helper") };

interface Sample {
  route: RailRoute;
  hands: RailHand[];
}

/** Builds and signs a route of two passes and a Give for the sample Hand. `breakAt` signs one pass with the wrong key. */
async function sampleRoute(breakAt?: number): Promise<Sample> {
  const chainId = config.chain.id;
  const signing = domain(chainId, CORE);
  const hand: Hand = {
    handId: SAMPLE_HAND,
    raiser: ASKER,
    token: TOKEN.address as Address,
    rootKey: privateKeyToAddress(KEYS.root),
    payoutGasK: 200,
    minClaimBps: 5_000,
    dataHash: keccak256(stringToHex("a sublet in Yerevan, June.")),
  };
  const shakes: Shake[] = [
    { nextKey: privateKeyToAddress(KEYS.first), payee: HOLDER_A, claimBps: 10_000, nextClaimBps: 9_800, dataHash: zeroHash },
    { nextKey: privateKeyToAddress(KEYS.second), payee: zeroAddress, claimBps: 9_800, nextClaimBps: 9_800, dataHash: zeroHash },
  ];
  const signers = [KEYS.root, KEYS.first];
  const signedShakes = await Promise.all(
    shakes.map(async (shake, index) => ({ shake, keySig: await signShake(index === breakAt ? KEYS.giver : signers[index]!, signing, hand, shake) })),
  );
  const giver = privateKeyToAddress(KEYS.giver);
  const give: Give = { signer: giver, payee: HELPER, claimBps: 9_800, routeHash: routeHash(hand, shakes), dataHash: zeroHash };
  const signedGive = {
    give,
    keySig: await signGiveWithKey(KEYS.second, signing, hand, give),
    giverSig: await signGiveWithKey(KEYS.giver, signing, hand, give),
  };
  return {
    route: { chainId, core: CORE, hand, signedShakes, signedGive, reward: dollars(40), decimals: DECIMALS },
    hands: [
      { role: "asker", address: ASKER },
      { role: "passer", address: HOLDER_A },
      { role: "passer" },
      { role: "helper", address: HELPER },
    ],
  };
}

/** The same route before anyone answered it. */
function withoutGive({ signedGive: _answer, ...route }: RailRoute): RailRoute {
  return route;
}

function useSample(breakAt?: number): Sample | undefined {
  const [sample, setSample] = useState<Sample | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void sampleRoute(breakAt).then((made) => live && setSample(made));
    return () => {
      live = false;
    };
  }, [breakAt]);
  return sample;
}

const ZERO_TX = `0x${"00".repeat(32)}` as const;
const txOf = (word: string): Hex => keccak256(stringToHex(`aHand gallery sample transaction: ${word}`));

function row(eventName: HandEventName, logIndex: number, more: Partial<ReceiptRow>, args: Record<string, bigint | number | Address | Hex> = {}): ReceiptRow {
  return {
    eventName,
    ...more,
    log: { eventName, args: { handId: SAMPLE_HAND, ...args }, blockNumber: BLOCK.number, blockHash: ZERO_TX, transactionHash: txOf("thank"), logIndex },
  };
}

/** A thank of $40 over three passes, as Core logs it, with the fields its events carry. */
const ROWS: ReceiptRow[] = [
  row("Thanked", 0, { amount: dollars(40) }, { reward: dollars(40) }),
  row("Shaken", 1, { position: 0, payee: HOLDER_A, amount: dollars(0.8) }, { position: 0n, margin: dollars(0.8), claimBps: 10_000, nextClaimBps: 9_800 }),
  row("Paid", 2, { payee: HOLDER_A, amount: dollars(0.8) }, { amount: dollars(0.8) }),
  row("Shaken", 3, { position: 1, payee: zeroAddress, amount: 0n }, { position: 1n, margin: 0n, claimBps: 9_800, nextClaimBps: 9_800 }),
  row("Shaken", 4, { position: 2, payee: HOLDER_B, amount: dollars(1.2) }, { position: 2n, margin: dollars(1.2), claimBps: 9_800, nextClaimBps: 9_500 }),
  row("Pending", 5, { payee: HOLDER_B, amount: dollars(1.2) }, { amount: dollars(1.2) }),
  row("Given", 6, { payee: HELPER, amount: dollars(38) }, { amount: dollars(38), claimBps: 9_500 }),
  row("Paid", 7, { payee: HELPER, amount: dollars(38) }, { amount: dollars(38) }),
];

const REPLAY_MS = 300;

/** The workbench turns the flags one by one, the way the thank screen does as it reads each log. */
function SweepReplay({ allAtOnce }: { allAtOnce?: boolean }) {
  const lang = useLang();
  const [landed, setLanded] = useState<boolean[]>(() => ROWS.map(() => false));
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const replay = () => {
    clearInterval(timer.current);
    if (allAtOnce) {
      setLanded(ROWS.map(() => false));
      timer.current = setInterval(() => {
        setLanded(ROWS.map(() => true));
        clearInterval(timer.current);
      }, REPLAY_MS);
      return;
    }
    let read = 0;
    setLanded(ROWS.map(() => false));
    timer.current = setInterval(() => {
      read += 1;
      setLanded(ROWS.map((_, index) => index < read));
      if (read >= ROWS.length) clearInterval(timer.current);
    }, REPLAY_MS);
  };
  useEffect(() => {
    replay();
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex flex-col gap-3" data-landed={landed.map(String).join(",")}>
      <ReceiptTable rows={ROWS} landed={landed} decimals={DECIMALS} />
      <div>
        <QuietButton compact onClick={replay} data-testid={TID.twist.replay}>
          {lang === "ru" ? "Повторить" : "Replay"}
        </QuietButton>
      </div>
    </div>
  );
}

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="g-section" data-kit={name}>
      <h2 className="ah-meta ah-meta--ink g-section__name">{name}</h2>
      {children}
    </section>
  );
}

function Case({ name, id, children }: { name: string; id: string; children: ReactNode }) {
  return (
    <div className="g-case" data-case={id}>
      <span className="ah-meta">{name}</span>
      {children}
    </div>
  );
}

export function TwistGallery() {
  const sample = useSample();
  const broken = useSample(1);
  return (
    <>
      <Section name="Flip">
        <Case id="twist-route" name="a route signed in this browser for a hand never raised: every check passes here, Core says no such hand">
          {sample ? <ChainRail hands={sample.hands} route={sample.route} you={false} next={false} /> : null}
        </Case>
        <Case id="twist-broken" name="the second pass made by a wrong key: the check fails in Core's order, the rest is not reached">
          {broken ? <ChainRail hands={broken.hands.slice(0, 3)} route={withoutGive(broken.route)} /> : null}
        </Case>
        <Case id="twist-plain" name="no route given: the rail does not turn">
          <ChainRail hands={[{ role: "asker", address: ASKER }, { role: "passer", address: HOLDER_A }]} />
        </Case>
      </Section>

      <Section name="Sweep">
        <Case id="twist-receipt" name="each row turns to its formula and its events">
          <ReceiptTable rows={ROWS} decimals={DECIMALS} />
        </Case>
        <Case id="twist-sweep" name="flags turned one by one: the marker follows each row's read">
          <SweepReplay />
        </Case>
        <Case id="twist-sweep-all" name="every flag at once: the marker still goes row by row">
          <SweepReplay allAtOnce />
        </Case>
      </Section>
    </>
  );
}
