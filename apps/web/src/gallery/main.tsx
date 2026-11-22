import "../design/index.css";
import "./gallery.css";

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { Theme } from "../design/theme";
import { Ambient, Logo, type Lang } from "../ui";
import { Kit } from "./kit";

/**
 * The kit's workbench: every component in light and dark, in English and Russian. It is its
 * own entry (gallery.html) and imports nothing from the shell.
 *
 *   /gallery.html                      both themes side by side, English
 *   /gallery.html?lang=ru              Russian
 *   /gallery.html?theme=dark           one theme at full width
 *   /gallery.html?lens=on              every disclosure open, as under the lens
 *
 * The switches in the bar write the same three parameters, so any view has an address.
 */

type Themes = "both" | Theme;

function read(): { lang: Lang; themes: Themes; lens: boolean } {
  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme");
  return {
    lang: params.get("lang") === "ru" ? "ru" : "en",
    themes: theme === "light" || theme === "dark" ? theme : "both",
    lens: params.get("lens") === "on",
  };
}

function Switch({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" className="g-switch" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function Gallery() {
  const [view, setView] = useState(read);

  useEffect(() => {
    document.documentElement.lang = view.lang;
    const params = new URLSearchParams();
    if (view.lang !== "en") params.set("lang", view.lang);
    if (view.themes !== "both") params.set("theme", view.themes);
    if (view.lens) params.set("lens", "on");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [view]);

  const themes: Theme[] = view.themes === "both" ? ["light", "dark"] : [view.themes];

  return (
    <div className="g-page">
      <header className="g-bar">
        <Logo size={22} />
        <h1 className="ah-meta ah-meta--ink m-0">The kit</h1>
        <div className="g-bar__group" role="group" aria-label="Language">
          {(["en", "ru"] as const).map((lang) => (
            <Switch key={lang} on={view.lang === lang} onClick={() => setView({ ...view, lang })}>
              {lang}
            </Switch>
          ))}
        </div>
        <div className="g-bar__group" role="group" aria-label="Theme">
          {(["both", "light", "dark"] as const).map((choice) => (
            <Switch key={choice} on={view.themes === choice} onClick={() => setView({ ...view, themes: choice })}>
              {choice}
            </Switch>
          ))}
        </div>
        <div className="g-bar__group">
          <Switch on={view.lens} onClick={() => setView({ ...view, lens: !view.lens })}>
            lens
          </Switch>
        </div>
      </header>
      <main className={`g-panels ${themes.length === 2 ? "g-panels--two" : "g-panels--one"}`}>
        {themes.map((theme) => (
          <div key={theme} className="g-panel" data-theme={theme} data-panel={theme}>
            <p className="ah-meta g-panel__name">
              {theme} · {view.lang}
              {view.lens ? " · lens" : ""}
            </p>
            <Ambient lang={view.lang} lens={view.lens}>
              <Kit />
            </Ambient>
          </div>
        ))}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
