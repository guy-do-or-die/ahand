import { ThemeToggle } from "./ThemeToggle";

/**
 * Minimal global footer — the quiet home for the theme control (a set-once
 * preference doesn't belong in the primary nav). Brand mark left, theme
 * toggle right. Rendered once at the root so it's on every screen.
 */
export function GlobalFooter() {
  return (
    <footer
      className="flex items-center justify-between px-6 lg:px-10"
      style={{
        borderTop: "var(--bw-hair) solid var(--ink-a08)",
        paddingTop: 10,
        paddingBottom: "max(10px, env(safe-area-inset-bottom))",
      }}
    >
      <div />
      <ThemeToggle label className="-mr-1" />
    </footer>
  );
}
