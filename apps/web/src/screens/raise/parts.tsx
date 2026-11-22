import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { amountText, cardModelOf, day as cardDay, DOLLAR_KINDS, metaOf, type CardModel, type HandFacts, type Lang } from "@ahand/card";
import { Card, CARD_WIDTH } from "@ahand/card/Card";

import { config, PREVIEWS } from "../../config";
import type { TokenConfig } from "../../config/schema";
import { currentTheme, subscribeTheme } from "../../design/theme";
import { clsx } from "../../lib/clsx";
import type { Mode } from "../../store/db";
import { t, useLang } from "../../i18n";
import { TID } from "../../testids";
import { day } from "../../ui/format";

/**
 * Small pieces of the raise screen. `Chips` is the kit's chip row with a test id and a value on
 * each chip (the kit's ChipRow takes none); the rest are the visibility cards, the chat preview and
 * the plain disclosure that holds controls (the kit's Disclose holds evidence only).
 */

export interface Chip {
  key: string;
  label: string;
  dashed?: boolean;
}

export function Chips({ label, chips, selected, onSelect, testId }: { label: string; chips: Chip[]; selected: string; onSelect: (key: string) => void; testId: string }) {
  const move = (from: number, by: number, row: HTMLElement | null) => {
    const index = (from + by + chips.length) % chips.length;
    const next = chips[index];
    if (!next) return;
    onSelect(next.key);
    row?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
  };
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {chips.map((chip, index) => {
        const on = chip.key === selected;
        // With none chosen (the value was set another way) the first chip takes the keyboard.
        const reach = on || (index === 0 && !chips.some((each) => each.key === selected));
        return (
          <button
            key={chip.key}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={reach ? 0 : -1}
            data-testid={testId}
            data-value={chip.key}
            onClick={() => onSelect(chip.key)}
            onKeyDown={(event) => {
              const by = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
              if (!by) return;
              event.preventDefault();
              move(index, by, event.currentTarget.parentElement);
            }}
            className={clsx("ah-chip", on && "ah-chip--selected", chip.dashed && !on && "ah-chip--dashed")}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A section of the compose surface: a mono-free human label, then its controls. With an `id` it is
 * one of the screen's named sections: the strip at the top moves to it (ui/SectionStrip.tsx), so
 * it can take the focus and stops below the strip.
 */
export function Part({ id, label, children, className }: { id?: string; label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} className={clsx("flex flex-col gap-3", id && "ah-section", className)}>
      <h2 className="ah-field__label m-0">{label}</h2>
      {children}
    </section>
  );
}

const MODES: Mode[] = ["unlisted", "public", "dark"];
export const MODE_WORD: Record<Mode, string> = { public: "common.word.public", unlisted: "common.word.unlisted", dark: "common.word.dark" };

/**
 * The three visibility cards, unlisted first. The modes differ in two things. One is
 * whether the Hand may travel beyond the people the link is handed to: a public Hand's words are
 * all outside the link, so anyone may read, repost and list them, and choosing it is agreeing to
 * that (nothing in this build stores or lists public Hands; the card says what the asker allows,
 * not what the site does). The other is what stands open in the address itself (docs/links.md):
 * the title and the details, the title, or nothing, not even the Hand's number. Each card says
 * both in a line; what every mode shares is said once under them.
 */
export function Visibility({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  const name = useId();
  return (
    <fieldset className="ah-choices">
      <legend className="sr-only">{t("raise.who.label")}</legend>
      {MODES.map((each) => (
        <div key={each} className={clsx("ah-choice", mode === each && "ah-choice--on")}>
          <label className="ah-choice__head" data-testid={TID.raise.visibility} data-value={each}>
            <input type="radio" className="ah-choice__radio" name={name} value={each} checked={mode === each} onChange={() => onMode(each)} />
            <span className="flex flex-col gap-1">
              <span className="ah-choice__title">{t(MODE_WORD[each])}</span>
              <span className="ah-label">{t(`raise.who.${each}.site`)}</span>
            </span>
          </label>
        </div>
      ))}
    </fieldset>
  );
}

/**
 * What a messenger shows for this mode, drawn by the preview service's own code: the shared card
 * (packages/card) built from the draft as it is typed, scaled into the column, with the title and
 * description lines under it that the service gives a messenger. Nothing is fetched: before the
 * raise the Hand has no number, and the card never needed one. A hidden
 * Hand's address says nothing before `#`, so its preview is the card that names no Hand. The
 * address line is the shape the real one takes, cut short, on this build's chain. Where no server
 * writes previews (`PREVIEWS` false: a static test site) every link's preview is the site's own
 * name, and the block says so instead of promising a card it will not show.
 */
export function Unfurl({ mode, host, title, content, reward, decimals, token, expiry }: {
  mode: Mode;
  host: string;
  title: string;
  content: string;
  /** The reward in the token's smallest units; undefined until the amount is read. */
  reward: bigint | undefined;
  decimals: number;
  token: TokenConfig;
  /** The expiry, by the chain's clock; undefined while no block has arrived. */
  expiry: number | undefined;
}) {
  const lang = useLang() as Lang;
  const dark = useDarkTheme();
  const hidden = mode === "dark";
  const facts: HandFacts | undefined = hidden
    ? { kind: "generic" }
    : expiry === undefined || reward === undefined
      ? undefined
      : {
          kind: "hand",
          title: title || t("raise.who.untitled"),
          ...(mode === "public" && content ? { details: content } : {}),
          terms: {
            state: "open",
            ...(reward > 0n ? { amount: amountText(reward, { symbol: token.symbol, decimals, dollar: DOLLAR_KINDS.includes(token.kind) }, lang) } : {}),
            date: expiry,
          },
        };
  const meta = facts ? metaOf(facts, lang) : undefined;
  // The card writes its date in UTC (a preview robot has no zone); this screen writes the reader's.
  // Around midnight the two days differ, and the preview says which day it means.
  const utcDay = facts?.kind === "hand" && expiry !== undefined && day(expiry, lang) !== day(expiry, lang, "UTC") ? cardDay(expiry, lang) : undefined;
  return (
    <div className="flex flex-col gap-2" data-testid={TID.raise.unfurl} data-mode={mode} data-previews={PREVIEWS ? "true" : "false"}>
      <span className="ah-meta">{t("raise.who.unfurl")}</span>
      <div className="ah-unfurl">
        <span className="ah-meta ah-meta--exact break-all normal-case">{hidden ? `${host}/#E…` : `${host}/${config.chain.id}/…?d=…#E…`}</span>
        {!PREVIEWS ? (
          <div className="ah-unfurl__text">
            <span className="ah-unfurl__title">{SITE_NAME}</span>
          </div>
        ) : facts && meta ? (
          <>
            <CardPicture model={cardModelOf(facts, lang, dark)} alt={meta.imageAlt} />
            <div className="ah-unfurl__text">
              <span className="ah-meta">{host}</span>
              <span className="ah-unfurl__title" data-testid={TID.raise.unfurlTitle}>{meta.title}</span>
              <span className="ah-unfurl__desc">{meta.description}</span>
            </div>
          </>
        ) : (
          <p className="ah-note m-0">{t("common.time.offline")}</p>
        )}
      </div>
      <p className="ah-label m-0">{PREVIEWS ? t(`raise.who.unfurl.${mode}`) : t("raise.who.noPreviews")}</p>
      {PREVIEWS && utcDay ? <p className="ah-label m-0" data-testid={TID.raise.unfurlUtc}>{t("raise.who.utc", { date: utcDay })}</p> : null}
    </div>
  );
}

/** The card at its own 1200×630, scaled to the width it is given, as a chat scales the picture. */
function CardPicture({ model, alt }: { model: CardModel; alt: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setScale(element.clientWidth / CARD_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="ah-unfurl__image" role="img" aria-label={alt} data-testid={TID.raise.unfurlCard}>
      <div aria-hidden="true" style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <Card model={model} target="dom" family="var(--font-display)" marks={MARKS} />
      </div>
    </div>
  );
}

/** The lockup the header uses, the same files the service draws into its card. */
const MARKS = { light: "/ahand-mark-light.svg", dark: "/ahand-mark-dark.svg" };

/** Whether the page is in its dark theme now: the chosen one, else the device's (design/theme.ts). */
function useDarkTheme(): boolean {
  return useSyncExternalStore(subscribeTheme, () => currentTheme() === "dark", () => currentTheme() === "dark");
}

/** The site's own name: the title of index.html, all a preview shows where no server writes one. */
const SITE_NAME = "aHand";

/** A disclosure for controls: the kit's dashed mono toggle, its content in the page's own voice. */
export function Opens({ label, summary, children, testId }: { label: string; summary?: string; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col items-stretch gap-3">
      <button type="button" className="ah-disclose self-start" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} data-testid={testId}>
        <span className="ah-disclose__toggle">{label}</span>
        {summary ? <span className="ah-disclose__summary">{summary}</span> : null}
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div id={id} className="ah-panel flex flex-col gap-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
