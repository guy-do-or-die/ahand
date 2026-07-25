import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { parseUnits } from "viem";
import { ThankReceipt } from "../components/ThankReceipt";
import { SwipeButton } from "../components/SwipeButton";
import { QuietButton } from "../components/QuietButton";
import { PotBar } from "../components/PotBar";
import { ChipRow } from "../components/ChipRow";
import { ChainRail } from "../components/ChainRail";
import { ReceiptTable } from "../components/ReceiptTable";
import { Logo } from "../components/Logo";
import { Emoji } from "../components/Emoji";

export const Route = createFileRoute("/dev/gallery")({
  component: GalleryComponent,
});

/**
 * Dev-only primitive gallery: every primitive with mock sample data,
 * light and dark side by side. Strings here are dev tooling, not UI copy —
 * exempt from the i18n catalog.
 */
function GalleryComponent() {
  if (!import.meta.env.DEV) {
    return <div className="py-12 text-center ah-meta">gallery is dev-only</div>;
  }
  // ?screen=thank-receipt&theme=dark renders one composition for screenshots
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const screen = params.get("screen");
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  if (screen === "thank-receipt") {
    return (
      <div data-theme={theme} className="fixed inset-0 z-50 overflow-auto" style={{ background: "var(--paper)", color: "var(--ink)" }}>
        <ThankReceiptSample />
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: "var(--ink-a035)" }}>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 p-6 max-w-[1400px] mx-auto">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>
    </div>
  );
}

/** Mock-08 sample data through the real ThankReceipt composition — the live
 * one only renders after a wallet-signed settlement. */
function ThankReceiptSample() {
  const shake = (payout: string, parent: number, child: number) => ({
    shake: { payout, childCapability: payout, parentClaimBps: parent, childClaimBps: child },
  });
  return (
    <ThankReceipt
      pool={parseUnits("148", 6)}
      charityFeeBps={100}
      maintFeeBps={0}
      shakes={[
        shake("0xBE95000000000000000000000000000000000001", 10000, 9200),
        shake("0xA7A7000000000000000000000000000000000002", 9200, 8250),
        shake("0x9190000000000000000000000000000000000003", 8250, 7150),
      ]}
      give={{ finalClaimBps: 7150 }}
      solverLabel="0xDA4A…0004"
      onRaise={() => {}}
    />
  );
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

function Section({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="ah-meta" style={{ color: "var(--ink-a45)" }}>
        {name}
      </h2>
      {children}
    </section>
  );
}

function ThemePanel({ theme }: { theme: "light" | "dark" }) {
  const [amount, setAmount] = useState("148");
  return (
    <div
      data-theme={theme}
      className="flex flex-col gap-8 rounded-[20px] p-7"
      style={{
        background: "var(--paper)",
        color: "var(--ink)",
        border: "var(--bw-emph) solid var(--ink-a12)",
      }}
    >
      <div className="flex items-center justify-between">
        <Logo size={32} />
        <span className="ah-meta">{theme} theme</span>
      </div>

      <Section name="logo — lockup 24px / floor <20px / hero 40px">
        <div className="flex items-end gap-6">
          <Logo size={24} />
          <Logo size={18} />
          <Logo size={40} />
        </div>
      </Section>

      <Section name="swipe buttons — ink / amber / compact / disabled">
        <SwipeButton gesture="shake" variant="ink">
          I can ask
        </SwipeButton>
        <SwipeButton gesture="cheer" variant="amber">
          I can help
        </SwipeButton>
        <SwipeButton gesture="raise" variant="ink">
          Raise it
        </SwipeButton>
        <div className="flex gap-3 items-center">
          <SwipeButton gesture="bow" variant="amber" compact className="flex-1">
            Yes — accept
          </SwipeButton>
          <QuietButton compact>Not quite</QuietButton>
        </div>
        <SwipeButton gesture="cheer" variant="ink" disabled>
          I can help
        </SwipeButton>
      </Section>

      <Section name="quiet button">
        <div className="flex gap-3">
          <QuietButton>Take out</QuietButton>
          <QuietButton disabled>Take out</QuietButton>
        </div>
      </Section>

      <Section name="amount chips">
        <ChipRow
          options={[
            { key: "25", label: usd.format(25) },
            { key: "50", label: usd.format(50) },
            { key: "148", label: usd.format(148) },
            { key: "custom", label: "your call", dashed: true },
          ]}
          selectedKey={amount}
          onSelect={setAmount}
        />
      </Section>

      <Section name="pot bar — lg 12px / md 10px / sm 8px">
        <PotBar progress={0.78} size="lg" label="148 in the pot" />
        <PotBar progress={0.78} size="md" />
        <PotBar progress={0.78} size="sm" />
      </Section>

      <Section name="chain rail">
        <ChainRail nodes={["maya", "ben", "ana", "nino"]} youLabel="YOU" />
        <ChainRail nodes={["0x71c7…976f"]} youLabel="YOU" />
      </Section>

      <Section name="receipt table">
        <ReceiptTable
          caption="Settlement receipt"
          rows={[
            {
              key: "dana",
              label: (
                <>
                  DANA · SOLVED <Emoji>🙌</Emoji>
                </>
              ),
              amount: usdCents.format(105),
              highlight: true,
            },
            {
              key: "nino",
              label: (
                <>
                  NINO · PASSED <Emoji>🤝</Emoji>
                </>
              ),
              amount: usdCents.format(16),
            },
            {
              key: "ana",
              label: (
                <>
                  ANA · PASSED <Emoji>🤝</Emoji>
                </>
              ),
              amount: usdCents.format(14),
            },
            { key: "charity", label: "CHARITY · 1%", amount: usdCents.format(1.48) },
          ]}
          total={{ label: "FOUR PEOPLE BETTER OFF", amount: usdCents.format(136.48) }}
        />
      </Section>

      <Section name="meta line / input / card">
        <p className="ah-meta">from maya · 3 hands so far · via nino</p>
        <textarea
          className="ah-input"
          rows={2}
          placeholder="What do you need? First line becomes the title."
        />
        <div className="ah-card p-4">
          <div className="flex items-center justify-between">
            <span
              className="flex items-center gap-2"
              style={{ fontSize: "var(--fs-card-title-sm)", fontWeight: 800, letterSpacing: "-0.015em" }}
            >
              <Emoji size={20}>✋</Emoji> Sublet in Yerevan, June
            </span>
            <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {usd.format(148)}
            </span>
          </div>
          <p className="mt-1.5 ah-meta" style={{ fontSize: "var(--fs-mono-xs)", letterSpacing: "var(--track-mono-sm)" }}>
            from maya · 3 hands so far
          </p>
        </div>
      </Section>
    </div>
  );
}
