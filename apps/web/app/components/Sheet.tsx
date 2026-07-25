import { useEffect, type ReactNode } from "react";
import { Emoji } from "./Emoji";
import { t } from "../i18n";

export interface SheetProps {
  /** Top-bar label, e.g. "pass it on". */
  label: string;
  /** Optional — omit when the sheet's CTA already carries the gesture
   *  (one big gesture emoji per layer). */
  labelEmoji?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Flow container: full-screen page on mobile (mock 05/06), 560px modal over
 * a scrim on desktop (mock 14/15). Esc closes.
 */
export function Sheet({ label, labelEmoji, onClose, children }: SheetProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Editing? First Esc just leaves the field — native-dialog manners.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        el.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="ah-sheet" role="dialog" aria-modal="true" aria-label={label}>
      <div className="ah-sheet__panel">
        <div className="flex items-center justify-between">
          <span className="ah-label flex items-center gap-2">
            {labelEmoji ? <Emoji size={16}>{labelEmoji}</Emoji> : null}
            {label}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="flex items-center justify-center w-11 h-11 -mr-2 text-[22px] text-ink/50 bg-transparent border-0 cursor-pointer"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
