import "../src/design/tokens.css";

import raw from "virtual:ahand-config";

/**
 * Placeholder of exit.html (wave 1). The page itself (status, refund, withdraw, thank from a give
 * link, each with its calldata and cast line) is built by exit-page in wave 4. Until then it says
 * what it is and which Core and chain this build names, so the single-file build is proven.
 */
const config = raw as { chain: { id: number; name: string }; cores: { canonical: string | null } };
const root = document.getElementById("exit")!;
root.style.cssText = "font-family: var(--font-meta); color: var(--ink); background: var(--paper); padding: 24px; min-height: 100dvh; box-sizing: border-box;";

const title = document.createElement("h1");
title.textContent = "aHand — without the site";
const facts = document.createElement("p");
facts.textContent = `CHAIN ${config.chain.id} (${config.chain.name}) · CORE ${config.cores.canonical ?? "—"}`;
const note = document.createElement("p");
note.textContent = "This page is not built yet. Until it is: contracts/exit/ahand.sh does the same with cast.";
root.append(title, facts, note);
