import { useEffect } from "react";

import { t } from "../i18n";

/**
 * `/gallery` (local builds only): the component gallery is its own page, gallery.html, a second
 * entry of the build (ARCHITECTURE §14). This route only sends the tab there.
 */
export default function GalleryRedirect() {
  useEffect(() => {
    window.location.replace("/gallery.html");
  }, []);
  return <p className="ah-meta px-6 py-12 md:px-10">{t("common.gallery")}</p>;
}
