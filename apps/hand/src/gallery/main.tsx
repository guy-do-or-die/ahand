import "../design/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { t } from "../i18n";
import { ChainRail } from "../ui/ChainRail";
import { Logo } from "../ui/Logo";
import { QuietButton } from "../ui/QuietButton";
import { SwipeButton } from "../ui/SwipeButton";

/** Wave 1 gallery: the ported pieces as they came from apps/web. app-design builds the full gallery in wave 2. */
function Gallery() {
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-6 px-6 py-10">
      <Logo size={40} />
      <p className="ah-meta">{t("common.notBuilt")}</p>
      <SwipeButton gesture="raise">{t("raise.title")}</SwipeButton>
      <QuietButton>{t("my.title")}</QuietButton>
      <ChainRail nodes={["0x70…79C8", "0x3C…93BC"]} youLabel="YOU" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
