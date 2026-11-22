/**
 * The theme follows the device until someone chooses one; a choice is the `data-theme`
 * attribute on <html> (tokens.css re-computes every colour under it). The kit only sets the
 * attribute. Keeping the choice on this device is the shell's work: it watches the attribute
 * and writes it to its preferences (shell/theme.ts), so there is one store and not two.
 */
export type Theme = "light" | "dark";

/** The theme on screen now: the chosen one, else the device's. */
export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
