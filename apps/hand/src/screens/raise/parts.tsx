import { useId, useState, type ReactNode } from "react";

import { clsx } from "../../lib/clsx";
import type { Mode } from "../../store/db";
import { t } from "../../i18n";
import { TID } from "../../testids";

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
        return (
          <button
            key={chip.key}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
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

/** A section of the compose surface: a mono-free human label, then its controls. */
export function Part({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("flex flex-col gap-3", className)}>
      <h2 className="ah-field__label m-0">{label}</h2>
      {children}
    </section>
  );
}

const MODES: Mode[] = ["unlisted", "public", "dark"];
const MODE_WORD: Record<Mode, string> = { public: "common.word.public", unlisted: "common.word.unlisted", dark: "common.word.dark" };

/** The three visibility cards, unlisted first (D-32); each says what the site gets and what a holder reads. */
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
              <span className="ah-label">{t(`raise.who.${each}.link`)}</span>
            </span>
          </label>
        </div>
      ))}
    </fieldset>
  );
}

/**
 * What a messenger's link preview would show for this mode: the title (and, public, the details)
 * with the money line for numbered addresses, the generic card for a dark one. The address line is
 * the shape the real one takes, cut short.
 */
export function Unfurl({ mode, host, title, content, money }: { mode: Mode; host: string; title: string; content: string; money: string }) {
  const dark = mode === "dark";
  const shown = title || t("raise.who.untitled");
  return (
    <div className="flex flex-col gap-2" data-testid={TID.raise.unfurl} data-mode={mode}>
      <span className="ah-meta">{t("raise.who.unfurl")}</span>
      <div className="flex flex-col gap-2 self-stretch rounded-[18px] rounded-bl-[6px] border-[length:var(--bw-hair)] border-[var(--ink-a15)] bg-[var(--ink-a035)] p-3 sm:max-w-[420px]">
        <span className="ah-meta ah-meta--exact break-all normal-case">
          {dark ? `${host}/#E…` : `${host}/31337/…?d=…#E…`}
        </span>
        <div className="ah-ogcard">
          <span className="ah-meta">{host}</span>
          <div className="ah-ogcard__title" style={{ color: !dark && !title ? "var(--ink-a70)" : undefined }}>
            {dark ? t("raise.who.generic") : shown}
          </div>
          {mode === "public" && content ? <div className="ah-ogcard__desc">{content}</div> : null}
          {!dark ? <div className="ah-ogcard__foot ah-meta">{money}</div> : null}
        </div>
      </div>
    </div>
  );
}

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
