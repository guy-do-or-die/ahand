import { plugin } from "bun";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The calm view and the lens (Since 2026-11-21: the evidence is hidden under
 * the lens). With the lens off, the kit draws plain words: no marks of how a claim
 * is known, no Core field names, no block numbers, no short addresses, no disclosures. With it
 * on, every piece of that evidence stands where it stood. What a person needs to act safely
 * stays in both: the whole address money lands at, the asker's-words warning, an error's
 * sentence, the cost of a send and a payout that waits. The browser half is
 * tests/e2e/smoke/lens.spec.ts.
 */

const example = readFileSync(join(import.meta.dir, "../config/config.example.json"), "utf8");
plugin({
  name: "ahand-config",
  setup(build) {
    build.module("virtual:ahand-config", () => ({ contents: `export default ${example};`, loader: "js" }));
  },
});

const { Ambient } = await import("./ambient");
const { Proof, ProofPage } = await import("./Proof");
const { Mark } = await import("./Mark");
const { Disclose } = await import("./Disclose");
const { DealCard } = await import("./DealCard");
const { Identity } = await import("./Identity");
const { TxRail } = await import("./TxRail");
const { CostLine } = await import("./CostLine");
const { ReceiptTable } = await import("./ReceiptTable");
const { ChainRail } = await import("./ChainRail");
const { ErrorBand } = await import("./ErrorBand");
const { shortAddress } = await import("./format");
const fx = await import("../gallery/fixtures");

function draw(lens: boolean, node: ReactNode): string {
  return renderToStaticMarkup(<Ambient lens={lens}>{node}</Ambient>);
}

/** The visible text of some markup, tags and entities left out. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const card = (
  <DealCard
    state="open"
    description={{ status: "attached", title: fx.HAND_WORDS.en.title, content: fx.HAND_WORDS.en.content }}
    reward={fx.dollars(40)}
    decimals={fx.DECIMALS}
    expiry={fx.EXPIRY}
    claimBps={10_000}
    raiser={fx.ASKER}
    handId={12n}
    block={fx.BLOCK}
    timeZone="UTC"
  />
);

describe("Proof: one switch between the calm view and the lens", () => {
  test("off: nothing, or the plain words it was given; on: the evidence", () => {
    expect(draw(false, <Proof>block 1 234</Proof>)).toBe("");
    expect(draw(false, <Proof calm="someone">0x7099…79C8</Proof>)).toBe("someone");
    expect(draw(true, <Proof calm="someone">0x7099…79C8</Proof>)).toBe("0x7099…79C8");
  });
});

describe("a page that is itself the proof (the passport, /check, /core)", () => {
  test("draws its evidence in the calm view too, each disclosure closed and one tap away", () => {
    const page = (
      <ProofPage>
        <Mark kind="chain" source="eth_call · block 1" />
        <Disclose label="Evidence">hands(12).dataHash</Disclose>
        <Proof>block 1 234</Proof>
      </ProofPage>
    );
    const calm = draw(false, page);
    expect(text(calm)).toContain("On chain");
    expect(text(calm)).toContain("Evidence");
    expect(text(calm)).toContain("block 1 234");
    expect(calm).not.toContain("hands(12).dataHash");
    expect(text(draw(true, page))).toContain("hands(12).dataHash");
  });
});

describe("marks and disclosures are proof", () => {
  test("Checked here and On chain stand only under the lens", () => {
    for (const kind of ["checked", "chain"] as const) {
      expect(draw(false, <Mark kind={kind} source="eth_call · block 1" />)).toBe("");
      expect(text(draw(true, <Mark kind={kind} source="eth_call · block 1" />))).toContain("eth_call · block 1");
    }
  });

  test("Waiting says where money is: a plain tag in the calm view, its source only under the lens", () => {
    const calm = draw(false, <Mark kind="waiting" source="Pending · block 9" />);
    expect(text(calm)).toContain("Waiting");
    expect(calm).not.toContain("Pending · block 9");
    expect(calm).not.toContain("<button");
    expect(text(draw(true, <Mark kind="waiting" source="Pending · block 9" />))).toContain("Pending · block 9");
  });

  test("a Disclose is not drawn in the calm view and stands open under the lens", () => {
    const disclosure = <Disclose label="What this link proves">hands(12).dataHash</Disclose>;
    expect(draw(false, disclosure)).toBe("");
    const lensed = draw(true, disclosure);
    expect(lensed).toContain('aria-expanded="true"');
    expect(text(lensed)).toContain("hands(12).dataHash");
  });
});

describe("the Deal card", () => {
  test("calm: the reward, the date and the rows in words; no field, no block, no mark, no address", () => {
    const calm = text(draw(false, card));
    expect(calm).toContain("$40");
    expect(calm).toContain("open until 20 Dec");
    // The message says the amount and whose it will be; what passing on means is the screen's to
    // say, and "Someone raised a hand" already names the asker, so neither row is drawn.
    expect(calm).toContain("If you help and they thank you");
    expect(calm).not.toContain("If you pass it on");
    expect(calm).not.toContain("Asked by");
    expect(calm).toContain("If nobody is thanked by");
    // The asker's words stand under the line that says who asks, with no bubble around them; the
    // line that nobody checked them is for the lens, and for words that give a reason for care (below).
    expect(calm).not.toContain("In the asker's words — not checked");
    expect(draw(false, card)).toMatch(/ah-asker__words/);
    expect(draw(false, card)).not.toMatch(/ah-asker__bubble/);
    // No bar under the reward: nothing on a Hand progresses.
    expect(draw(false, card)).not.toContain('role="meter"');
    for (const evidence of ["hands(12)", "block", "On chain", "Network time", shortAddress(fx.ASKER), "claimBps"]) expect(calm).not.toContain(evidence);
    expect(draw(false, card)).not.toContain("ah-figure");
  });

  test("the line that nobody checked the words: under the lens always, in the calm view when the words give a reason for care", () => {
    expect(text(draw(true, card))).toContain("In the asker's words — not checked");
    const wary = (title: string) => (
      <DealCard state="open" description={{ status: "attached", title }} reward={fx.dollars(40)} decimals={fx.DECIMALS} expiry={fx.EXPIRY} claimBps={10_000} raiser={fx.ASKER} handId={12n} timeZone="UTC" />
    );
    // An amount in the words that is not the reward Core holds.
    const amount = text(draw(false, wary("A sublet in Yerevan, I pay $500")));
    expect(amount).toContain("The words mention $500");
    expect(amount).toContain("In the asker's words — not checked");
    // A character that is not seen (a zero-width space).
    expect(text(draw(false, wary("A sublet in Yere\u200bvan")))).toContain("In the asker's words — not checked");
    // Plain words: the quotation is enough.
    expect(text(draw(false, wary("A sublet in Yerevan")))).not.toContain("not checked");
  });

  test("lens: every source stands open, as before", () => {
    const lensed = text(draw(true, card));
    expect(lensed).toContain("hands(12).reward = 40000000");
    expect(lensed).toContain("hands(12).expiry");
    expect(lensed).toContain("On chain");
    expect(lensed).toContain("Network time · block 1 234");
    expect(lensed).toContain(shortAddress(fx.ASKER));
  });

  test("the asker's own card leaves out its 'Asked from your address' row in the calm view", () => {
    const own = text(draw(false, <DealCard state="thanked" description={{ status: "none" }} reward={fx.dollars(40)} decimals={fx.DECIMALS} expiry={fx.EXPIRY} closedAt={fx.THANKED_AT} viewer="asker" raiser={fx.ASKER} handId={12n} timeZone="UTC" />));
    expect(own).not.toContain("Asked from your address");
    expect(own).not.toContain("someone");
    expect(own).not.toContain("closedAt");
  });
});

describe("who, in words", () => {
  test("a short address is 'someone' in the calm view; the whole address money lands at stays in both", () => {
    expect(text(draw(false, <Identity address={fx.HELPER} />))).toBe("someone");
    expect(text(draw(true, <Identity address={fx.HELPER} />))).toContain(shortAddress(fx.HELPER));
    for (const lens of [false, true]) expect(text(draw(lens, <Identity address={fx.HELPER} full />))).toContain(fx.HELPER);
  });

  test("the viewer's own account shows its short address in both views", () => {
    for (const lens of [false, true]) {
      const own = text(draw(lens, <Identity address={fx.HELPER} own />));
      expect(own).toContain(shortAddress(fx.HELPER));
      expect(own).not.toContain("someone");
    }
  });

  test("the rail names hands in words and does not turn in the calm view", () => {
    const route = <ChainRail hands={fx.SHORT_ROUTE} />;
    const calm = text(draw(false, route));
    expect(calm).toContain("the asker");
    expect(calm).not.toContain(shortAddress(fx.ASKER));
    expect(text(draw(true, route))).toContain(shortAddress(fx.ASKER));
  });

  test("the receipt says who got what without addresses, and its rows turn only under the lens", () => {
    const table = <ReceiptTable rows={fx.THANK_ROWS} decimals={fx.DECIMALS} />;
    const calm = draw(false, table);
    expect(text(calm)).toContain("$38.00");
    expect(text(calm)).toContain("Waiting");
    expect(calm).not.toContain(shortAddress(fx.HELPER));
    expect(calm).not.toContain("ah-receipt--flips");
    expect(calm).not.toContain('data-testid="twist-flip"');
    const lensed = draw(true, table);
    expect(lensed).toContain(shortAddress(fx.HELPER));
    expect(lensed).toContain('data-testid="twist-flip"');
  });
});

describe("progress, cost and errors", () => {
  test("a send's progress is one sentence in the calm view and four steps under the lens", () => {
    const calm = text(draw(false, <TxRail reached="in-block" local />));
    expect(calm).toContain("It went through. Making it final…");
    expect(calm).not.toContain("Recorded on Ethereum");
    expect(calm).not.toContain("Local stand-in");
    const lensed = text(draw(true, <TxRail reached="in-block" local />));
    for (const step of ["Sent", "In a block", "Recorded on Ethereum", "Final", "Local stand-in"]) expect(lensed).toContain(step);
  });

  test("the network's offline line stands in both views", () => {
    for (const lens of [false, true]) expect(text(draw(lens, <TxRail reached="sent" offline />))).toContain("Can't reach the network right now.");
  });

  test("what a send costs stands in both views; Ethereum, the price date and the gas only under the lens", () => {
    const prices = { date: "2026-11-10", source: "test", ethUsd: 3000, base: { gwei: "0.01" }, ethereum: { gwei: "1" } } as never;
    const cost = { base: { usd: "0.003", eth: "0.000001" }, ethereum: { usd: "0.21", eth: "0.00007" } } as never;
    const calm = text(draw(false, <CostLine cost={cost} prices={prices} gas={21_000n} />));
    expect(calm).toContain("sending it costs about $0.003");
    expect(calm).not.toContain("Ethereum");
    expect(calm).not.toContain("gwei");
    const lensed = text(draw(true, <CostLine cost={cost} prices={prices} gas={21_000n} />));
    expect(lensed).toContain("$0.21 on Ethereum");
    expect(lensed).toContain("gwei");
  });

  test("an error's sentence and what was not lost stand in both views; Core's name for it only under the lens", () => {
    const band = <ErrorBand what="This hand is closed." kept="Nothing was sent." code="CORE · NotOpen" />;
    const calm = text(draw(false, band));
    expect(calm).toContain("This hand is closed.");
    expect(calm).toContain("Nothing was sent.");
    expect(calm).not.toContain("NotOpen");
    expect(text(draw(true, band))).toContain("CORE · NotOpen");
  });
});
