import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import { config } from "./config";
import { matchPath, type Params, type Place } from "./router";

/**
 * The one route table (ARCHITECTURE §7). Each screen is a lazy import of
 * screens/<name>/index.tsx and gets its params as a prop (or reads them with `usePlace`).
 * The fragment is never routed: a bare link on "/" shows the Hand view because link intake
 * marked that history entry with `view: "hand"`.
 */

/** What a screen receives from the router. */
export interface ScreenProps {
  params: Params;
}
export type Screen = ComponentType<ScreenProps>;

export interface Route {
  name: string;
  pattern: string;
  /** Each param's rule; a path that breaks one is not this route. */
  rules?: Record<string, RegExp>;
  screen: LazyExoticComponent<Screen>;
  /** Only in builds whose chain is local (the gallery, the dev wallet). */
  local?: boolean;
}

const CHAIN = /^[0-9]+$/;
const HAND = /^[0-9]+$/;
const CORE = /^0x[0-9a-fA-F]{40}$/;
const HAND_RULES = { chain: CHAIN, hand: HAND };
const CORE_RULES = { chain: CHAIN, core: CORE, hand: HAND };

const screen = (load: () => Promise<{ default: Screen }>) => lazy(load);

const landing = screen(() => import("./screens/landing/index.tsx"));
const hand = screen(() => import("./screens/hand/index.tsx"));
const proof = screen(() => import("./screens/proof/index.tsx"));
const my = screen(() => import("./screens/my/index.tsx"));

/**
 * Set by the build when it knows the chain is local (a `define` in vite.shared.ts), so a public
 * build drops the local-only screens; absent, the configuration decides at run time.
 */
declare const __AHAND_LOCAL__: boolean | undefined;
const LOCAL = typeof __AHAND_LOCAL__ === "boolean" ? __AHAND_LOCAL__ : config.chain.local;

export const ROUTES: readonly Route[] = [
  { name: "landing", pattern: "/", screen: landing },
  { name: "hand", pattern: "/:chain/:hand", rules: HAND_RULES, screen: hand },
  { name: "hand", pattern: "/:chain/:core/:hand", rules: CORE_RULES, screen: hand },
  { name: "proof", pattern: "/:chain/:hand/proof", rules: HAND_RULES, screen: proof },
  { name: "proof", pattern: "/:chain/:core/:hand/proof", rules: CORE_RULES, screen: proof },
  { name: "pass", pattern: "/pass", screen: screen(() => import("./screens/pass/index.tsx")) },
  { name: "give", pattern: "/give", screen: screen(() => import("./screens/give/index.tsx")) },
  { name: "raise", pattern: "/raise", screen: screen(() => import("./screens/raise/index.tsx")) },
  { name: "my", pattern: "/my", screen: my },
  { name: "my", pattern: "/my/:chain/:hand", rules: HAND_RULES, screen: my },
  { name: "thank", pattern: "/thank", screen: screen(() => import("./screens/thank/index.tsx")) },
  { name: "waiting", pattern: "/waiting", screen: screen(() => import("./screens/waiting/index.tsx")) },
  { name: "care", pattern: "/care/:chain/:hand", rules: HAND_RULES, screen: screen(() => import("./screens/care/index.tsx")) },
  { name: "print", pattern: "/print", screen: screen(() => import("./screens/print/index.tsx")) },
  { name: "check", pattern: "/check", screen: screen(() => import("./screens/check/index.tsx")) },
  { name: "core", pattern: "/core", screen: screen(() => import("./screens/core/index.tsx")) },
  { name: "limits", pattern: "/limits", screen: screen(() => import("./screens/limits/index.tsx")) },
  { name: "defaults", pattern: "/defaults", screen: screen(() => import("./screens/defaults/index.tsx")) },
  { name: "without-us", pattern: "/without-us", screen: screen(() => import("./screens/without-us/index.tsx")) },
  ...(LOCAL
    ? [
        { name: "gallery", pattern: "/gallery", screen: screen(() => import("./shell/GalleryRedirect.tsx")), local: true },
        { name: "dev-wallet", pattern: "/dev/wallet", screen: screen(() => import("./screens/dev-wallet/index.tsx")), local: true },
      ]
    : []),
];

export interface Resolved {
  /** The route's name, or "not-found". */
  name: string;
  route?: Route;
  params: Params;
}

/** Which screen a place shows. "/" with `view: "hand"` is the Hand view of a bare link. */
export function resolve(place: Place, routes: readonly Route[] = ROUTES): Resolved {
  if (place.path === "/" && place.state?.view === "hand") {
    return { name: "hand", route: routes.find((r) => r.name === "hand"), params: {} };
  }
  for (const route of routes) {
    const params = matchPath(route.pattern, place.path, route.rules);
    if (params) return { name: route.name, route, params };
  }
  return { name: "not-found", params: {} };
}
