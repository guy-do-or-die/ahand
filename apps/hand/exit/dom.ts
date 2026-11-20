/** A few lines of DOM so the exit page needs no framework. */

export type Child = Node | string | number | null | undefined | false | Child[];

type Props = Record<string, unknown> & { class?: string };

/** h("button", { class: "x-btn", onclick: fn, "data-testid": "…" }, "Read") */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class") element.className = String(value);
    else if (name.startsWith("on") && typeof value === "function") element.addEventListener(name.slice(2), value as EventListener);
    else if (name === "value" || name === "disabled" || name === "checked") (element as unknown as Record<string, unknown>)[name] = value;
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  append(element, children);
  return element;
}

function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
}

/**
 * A block of exact text with a copy button. Where the clipboard is closed (some browsers on a
 * file page), the text is selected for copying by hand and the button says so.
 */
export function codeBlock(text: string, testId: string, words: { copy: string; copied: string; failed: string }): HTMLElement {
  const code = h("code", { "data-testid": testId }, text);
  const pre = h("pre", { class: "x-code", tabindex: 0 }, code);
  const button = h("button", { type: "button", class: "x-copy" }, words.copy);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = words.copied;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      button.textContent = words.failed;
    }
    setTimeout(() => (button.textContent = words.copy), 1800);
  });
  pre.appendChild(button);
  return pre;
}
