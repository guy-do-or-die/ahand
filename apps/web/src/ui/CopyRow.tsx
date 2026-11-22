import { useEffect, useState } from "react";

import { clsx } from "../lib/clsx";
import { TID } from "../testids";
import { useWords } from "./words";

export interface CopyRowProps {
  /** What goes to the clipboard, exactly. A link is handed in from memory by the caller. */
  value: string;
  /** What the row shows; by default the value, cut at the row's edge. */
  display?: string;
  /** The dashed row of the mocks ("take this with you"); a solid frame otherwise. */
  dashed?: boolean;
  onCopied?: () => void;
  className?: string;
  /**
   * Whether the value is a link, which gets the full-width "Copy link" and "Share" buttons with
   * the row under them as the text itself. By default, a value that starts with http(s)://.
   */
  link?: boolean;
  /** What "Share" hands to the system's share sheet; by default the value itself. */
  shareText?: string;
}

/**
 * A row that copies its value when pressed. The value is never logged and never leaves the
 * page except through the clipboard (or the system's share sheet, when the person presses
 * Share). Where the clipboard is closed, the row says so and the text can be selected by hand.
 *
 * A link is what a done screen is for: it gets a full-width ink "Copy link", "Share"
 * where the browser can share, and the dashed row under them shows the link itself, to read
 * or to select by hand. Any other value (a command, a code) is the row alone, as before.
 */
export function CopyRow({ value, display, dashed = true, onCopied, className, link, shareText }: CopyRowProps) {
  const words = useWords();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const isLink = link ?? /^https?:\/\//i.test(value);
  const canShare = isLink && typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      onCopied?.();
    } catch {
      setState("failed");
    }
  };

  const failed =
    state === "failed" ? (
      <p className="ah-label" role="status">
        {words.copy.failed}
      </p>
    ) : null;

  if (!isLink) {
    return (
      <div className="ah-stack" data-testid={TID.kit.copyRow}>
        <button type="button" onClick={copy} className={clsx("ah-linkrow", dashed && "ah-linkrow--dashed", className)} data-testid={TID.kit.copyButton}>
          <span className="ah-linkrow__value ah-exact">{display ?? value}</span>
          <span className="ah-linkrow__action" aria-live="polite">
            {state === "copied" ? words.copy.copied : words.copy.copy}
          </span>
        </button>
        {failed}
      </div>
    );
  }

  return (
    <div className="ah-stack ah-copyrow" data-testid={TID.kit.copyRow}>
      <button type="button" onClick={copy} className="ah-copy" data-testid={TID.kit.copyButton} data-state={state}>
        <span aria-live="polite">{state === "copied" ? words.copy.copied : words.copy.link}</span>
      </button>
      {canShare ? (
        <button
          type="button"
          className="ah-quiet ah-copyrow__share"
          data-testid={TID.kit.shareButton}
          onClick={() => void navigator.share({ text: shareText ?? value }).catch(() => undefined)}
        >
          {words.copy.share}
        </button>
      ) : null}
      <div className={clsx("ah-linkrow ah-linkrow--field", dashed && "ah-linkrow--dashed", className)}>
        <span className="ah-linkrow__value ah-exact">{display ?? value}</span>
      </div>
      {failed}
    </div>
  );
}
