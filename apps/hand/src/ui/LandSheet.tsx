import { useEffect, useId, useRef, useState } from "react";
import type { Address } from "viem";

import { clsx } from "../lib/clsx";
import { AddressInput } from "./AddressInput";
import { Identity } from "./Identity";
import { payeeOf, readAddress, type AddressReading, type PayeeContext } from "./judge";
import { makeWords, type FreshWords, type Landing } from "./land";
import { Proof } from "./Proof";
import { QuietButton } from "./QuietButton";
import { Sheet } from "./Sheet";
import { SwipeButton } from "./SwipeButton";
import { useWords } from "./words";

type Choice = Landing["choice"];

export interface LandPickerProps {
  /**
   * give: the money of a Give lands here, and the choice also says how the Give is confirmed.
   * share: a holder's share of a pass lands here; nothing is confirmed by an account.
   */
  purpose: "give" | "share";
  /** The connected account, if there is one. It is then the first choice, and chosen. */
  account?: Address;
  /** Opens the screen's own way of connecting. The kit knows nothing about wallets. */
  onConnect: () => void;
  /**
   * The screen's way of connecting offers email (a build with Privy): the connect choice then
   * says so, since someone with no crypto app would not press "Connect a wallet".
   */
  email?: boolean;
  /** This Hand's Core, asker and token, for the SDK's `payeeProblem`. */
  ctx: PayeeContext;
  /** An address to start the "An address I have" field with. */
  initialAddress?: string;
  /** The choice as it stands: a landing once it is complete, undefined until then. */
  onChange: (landing: Landing | undefined) => void;
  /**
   * Why nothing is chosen yet, when the reason is not just "no choice": "tick" while new words
   * are shown and "I wrote them down" is not ticked. Undefined otherwise.
   */
  onWaiting?: (what: "tick" | undefined) => void;
}

/**
 * "Where the money lands" (UX-SPEC §8.6): three choices, one open at a time.
 *
 * - My connected account: shown first when one is connected; otherwise a button to connect.
 * - An address I have: any pasted address. Refused: the zero address and the contract's own.
 *   Flagged, and let through: the asker's and the token's.
 * - I have none: twelve words from viem's English list, shown once. They and the account made
 *   from them live in this component's memory only: nothing is written to storage, the
 *   clipboard or the console, and they are gone when the component is. The choice is complete
 *   only after "I wrote them down" is ticked.
 *
 * A key made in the browser is never the default: with no connected account, nothing is chosen.
 */
export function LandPicker({ purpose, account, onConnect, email = false, ctx, initialAddress = "", onChange, onWaiting }: LandPickerProps) {
  const words = useWords().land;
  const name = useId();
  const [choice, setChoice] = useState<Choice | undefined>(account ? "account" : undefined);
  const [reading, setReading] = useState<AddressReading>(() => readAddress(initialAddress, ctx));
  const [keep, setKeep] = useState(false);
  const [fresh, setFresh] = useState<FreshWords>();
  const [wrote, setWrote] = useState(false);

  // An account connected after the sheet opened becomes the choice, unless another was made.
  const seen = useRef(account);
  useEffect(() => {
    if (account && !seen.current && choice === undefined) setChoice("account");
    if (!account && choice === "account") setChoice(undefined);
    seen.current = account;
  }, [account, choice]);

  let landing: Landing | undefined;
  if (choice === "account" && account) {
    landing = { choice, payee: account, signing: { kind: "account", address: account } };
  } else if (choice === "address") {
    const payee = payeeOf(reading);
    if (payee) {
      landing = { choice, payee, signing: { kind: "one-time", keep } };
      if (reading.status === "flagged") landing.flagged = reading.problem;
    }
  } else if (choice === "fresh" && fresh && wrote) {
    landing = { choice, payee: fresh.account.address, signing: { kind: "words", account: fresh.account } };
  }

  // Report the choice when what it says changes, not on every render.
  const report = useRef(onChange);
  report.current = onChange;
  const held = useRef(landing);
  held.current = landing;
  const signature = landing ? `${landing.choice}:${landing.payee}:${landing.signing.kind}:${landing.signing.kind === "one-time" ? landing.signing.keep : ""}` : "";
  useEffect(() => {
    report.current(held.current);
  }, [signature]);
  const waiting = choice === "fresh" && fresh !== undefined && !wrote ? "tick" : undefined;
  const reportWaiting = useRef(onWaiting);
  reportWaiting.current = onWaiting;
  useEffect(() => {
    reportWaiting.current?.(waiting);
  }, [waiting]);

  const choose = (next: Choice) => {
    setChoice(next);
    // The address field starts over each time it opens, so the reading starts over with it.
    if (next === "address") setReading(readAddress(initialAddress, ctx));
    if (next === "fresh" && !fresh) setFresh(makeWords());
  };
  const again = () => {
    setFresh(makeWords());
    setWrote(false);
  };

  const radio = (value: Choice, title: string) => (
    <label className="ah-choice__head">
      <input type="radio" className="ah-choice__radio" name={name} value={value} checked={choice === value} onChange={() => choose(value)} />
      <span className="ah-choice__title">{title}</span>
    </label>
  );

  return (
    <fieldset className="ah-choices" data-choice={choice ?? "none"} data-complete={landing ? "true" : "false"}>
      <legend className="ah-field__label" style={{ padding: 0, marginBottom: 10 }}>
        {purpose === "give" ? words.askGive : words.askShare}
      </legend>

      {account ? (
        <div className={clsx("ah-choice", choice === "account" && "ah-choice--on")}>
          {radio("account", words.account)}
          {choice === "account" ? (
            <div className="ah-choice__body">
              <Identity address={account} full />
              <p className="ah-label" style={{ margin: 0 }}>
                {purpose === "give" ? words.accountGive : words.accountShare}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="ah-stack">
          <QuietButton onClick={onConnect}>{email ? words.connectEmail : words.connect}</QuietButton>
          <p className="ah-label" style={{ margin: 0 }}>
            {email ? words.connectEmailHint : words.connectHint}
          </p>
        </div>
      )}

      <div className={clsx("ah-choice", choice === "address" && "ah-choice--on")}>
        {radio("address", words.address)}
        {choice === "address" ? (
          <div className="ah-choice__body">
            <AddressInput label={words.addressLabel} ctx={ctx} initial={initialAddress} hint={words.addressHint} onReading={setReading} />
            {purpose === "give" ? (
              <>
                {/* How the answer is confirmed is the lens's; the calm view says where the money goes. */}
                <Proof calm={<p className="ah-label" style={{ margin: 0 }}>{words.addressCalm}</p>}>
                  <p className="ah-label" style={{ margin: 0 }}>
                    {words.oneTime}
                  </p>
                  <label className="ah-check">
                    <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
                    <span>
                      {words.keepKey}
                      <span className="ah-label block">{words.keepKeyHint}</span>
                    </span>
                  </label>
                </Proof>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={clsx("ah-choice", choice === "fresh" && "ah-choice--on")}>
        {radio("fresh", words.fresh)}
        {choice === "fresh" && fresh ? (
          <div className="ah-choice__body">
            <p className="ah-note" style={{ margin: 0 }}>
              {words.freshWarn}
            </p>
            {/* translate="no": a page translator must not change a single word of the key */}
            <ol className="ah-words" translate="no" data-testid="land-words">
              {fresh.words.map((word, index) => (
                <li key={index}>
                  <span aria-hidden="true">{index + 1}</span>
                  {word}
                </li>
              ))}
            </ol>
            <div className="ah-stack">
              <span className="ah-label">{words.freshAddress}</span>
              <Identity address={fresh.account.address} full />
              {purpose === "give" ? <span className="ah-label">{words.freshGive}</span> : null}
            </div>
            <label className="ah-check">
              <input type="checkbox" checked={wrote} onChange={(event) => setWrote(event.target.checked)} />
              <span>{words.wrote}</span>
            </label>
            <QuietButton variant="text" onClick={again} className="self-start">
              {words.others}
            </QuietButton>
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

export interface LandSheetProps extends Omit<LandPickerProps, "onChange"> {
  /** The person settled where the money lands. The screen keeps the answer in memory only. */
  onDone: (landing: Landing) => void;
  onClose: () => void;
}

/**
 * The same three choices as a sheet with its own action. The swipe stays off until the choice
 * is complete: an address that may be paid, or the twelve words ticked as written down.
 */
export function LandSheet({ onDone, onClose, ...picker }: LandSheetProps) {
  const words = useWords().land;
  const [landing, setLanding] = useState<Landing>();
  return (
    <Sheet label={picker.purpose === "give" ? words.askGive : words.askShare} onClose={onClose}>
      <div className="mt-4 flex flex-1 flex-col gap-6">
        <LandPicker {...picker} onChange={setLanding} />
        <div className="mt-auto pt-6">
          <SwipeButton
            gesture={picker.purpose === "give" ? "cheer" : "shake"}
            variant="amber"
            disabled={!landing}
            className="w-full"
            onClick={() => {
              if (landing) onDone(landing);
            }}
          >
            {words.done}
          </SwipeButton>
        </div>
      </div>
    </Sheet>
  );
}
