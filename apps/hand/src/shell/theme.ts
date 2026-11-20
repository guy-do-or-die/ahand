import { setPref, type Prefs } from "../store/db";

/**
 * The theme follows the device; a switch overrides it on this device (D-55). The override is kept
 * in `prefs` and applied as `data-theme` on <html> before the first render (main.tsx waits for
 * the prefs). The kit's ThemeToggle sets `data-theme` itself; `rememberTheme` keeps its choice.
 */

export type Theme = NonNullable<Prefs["theme"]>;

/** Applies the theme this device chose, or leaves the device's own in charge. */
export function applyTheme(theme: Theme | undefined): void {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** Applies a theme and remembers it on this device. */
export function rememberTheme(theme: Theme): void {
  applyTheme(theme);
  void setPref("theme", theme).catch(() => undefined);
}

/**
 * Keeps whatever sets `data-theme` on <html> (the kit's ThemeToggle) in `prefs`, so the choice
 * survives a reload without any other storage.
 */
export function watchTheme(): () => void {
  const root = document.documentElement;
  const observer = new MutationObserver(() => {
    const theme = root.dataset.theme;
    if (theme === "light" || theme === "dark") void setPref("theme", theme).catch(() => undefined);
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
