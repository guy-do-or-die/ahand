import { useCallback, useEffect, useRef, useState } from "react";

import { clientOf } from "../../chain";
import { t, useLang } from "../../i18n";
import { addressOf, openedLink } from "../../store/memory";
import { TID } from "../../testids";
import { ErrorBand, QuietButton } from "../../ui";
import { checkThank, isGiveFragment, type CheckResult } from "./check";
import { ThankFlow } from "./Flow";

/**
 * /thank (UX-SPEC §7.5): one careful tap that pays everyone. A give address is pasted here, or
 * handed over by /my through store/memory.ts. Nothing is called an answer before Core's
 * `checkGive` passes; until then the screen says it is checking.
 */
export default function ThankScreen() {
  useLang(); // re-render on a language switch
  const [text, setText] = useState("");
  const [checking, setChecking] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<CheckResult | undefined>(undefined);
  const run = useRef(0);

  const check = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const mine = ++run.current;
    setResult(undefined);
    setChecking(trimmed);
    const answer = await checkThank(trimmed, window.location.origin, clientOf());
    if (run.current !== mine) return;
    setChecking(undefined);
    setResult(answer);
  }, []);

  // A give address handed over by /my or pasted on the landing; one that arrived in this tab's
  // own address is taken only when it is a give link (a hand's link opens on the hand view).
  useEffect(() => {
    const held = openedLink();
    if (!held) return;
    if (held.via === "address" && !isGiveFragment(held.fragment)) return;
    const address = addressOf(held);
    if (!address) return;
    setText(address);
    void check(address);
  }, [check]);

  const reset = () => {
    run.current++;
    setResult(undefined);
    setChecking(undefined);
    setText("");
  };

  const showInput = !result?.ok && !checking;

  return (
    <section className="mx-auto flex w-full max-w-[680px] flex-col gap-6 px-6 py-10 md:px-10" data-screen="thank">
      <header className="flex flex-col gap-3">
        <h1 className="m-0 text-[length:var(--fs-title-m)] font-extrabold leading-[1.06] tracking-[-0.03em] md:text-[length:var(--fs-title)]">{t("thank.title")}</h1>
        {showInput ? <p className="m-0 text-[length:var(--fs-body-lg)] leading-snug">{t("thank.lead")}</p> : null}
      </header>

      {showInput ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void check(text);
          }}
        >
          <label className="ah-field">
            <span className="ah-field__label">{t("thank.input.label")}</span>
            <textarea
              className="ah-input ah-input--exact min-h-[96px] resize-y break-all"
              data-testid={TID.thank.input}
              value={text}
              rows={3}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              placeholder={t("thank.input.placeholder")}
              onChange={(event) => setText(event.target.value)}
            />
            <span className="ah-label">{t("thank.input.hint")}</span>
          </label>
          <QuietButton type="submit" className="self-start" data-testid={TID.thank.open} disabled={!text.trim()}>
            {t("thank.open")}
          </QuietButton>
        </form>
      ) : null}

      {checking ? (
        <p className="ah-label m-0" role="status" data-testid={TID.thank.checking}>
          {t("thank.checking")}
        </p>
      ) : null}

      {result && !result.ok ? (
        <div data-testid={TID.thank.error} data-value={result.failure.code ?? result.failure.messageId}>
        <ErrorBand
          className="w-full"
          what={t(result.failure.messageId)}
          kept={/nothing (was sent|left)|ничего не (отправлено|ушло)/i.test(t(result.failure.messageId)) ? undefined : t("common.error.nothingSent")}
          {...(result.failure.code ? { code: result.failure.code } : {})}
          action={
            <QuietButton compact onClick={reset}>
              {t("thank.again")}
            </QuietButton>
          }
        />
        </div>
      ) : null}

      {result?.ok ? <ThankFlow key={result.checked.giveHash} checked={result.checked} onAnother={reset} /> : null}
    </section>
  );
}
