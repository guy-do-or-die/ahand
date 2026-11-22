import { useId, useRef, useState, type FormEvent } from "react";

import { t, useLang } from "../../i18n";
import { navigate } from "../../router";
import { remember } from "../../store/memory";
import { TID } from "../../testids";
import { ErrorBand, GestureEmoji, SwipeButton, useLens, type GestureKind } from "../../ui";
import { readPaste, type Paste } from "./paste";
import "./landing.css";

/**
 * The landing `/`: what this is in one breath, then the three ways in: raise a
 * hand, come back to your own hands, or open a link someone sent. Each of the three gestures
 * turns over to Core's own function, so the plain sentence and the exact call are one object.
 * A newcomer has no link yet, so the paste box comes after the gestures, as one
 * quiet row. A pasted link is held in this tab's memory only and opened by the Hand view.
 */

type Gesture = "raise" | "pass" | "thank";

/** Each card's emoji and its motion: ✋ rises, 🤝 shakes, 🙏 bows. */
const KIND: Record<Gesture, GestureKind> = { raise: "raise", pass: "shake", thank: "bow" };

/** Core's own names, never translated: the call each gesture ends in. */
const CORE_WORDS: Record<Gesture, string[]> = {
  raise: ["raise(token, reward, expiry, rootKey, payoutGasK, minClaimBps, dataHash)", "  → handId"],
  pass: ["Shake { nextKey, payee, claimBps, nextClaimBps, dataHash }", "checkRoute(handId, signedShakes)", "  → (lastKey, claimBps, routeHash)"],
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
          <GestureEmoji kind={KIND[gesture]} className="lp-flip__emoji" />
          <span className="text-[length:var(--fs-card-title)] font-extrabold leading-[1.15] tracking-[-0.015em]">{t(`landing.${gesture}.say`)}</span>
        </div>
      </li>
    );
  }
  return (
    <li className="lp-flip" data-open={open} data-testid={TID.landing.gesture} data-value={gesture}>
      <button ref={front} type="button" className="lp-flip__face lp-flip__front" aria-expanded={open} aria-controls={backId} onClick={() => turn(!open)}>
        <GestureEmoji kind={KIND[gesture]} className="lp-flip__emoji" />
        <span className="text-[length:var(--fs-card-title)] font-extrabold leading-[1.15] tracking-[-0.015em]">{t(`landing.${gesture}.say`)}</span>
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
  const inputId = useId();
  const hintId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const paste = readPaste(text, window.location.origin);
    if (paste.kind === "empty" || paste.kind === "bad") return setSaid({ kind: paste.kind });
    if ((paste.kind === "address" || paste.kind === "public") && paste.foreign) return setSaid({ kind: "foreign", paste });
    openPaste(paste);
  };
  return (
    <section className="lp-paste flex flex-col gap-2" aria-label={t("landing.open.title")}>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" noValidate>
        <label htmlFor={inputId} className="lp-paste__label">
          {t("landing.open.title")}
        </label>
        <input
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
        <div className="flex flex-col gap-3 border-t-[1.5px] border-[color:var(--ink)] pt-3" data-testid={TID.landing.otherSite} role="status">
          <p className="m-0 text-[length:var(--fs-body-lg)] font-semibold leading-snug">{t("landing.open.otherSite", { host: said.paste.host })}</p>
          <button
            type="button"
            onClick={() => openPaste(said.paste)}
            className="inline-flex min-h-[48px] items-center justify-center self-start rounded-[var(--r-btn)] border-[1.5px] border-[color:var(--ink)] bg-[color:var(--amber)] px-5 font-bold text-[color:var(--on-amber)]"
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
    <section className="mx-auto flex w-full max-w-[1040px] flex-col gap-10 px-6 pb-14 pt-8 md:px-10 md:pt-14" data-screen="landing">
      <header className="flex flex-col gap-5 md:max-w-[760px]">
        <GestureEmoji kind="raise" className="text-[64px] md:text-[84px]" />
        <Hero />
        <p className="m-0 max-w-[620px] text-[length:var(--fs-body-xl)] leading-[1.45]">{t("landing.lead")}</p>
      </header>

      <div className="flex flex-col gap-5 sm:max-w-[420px]">
        <SwipeButton gesture="raise" className="ah-swipe--hero w-full" data-testid={TID.landing.raise} onClick={() => navigate("/raise")}>
          {t("landing.raise")}
        </SwipeButton>
        <div className="flex flex-wrap gap-3">
          <a href="/my" data-testid={TID.landing.my} className="ah-quiet no-underline">
            {t("landing.my")}
          </a>
          <a href="/without-us" data-testid={TID.landing.withoutUs} className="ah-quiet no-underline">
            {t("landing.withoutUs")}
          </a>
        </div>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="landing-how">
        <h2 id="landing-how" className="m-0 text-[length:var(--fs-card-title-lg)] font-extrabold leading-[1.1] tracking-[-0.02em]">
          {t("landing.how")}
        </h2>
        <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          <GestureCard gesture="raise" />
          <GestureCard gesture="pass" />
          <GestureCard gesture="thank" />
        </ol>
        <p className="m-0 text-[length:var(--fs-body-md)]">{t("landing.honest")}</p>
      </section>

      <div className="max-w-[720px]">
        <OpenLink />
      </div>
    </section>
  );
}
