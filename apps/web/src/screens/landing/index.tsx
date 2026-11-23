import { useId, useRef, useState, type FormEvent } from "react";

import { t, useLang } from "../../i18n";
import { navigate } from "../../router";
import { remember } from "../../store/memory";
import { TID } from "../../testids";
import { ErrorBand, GestureEmoji, SwipeButton, useLens, type GestureKind } from "../../ui";
import { readPaste, type Paste } from "./paste";
import { Sample } from "./Sample";
import "./landing.css";

/**
 * The landing `/`: what this is in one breath, the one way in a newcomer has
 * (raise a hand), and beside them a Hand as the person it reaches sees it, so the page shows the
 * thing and does not only describe it. Then the four gestures a Hand is made of, each with the
 * one thing a newcomer asks next. Each gesture turns over to Core's own
 * function, so the plain sentence and the exact call are one object. One's own hands
 * are a tap away on every screen (the header's button), and doing it without the site is in every
 * screen's footer, so neither is repeated here. Someone who holds a link opens it as any link;
 * the box to paste one is folded into one quiet line after the gestures, for where there is
 * no address bar to paste into. A pasted link is held in this tab's memory only and opened by the
 * Hand view.
 */

type Gesture = "raise" | "pass" | "help" | "thank";
const GESTURES: readonly Gesture[] = ["raise", "pass", "help", "thank"];

/** Each card's emoji and its motion: ✋ waves, 🤝 shakes, 🙌 cheers, 🙏 bows. */
const KIND: Record<Gesture, GestureKind> = { raise: "raise", pass: "shake", help: "cheer", thank: "bow" };

/** When each card's gesture moves in the five-second round: after the raise button's hand, one after another. */
const TURN: Record<Gesture, number> = { raise: 2.2, pass: 2.8, help: 3.4, thank: 4 };

/** Core's own names, never translated: the call each gesture ends in. */
const CORE_WORDS: Record<Gesture, string[]> = {
  raise: ["raise(token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash)", "  → handId"],
  pass: ["Shake { nextKey, payee, claimBps, nextClaimBps, dataHash }", "checkRoute(handId, signedShakes)", "  → (lastKey, claimBps, routeHash)"],
  help: ["Give { signer, payee, claimBps, routeHash, dataHash }", "checkGive(handId, signedShakes, signedGive)", "  → giveHash"],
  thank: ["thank(handId, signedShakes, signedGive, dataHash)", "refund(handId)"],
};

function GestureCard({ gesture }: { gesture: Gesture }) {
  const lens = useLens();
  const [own, setOwn] = useState<boolean>();
  const open = own ?? lens;
  const backId = useId();
  const front = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const turn = (to: boolean) => {
    setOwn(to);
    // The side that was pressed turns away; the hand that pressed it lands on the other side.
    requestAnimationFrame(() => (to ? back : front).current?.focus({ preventScroll: true }));
  };
  // Core's call on the back is proof: in the calm view the card is its sentence and does not turn.
  if (!lens) {
    return (
      <li className="lp-flip" data-open={false} data-testid={TID.landing.gesture} data-value={gesture}>
        <div className="lp-flip__face lp-flip__front">
          <GestureEmoji kind={KIND[gesture]} turn={TURN[gesture]} className="lp-flip__emoji" />
          <span className="text-[length:var(--fs-card-title)] font-extrabold leading-[1.15] tracking-[-0.015em]">{t(`landing.${gesture}.say`)}</span>
          <span className="lp-flip__more">{t(`landing.${gesture}.more`)}</span>
        </div>
      </li>
    );
  }
  return (
    <li className="lp-flip" data-open={open} data-testid={TID.landing.gesture} data-value={gesture}>
      <button ref={front} type="button" className="lp-flip__face lp-flip__front" aria-expanded={open} aria-controls={backId} onClick={() => turn(!open)}>
        <GestureEmoji kind={KIND[gesture]} turn={TURN[gesture]} className="lp-flip__emoji" />
        <span className="text-[length:var(--fs-card-title)] font-extrabold leading-[1.15] tracking-[-0.015em]">{t(`landing.${gesture}.say`)}</span>
        <span className="lp-flip__more">{t(`landing.${gesture}.more`)}</span>
        <span className="lp-flip__turn" aria-hidden="true">
          ↻ {t("landing.turn")}
        </span>
      </button>
      <div id={backId} className="lp-flip__face lp-flip__back" aria-hidden={!open}>
        <p className="ah-meta m-0">{t("landing.lens.back")}</p>
        <pre className="lp-flip__code">{CORE_WORDS[gesture].join("\n")}</pre>
        <p className="ah-label m-0">{t(`landing.lens.${gesture}`)}</p>
        <button ref={back} type="button" className="lp-flip__turn" tabIndex={open ? 0 : -1} onClick={() => turn(false)}>
          ↺ {t("landing.turnBack")}
        </button>
      </div>
    </li>
  );
}

/** The hero line, with the words the brand covers mark in amber. */
function Hero() {
  const [pre, marked, post] = t("landing.hero.line").split("*");
  return (
    <h1
      data-testid={TID.landing.hero}
      className="m-0 text-[length:var(--fs-title-m-lg)] font-extrabold leading-[1.12] tracking-[-0.035em] md:text-[length:var(--fs-hero)]"
    >
      <span className="block">{t("landing.hero.lead")}</span>
      <span className="block">
        {pre}
        <mark className="lp-mark">{marked}</mark>
        {post}
      </span>
    </h1>
  );
}

type Said = { kind: "empty" } | { kind: "bad" } | { kind: "foreign"; paste: Extract<Paste, { kind: "address" | "public" }> };

/** Holds what was pasted in this tab's memory and goes to the Hand view. */
function openPaste(paste: Paste): void {
  const site = window.location.origin;
  if (paste.kind === "link") {
    remember({ before: `${site}/`, fragment: paste.fragment, via: "paste" });
    navigate("/", { state: { view: "hand" } });
  } else if (paste.kind === "address") {
    remember({ before: paste.before, fragment: paste.fragment, via: "paste" });
    navigate(paste.to, paste.to === "/" ? { state: { view: "hand" } } : {});
  } else if (paste.kind === "public") {
    navigate(paste.to);
  }
}

function OpenLink() {
  const [text, setText] = useState("");
  const [said, setSaid] = useState<Said>();
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const paste = readPaste(text, window.location.origin);
    if (paste.kind === "empty" || paste.kind === "bad") return setSaid({ kind: paste.kind });
    if ((paste.kind === "address" || paste.kind === "public") && paste.foreign) return setSaid({ kind: "foreign", paste });
    openPaste(paste);
  };
  // Folded, the row is one question. Someone with a link in hand opens the box; nobody else meets it.
  if (!open) {
    return (
      <section className="lp-paste lp-paste--folded" aria-label={t("landing.open.title")}>
        <button
          type="button"
          className="lp-paste__ask"
          aria-expanded={false}
          data-testid={TID.landing.openAsk}
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          {t("landing.open.ask")}
        </button>
      </section>
    );
  }
  return (
    <section className="lp-paste flex flex-col gap-2" aria-label={t("landing.open.title")}>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" noValidate>
        <label htmlFor={inputId} className="lp-paste__label">
          {t("landing.open.title")}
        </label>
        <input
          ref={input}
          id={inputId}
          data-testid={TID.landing.openInput}
          className="ah-input min-h-[44px] min-w-0 flex-1 font-mono text-[length:var(--fs-mono-md)]"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setSaid(undefined);
          }}
          aria-describedby={hintId}
          aria-invalid={said?.kind === "bad" || said?.kind === "empty" ? true : undefined}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          placeholder="https://…/#…"
        />
        <button type="submit" data-testid={TID.landing.openSubmit} className="ah-quiet min-h-[44px] self-start sm:self-auto">
          {t("landing.open.go")}
        </button>
      </form>
      <p id={hintId} className="ah-label ah-label--dim m-0">
        {t("landing.open.hint")} {t("landing.open.tab")}
      </p>
      {said?.kind === "empty" ? <ErrorBand what={t("landing.open.empty")} /> : null}
      {said?.kind === "bad" ? <ErrorBand what={t("landing.open.bad")} code="LINK · MALFORMED" /> : null}
      {said?.kind === "foreign" ? (
        <div className="flex flex-col gap-3 border-t-[length:var(--bw-hair)] border-[color:var(--ink-a12)] pt-3" data-testid={TID.landing.otherSite} role="status">
          <p className="m-0 text-[length:var(--fs-body-lg)] font-semibold leading-snug">{t("landing.open.otherSite", { host: said.paste.host })}</p>
          <button
            type="button"
            onClick={() => openPaste(said.paste)}
            className="inline-flex min-h-[48px] items-center justify-center self-start rounded-[var(--r-btn)] border-0 bg-[color:var(--amber)] px-5 font-bold text-[color:var(--on-amber)]"
          >
            {t("landing.open.here")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export default function LandingScreen() {
  useLang(); // re-render on a language switch
  return (
    <section className="mx-auto flex w-full max-w-[1120px] flex-col gap-12 px-6 pb-14 pt-8 md:px-10 md:pt-14" data-screen="landing">
      {/* The raised hand stands on the button below and on the first gesture's card: a third one over the headline said nothing more. */}
      <div className="lp-hero">
        <div className="lp-hero__say flex flex-col gap-6">
          <header className="flex flex-col gap-5">
            <Hero />
            <p className="m-0 max-w-[560px] text-[length:var(--fs-body-xl)] leading-[1.45]">{t("landing.lead")}</p>
          </header>
          <div className="flex flex-col gap-3 sm:max-w-[420px]">
            <SwipeButton gesture="raise" className="w-full" data-testid={TID.landing.raise} aria-describedby="landing-raise-note" onClick={() => navigate("/raise")}>
              {t("landing.raise")}
            </SwipeButton>
            <p id="landing-raise-note" className="lp-hero__note m-0">
              {t("landing.raise.note")}
            </p>
          </div>
        </div>
        <Sample />
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="landing-how">
        <h2 id="landing-how" className="m-0 text-[length:var(--fs-card-title-lg)] font-extrabold leading-[1.1] tracking-[-0.02em]">
          {t("landing.how")}
        </h2>
        <ol className="lp-gestures m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {GESTURES.map((gesture) => (
            <GestureCard key={gesture} gesture={gesture} />
          ))}
        </ol>
        <p className="m-0 text-[length:var(--fs-body-md)]">{t("landing.honest")}</p>
      </section>

      <div className="max-w-[720px]">
        <OpenLink />
      </div>
    </section>
  );
}
