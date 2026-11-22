import { useSyncExternalStore } from "react";

import { currentTheme, setTheme, subscribeTheme, type Theme } from "../design/theme";
import { useWords } from "./words";

/**
 * The footer's theme switch. The page follows the device until this is used. It sets the
 * choice on <html>; the shell keeps it on this device (design/theme.ts says why).
 *
 * A half-filled disc, the usual contrast glyph, and not a sun or a moon: emoji are kept for
 * the brand's gestures.
 *
 * It shows the theme on <html>, not one of its own: the person sheet has a second switch, and
 * each follows whichever was pressed.
 */
export function ThemeToggle({ className, label = false }: { className?: string; label?: boolean }) {
  const words = useWords();
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme);

  const flip = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={flip}
      // With its word shown, the name starts with that word, so what is seen is what is heard.
      aria-label={label ? `${theme === "dark" ? words.theme.dark : words.theme.light}: ${words.theme.switch}` : words.theme.switch}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: label ? 8 : 0,
        minWidth: 44,
        height: 44,
        padding: label ? "0 4px" : 0,
        background: "none",
        border: 0,
        cursor: "pointer",
        color: label ? "var(--ink-quiet)" : "var(--ink)",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" style={{ transform: theme === "dark" ? "rotate(180deg)" : "none" }}>
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2.5 A7.5 7.5 0 0 1 10 17.5 Z" fill="currentColor" />
      </svg>
      {label ? (
        <span className="ah-label" style={{ color: "inherit" }}>
          {theme === "dark" ? words.theme.dark : words.theme.light}
        </span>
      ) : null}
    </button>
  );
}
