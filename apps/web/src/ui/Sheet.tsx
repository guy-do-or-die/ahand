import { useEffect, useRef, type ReactNode } from "react";

import { clsx } from "../lib/clsx";
import { Emoji } from "./Emoji";
import { useWords } from "./words";

export interface SheetProps {
  /** The line at the top, which is also the dialog's name. */
  label: string;
  /** Leave it out when the sheet's own action already carries the gesture: one per layer. */
  labelEmoji?: string;
  /** A fixed-height panel on desktop, for content that scrolls inside (a thread). */
  tall?: boolean;
  /** More controls in the top bar, before the close button. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A layer for one task: a full screen on phones, a 560px modal over a scrim from 768px.
 * It is a native <dialog> opened as a modal, so the browser keeps focus inside it, returns
 * focus to where it was, and closes it on Escape; a click on the scrim closes it too.
 */
export function Sheet({ label, labelEmoji, tall = false, actions, onClose, children }: SheetProps) {
  const words = useWords();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="ah-sheet"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={clsx("ah-sheet__panel", tall && "ah-sheet__panel--tall")}>
        <div className="flex items-center justify-between">
          <span className="ah-label flex items-center gap-2">
            {labelEmoji ? <Emoji size={16}>{labelEmoji}</Emoji> : null}
            {label}
          </span>
          <span className="flex items-center gap-0.5">
            {actions}
            <button type="button" onClick={onClose} aria-label={words.close} className="ah-sheet__close">
              ×
            </button>
          </span>
        </div>
        {children}
      </div>
    </dialog>
  );
}
