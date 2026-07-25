import { useEffect, useState } from "react";
import { t } from "../i18n";

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Session theme override. The app follows the device appearance by default
 * (prefers-color-scheme); this flips it for the session by setting
 * `data-theme` on <html>. No persistence — the stateless rule forbids
 * storage, so a hard reload returns to the device preference. The override
 * survives client-side navigation, so one control covers the whole session.
 *
 * A CSS half-disc (the universal contrast glyph) rather than a sun/moon
 * emoji — emoji are reserved for the brand gestures in this system.
 */
export function ThemeToggle({ className, label = false }: { className?: string; label?: boolean }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => setTheme(currentTheme()), []);

  const flip = () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={t("Switch theme")}
      title={t("Switch theme")}
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
        color: label ? "var(--ink-a60)" : "var(--ink)",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true" style={{ transform: theme === "dark" ? "rotate(180deg)" : "none" }}>
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 2.5 A7.5 7.5 0 0 1 10 17.5 Z" fill="currentColor" />
      </svg>
      {label && (
        <span
          style={{
            fontFamily: "var(--font-meta)",
            fontSize: "var(--fs-mono-xs)",
            letterSpacing: "var(--track-mono)",
            textTransform: "uppercase",
          }}
        >
          {theme === "dark" ? t("dark") : t("light")}
        </span>
      )}
    </button>
  );
}
