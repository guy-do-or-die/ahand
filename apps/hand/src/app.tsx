import { useEffect, useRef } from "react";

import { useLang } from "./i18n";
import { interceptLinks, usePlace } from "./router";
import { resolve } from "./routes";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { NotFound } from "./shell/NotFound";
import { Shell } from "./shell/Shell";

/**
 * The app: where this tab is, which screen that is, inside the shell. The language is read here
 * so a switch re-renders every screen in place, without remounting them (a half-filled form
 * keeps its contents). Each move gets a fresh error boundary.
 */
export function App() {
  const place = usePlace();
  const lang = useLang();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => (root.current ? interceptLinks(root.current) : undefined), []);

  const { route, params } = resolve(place);
  const Screen = route?.screen;
  const view = place.state?.view ?? "";

  return (
    <div ref={root} data-lang={lang} className="contents">
      <Shell path={place.path}>
        <ErrorBoundary key={`${place.path}${place.search}|${view}`}>{Screen ? <Screen params={params} /> : <NotFound />}</ErrorBoundary>
      </Shell>
    </div>
  );
}
