import { costOf } from "@ahand/sdk";
import { useState, type ReactNode } from "react";

import { config } from "../config";
import {
  AddressInput,
  ChainRail,
  ChipRow,
  CopyRow,
  CostLine,
  DealCard,
  Disclose,
  Emoji,
  ErrorBand,
  Identity,
  LandPicker,
  LandSheet,
  Logo,
  Mark,
  MetaLine,
  MoneyInput,
  Qr,
  QuietButton,
  ReceiptTable,
  RewardBar,
  Sheet,
  SwipeButton,
  ThemeToggle,
  TxRail,
  money,
  useLang,
  type AddressReading,
  type Landing,
  type MoneyReading,
} from "../ui";
import {
  ASKER,
  BLOCK,
  DECIMALS,
  EXPIRY,
  HAND_NOUN,
  HAND_WORDS,
  HELPER,
  HOLDER_A,
  HOLDER_B,
  HOSTILE_WORDS,
  LONG_ROUTE,
  PAYEE_CTX,
  REFUNDED_AT,
  REFUND_ROWS,
  SHORT_ROUTE,
  THANKED_AT,
  THANKS_ONLY_ROWS,
  THANK_LANDED,
  THANK_ROWS,
  addressOf,
  dollars,
} from "./fixtures";
import { TwistGallery } from "./twist";

/**
 * Every component of the kit with sample data. The names of sections and
 * cases are the workbench's own labels, in English; everything inside a component speaks the
 * panel's language.
 */

/** The sample words that a screen would bring: its own sentences, in the panel's language. */
const SAY = {
  en: {
    raise: "Raise a hand",
    pass: "Pass it on",
    help: "I can help",
    thank: "Say thanks",
    compact: "Make my link",
    off: "Send my answer",
    quiet: "Look for a newer hand by this asker",
    quietSmall: "Show QR",
    quietText: "Do it without us",
    chips: "The reward",
    yourCall: "your call",
    days: "Open for",
    bar: "At least $28 of the $40 reward",
    meta: "Send it to people who might know someone · Passing it on is free for them",
    gestures: ["raise a hand", "pass it on", "help", "thank"],
    discloseSentence: "This link pays 0x7099…79C8 2% if its route is thanked.",
    discloseLabel: "how this is known",
    markSource: "read back from the written link",
    moneyLabel: "How much is the reward?",
    moneyHint: "Zero is fine: a hand can ask for a thank-you only.",
    addressLabel: "Where should the money land?",
    errorWhat: "Can't reach the network right now.",
    errorKept: "Nothing was sent.",
    refusedWhat: "This hand is already closed.",
    refusedKept: "Nothing was sent.",
    again: "Try again",
    sheetLabel: "Pass it on",
    sheetOpen: "Open the sheet",
    sheetBody: "Keep a little for yourself, or pass it all on.",
    landOpen: "Open it as a sheet",
    identityName: "ani.eth",
    connectAsked: "The screen was asked to connect",
  },
  ru: {
    raise: "Поднять руку",
    pass: "Передать дальше",
    help: "Могу помочь",
    thank: "Сказать спасибо",
    compact: "Сделать мою ссылку",
    off: "Отправить ответ",
    quiet: "Поискать новую руку этого автора",
    quietSmall: "Показать QR",
    quietText: "Сделать без нас",
    chips: "Награда",
    yourCall: "сколько решишь",
    days: "Открыта",
    bar: "Минимум $28 из награды $40",
    meta: "Отправь тем, кто может знать нужного человека · Передать дальше — бесплатно",
    gestures: ["поднять руку", "передать дальше", "помочь", "поблагодарить"],
    discloseSentence: "Эта ссылка платит 0x7099…79C8 2%, если за её путь поблагодарят.",
    discloseLabel: "откуда это известно",
    markSource: "прочитано из записанной ссылки",
    moneyLabel: "Какая награда?",
    moneyHint: "Можно и ноль: рука может просить только спасибо.",
    addressLabel: "Куда придут деньги?",
    errorWhat: "Сеть сейчас недоступна.",
    errorKept: "Ничего не отправлено.",
    refusedWhat: "Эта рука уже закрыта.",
    refusedKept: "Ничего не отправлено.",
    again: "Попробовать ещё раз",
    sheetLabel: "Передать дальше",
    sheetOpen: "Открыть лист",
    sheetBody: "Оставь себе чуть-чуть — или передай всё дальше.",
    landOpen: "Открыть как лист",
    identityName: "ani.eth",
    connectAsked: "Экран попросили подключить",
  },
} as const;

function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="g-section" data-kit={name}>
      <h2 className="ah-meta ah-meta--ink g-section__name">{name}</h2>
      {children}
    </section>
  );
}

function Case({ name, children, id }: { name: string; children: ReactNode; id?: string }) {
  return (
    <div className="g-case" data-case={id}>
      <span className="ah-meta">{name}</span>
      {children}
    </div>
  );
}

function ChipsCase() {
  const lang = useLang();
  const say = SAY[lang];
  const [amount, setAmount] = useState("40");
  const [days, setDays] = useState("30");
  return (
    <>
      <ChipRow
        label={say.chips}
        selectedKey={amount}
        onSelect={setAmount}
        options={[
          { key: "20", label: money(dollars(20), DECIMALS, lang) },
          { key: "40", label: money(dollars(40), DECIMALS, lang) },
          { key: "100", label: money(dollars(100), DECIMALS, lang) },
          { key: "own", label: say.yourCall, dashed: true },
        ]}
      />
      <ChipRow
        label={say.days}
        desktop
        selectedKey={days}
        onSelect={setDays}
        options={["7", "30", "90", "180"].map((key) => ({ key, label: key }))}
      />
    </>
  );
}

function MoneyCase() {
  const say = SAY[useLang()];
  const [reading, setReading] = useState<MoneyReading>({ status: "ok", amount: dollars(40) });
  return (
    <div className="ah-stack" data-reading={reading.status} data-amount={"amount" in reading ? reading.amount.toString() : undefined}>
      <MoneyInput label={say.moneyLabel} decimals={DECIMALS} initial={dollars(40)} max={dollars(1000)} hint={say.moneyHint} onReading={setReading} />
      <span className="ah-meta" data-testid="money-read">
        {reading.status}
        {"amount" in reading ? ` · ${reading.amount.toString()}` : ""}
      </span>
    </div>
  );
}

function AddressCase() {
  const say = SAY[useLang()];
  const [reading, setReading] = useState<AddressReading>({ status: "empty" });
  return (
    <div className="ah-stack">
      <AddressInput label={say.addressLabel} ctx={PAYEE_CTX} onReading={setReading} />
      <span className="ah-meta" data-testid="address-read">
        payeeProblem · {reading.status}
        {"problem" in reading ? ` · ${reading.problem}` : ""}
      </span>
    </div>
  );
}

function LandingReadout({ landing }: { landing: Landing | undefined }) {
  return (
    <span className="ah-meta ah-meta--exact" data-testid="land-read">
      {landing ? `${landing.choice} · payee ${landing.payee} · confirmed by ${landing.signing.kind}${landing.flagged ? ` · flagged ${landing.flagged}` : ""}` : "not chosen yet"}
    </span>
  );
}

function LandCase({ connected }: { connected: boolean }) {
  const say = SAY[useLang()];
  const [landing, setLanding] = useState<Landing>();
  const [asked, setAsked] = useState(0);
  return (
    <div className="ah-stack">
      <LandPicker purpose="give" account={connected ? HOLDER_A : undefined} onConnect={() => setAsked(asked + 1)} ctx={PAYEE_CTX} onChange={setLanding} />
      <LandingReadout landing={landing} />
      {asked > 0 ? (
        <span className="ah-label" data-testid="land-connect-asked">
          {say.connectAsked} ({asked})
        </span>
      ) : null}
    </div>
  );
}

function LandSheetCase() {
  const say = SAY[useLang()];
  const [open, setOpen] = useState(false);
  const [landing, setLanding] = useState<Landing>();
  return (
    <div className="ah-stack">
      <QuietButton compact onClick={() => setOpen(true)} data-testid="land-sheet-open">
        {say.landOpen}
      </QuietButton>
      <LandingReadout landing={landing} />
      {open ? (
        <LandSheet
          purpose="share"
          onConnect={() => undefined}
          ctx={PAYEE_CTX}
          onClose={() => setOpen(false)}
          onDone={(next) => {
            setLanding(next);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function SheetCase() {
  const say = SAY[useLang()];
  const [open, setOpen] = useState(false);
  return (
    <>
      <QuietButton compact onClick={() => setOpen(true)} data-testid="sheet-open" className="self-start">
        {say.sheetOpen}
      </QuietButton>
      {open ? (
        <Sheet label={say.sheetLabel} labelEmoji="🤝" onClose={() => setOpen(false)}>
          <div className="mt-6 flex flex-1 flex-col gap-6">
            <p className="m-0 text-[28px] leading-[1.08] font-extrabold tracking-[-0.025em]">{say.sheetBody}</p>
            <div className="mt-auto">
              <SwipeButton gesture="shake" className="w-full" onClick={() => setOpen(false)}>
                {say.compact}
              </SwipeButton>
            </div>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}

export function Kit() {
  const lang = useLang();
  const say = SAY[lang];
  const hand = HAND_WORDS[lang];
  const described = { status: "attached", title: hand.title, content: hand.content } as const;
  const deal = { decimals: DECIMALS, expiry: EXPIRY, raiser: ASKER, handId: 12n, block: BLOCK, timeZone: "UTC" } as const;
  const gas = 182_000n;

  return (
    <div className="g-sections">
      <Section name="Logo">
        <div className="g-row">
          <Logo size={40} />
          <Logo size={26} />
          <Logo size={11} />
        </div>
      </Section>

      <Section name="DealCard">
        <Case name="open · the viewer holds 70%" id="open">
          <DealCard {...deal} state="open" description={described} reward={dollars(40)} claimBps={7000} />
        </Case>
        <Case name="open · no reward" id="no-reward">
          <DealCard {...deal} state="open" description={described} reward={0n} claimBps={7000} />
        </Case>
        <Case name="open · the description did not arrive" id="lost">
          <DealCard {...deal} state="open" description={{ status: "lost" }} reward={dollars(40)} claimBps={7000} />
        </Case>
        <Case name="expired: time is up, still open on chain" id="expired">
          <DealCard {...deal} state="expired" description={described} reward={dollars(40)} claimBps={7000} />
        </Case>
        <Case name="thanked, with its receipt" id="thanked">
          <DealCard {...deal} state="thanked" closedAt={THANKED_AT} description={described} reward={dollars(40)}>
            <ReceiptTable rows={THANK_ROWS} decimals={DECIMALS} />
          </DealCard>
        </Case>
        <Case name="refunded" id="refunded">
          <DealCard {...deal} state="refunded" closedAt={REFUNDED_AT} description={described} reward={dollars(40)} />
        </Case>
        <Case name="no block yet: dates only, nothing claimed" id="no-clock">
          <DealCard {...deal} block={undefined} state={undefined} description={described} reward={dollars(40)} claimBps={7000} />
        </Case>
        <Case name="the public view: no place on a route, a proved name, a title that is no question" id="public">
          <DealCard {...deal} state="open" description={{ status: "attached", title: HAND_NOUN[lang] }} reward={dollars(1234.5)} raiserName={say.identityName} />
        </Case>
        <Case name="a reader in Tbilisi (UTC+4): a date opens in their zone, then in UTC" id="zone">
          <DealCard {...deal} timeZone="Asia/Tbilisi" state="open" description={described} reward={dollars(40)} claimBps={7000} />
        </Case>
        <Case name="the asker's own card (/my, /care, /thank): the floor they set, rows about whoever helps" id="asker">
          <DealCard {...deal} viewer="asker" state="open" description={described} reward={dollars(50)} claimBps={7000} />
        </Case>
        <Case name="a preview, before the hand is on the chain: no number, so no source to open" id="preview">
          <DealCard {...deal} handId={undefined} state="open" description={described} reward={dollars(40)} />
        </Case>
        <Case name="the words promise $5,000; the reward on chain is $1" id="amount-flag">
          <DealCard {...deal} state="open" description={{ status: "attached", ...HOSTILE_WORDS.claim }} reward={dollars(1)} claimBps={9000} />
        </Case>
        <Case name="hostile words: a direction override, zero-width characters, look-alikes" id="hostile-words">
          <DealCard {...deal} state="open" description={{ status: "attached", ...HOSTILE_WORDS.tricks }} reward={dollars(1)} claimBps={9000} />
        </Case>
        <Case name="long words: clamped, the terms stay in view" id="long-words">
          <DealCard {...deal} state="open" description={{ status: "attached", ...HOSTILE_WORDS.long }} reward={dollars(1)} claimBps={9000} />
        </Case>
      </Section>

      <Section name="SwipeButton">
        <SwipeButton gesture="raise">{say.raise}</SwipeButton>
        <SwipeButton gesture="shake">{say.pass}</SwipeButton>
        <SwipeButton gesture="cheer" variant="amber">
          {say.help}
        </SwipeButton>
        <SwipeButton gesture="bow" variant="amber">
          {say.thank}
        </SwipeButton>
        <div className="g-row">
          <SwipeButton gesture="shake" compact>
            {say.compact}
          </SwipeButton>
          <SwipeButton gesture="cheer" variant="amber" compact disabled>
            {say.off}
          </SwipeButton>
        </div>
      </Section>

      <Section name="QuietButton">
        <QuietButton>{say.quiet}</QuietButton>
        <div className="g-row">
          <QuietButton compact>{say.quietSmall}</QuietButton>
          <QuietButton compact disabled>
            {say.quietSmall}
          </QuietButton>
          <QuietButton variant="text">{say.quietText}</QuietButton>
        </div>
      </Section>

      <Section name="ChipRow">
        <ChipsCase />
      </Section>

      <Section name="RewardBar">
        <RewardBar progress={0.7} label={say.bar} />
        <RewardBar progress={0.7} size="sm" label={say.bar} />
        <RewardBar progress={0.7} size="md" label={say.bar} />
        <RewardBar progress={0.7} size="lg" label={say.bar} />
      </Section>

      <Section name="ChainRail">
        <Case name="three hands, then you, then whoever is next">
          <ChainRail hands={SHORT_ROUTE} />
        </Case>
        <Case name="ten hands: the rail scrolls sideways">
          <ChainRail hands={LONG_ROUTE} />
        </Case>
        <Case name="a finished route: no viewer, the helper last">
          <ChainRail hands={[...SHORT_ROUTE, { role: "helper", address: HELPER }]} you={false} />
        </Case>
        <Case name="a pass that named the asker's own address is flagged on the hand" id="rail-asker">
          <ChainRail hands={[{ role: "asker", address: ASKER }, { role: "passer", address: ASKER, flag: "asker" }, { role: "helper", address: HELPER }]} you={false} next={false} />
        </Case>
        <Case name="a re-signed answer: the holder it left out is crossed out with its share" id="rail-dropped">
          <ChainRail hands={[{ role: "asker", address: ASKER }, { role: "passer", address: HOLDER_A }, { role: "passer", address: HOLDER_B, dropped: { share: "5%" } }, { role: "helper", address: HELPER }]} you={false} next={false} />
        </Case>
      </Section>

      <Section name="ReceiptTable">
        <Case name="a thank: one pass kept nothing, one payout waits">
          <ReceiptTable rows={THANK_ROWS} decimals={DECIMALS} />
        </Case>
        <Case name="landed: the first three rows read so far">
          <ReceiptTable rows={THANK_ROWS} landed={THANK_LANDED} decimals={DECIMALS} />
        </Case>
        <Case name="a refund">
          <ReceiptTable rows={REFUND_ROWS} decimals={DECIMALS} />
        </Case>
        <Case name="a thank with no reward" id="receipt-thanks-only">
          <ReceiptTable rows={THANKS_ONLY_ROWS} decimals={DECIMALS} />
        </Case>
      </Section>

      <Section name="Mark">
        <div className="g-row">
          <Mark kind="checked" />
          <Mark kind="chain" />
          <Mark kind="waiting" />
        </div>
        <Case name="each opens its source">
          <div className="g-row items-start">
            <Mark kind="checked" source={<span className="ah-meta">{say.markSource}</span>} />
            <Mark kind="chain" source={<span className="ah-meta ah-meta--exact">Thanked · block 1 234 · log 0</span>} />
            <Mark kind="waiting" source={<span className="ah-meta ah-meta--exact">pending(token, payee) = 1200000</span>} />
          </div>
        </Case>
      </Section>

      <Section name="Disclose">
        <p className="m-0 text-[15px] font-semibold">{say.discloseSentence}</p>
        <Disclose label={say.discloseLabel} summary="claimBps 7000 → 6800">
          <span className="ah-meta ah-meta--exact">margin = reward × (claimBps − nextClaimBps) / 10 000</span>
          <span className="ah-meta ah-meta--exact">40 × (7000 − 6800) / 10 000 = 0.8</span>
          <Mark kind="checked" />
        </Disclose>
      </Section>

      <Section name="TxRail">
        <Case name="in a block, on the local stand">
          <TxRail reached="in-block" local />
        </Case>
        <Case name="sent">
          <TxRail reached="sent" />
        </Case>
        <Case name="recorded on Ethereum">
          <TxRail reached="safe" />
        </Case>
        <Case name="final">
          <TxRail reached="final" />
        </Case>
      </Section>

      <Section name="MoneyInput">
        <MoneyCase />
      </Section>

      <Section name="AddressInput">
        <AddressCase />
      </Section>

      <Section name="LandSheet">
        <Case name="an account is connected: it is first, and chosen" id="land-connected">
          <LandCase connected />
        </Case>
        <Case name="no account: nothing is chosen for you" id="land-bare">
          <LandCase connected={false} />
        </Case>
        <Case name="as a sheet, for a share of a pass" id="land-sheet">
          <LandSheetCase />
        </Case>
      </Section>

      <Section name="Sheet">
        <SheetCase />
      </Section>

      <Section name="Identity">
        <div className="ah-stack">
          <Identity address={ASKER} />
          <Identity address={ASKER} name={say.identityName} />
          <Identity address={ASKER} full />
        </div>
      </Section>

      <Section name="Qr">
        <Case name="a 428-byte link: a dark hand's first link" id="qr-428">
          <Qr value={addressOf(428)} />
        </Case>
        <Case name="a 1 500-byte link: past version 25" id="qr-dense">
          <Qr value={addressOf(1500)} />
        </Case>
      </Section>

      <Section name="CostLine">
        <CostLine cost={costOf(gas, config.prices)} prices={config.prices} gas={gas} />
      </Section>

      <Section name="ErrorBand">
        <ErrorBand what={say.errorWhat} kept={say.errorKept} action={<QuietButton compact>{say.again}</QuietButton>} />
        <ErrorBand what={say.refusedWhat} kept={say.refusedKept} code="core.NotOpen" />
      </Section>

      <Section name="CopyRow">
        <Case name="a link: Copy link first, Share where the browser can, the link under them" id="copy-link">
          <CopyRow value={addressOf(60)} />
        </Case>
        <Case name="not a link: the row copies itself" id="copy-text">
          <CopyRow value={HOLDER_A} dashed={false} />
        </Case>
      </Section>

      <Section name="MetaLine">
        <MetaLine text={say.meta} />
        <MetaLine text={say.meta} dim />
      </Section>

      <Section name="Emoji">
        <div className="g-row">
          {["✋", "🤝", "🙌", "🙏"].map((gesture, index) => (
            <span key={gesture} className="inline-flex items-center gap-2 text-[15px] font-semibold">
              <Emoji size={28}>{gesture}</Emoji>
              {say.gestures[index]}
            </span>
          ))}
        </div>
      </Section>

      <Section name="ThemeToggle">
        <div className="g-row">
          <ThemeToggle label />
        </div>
      </Section>

      <TwistGallery />
    </div>
  );
}
