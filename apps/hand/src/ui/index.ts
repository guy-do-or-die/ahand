/**
 * The shared UI kit (ARCHITECTURE §7). A screen imports from here and from nowhere deeper.
 * Words and language: every component that speaks takes its language from <html lang> (or the
 * nearest <Ambient>) and its sentences from ui/words.ts. The lens: <html data-lens="on">.
 */
export { Ambient, useLang, useLens, type AmbientValue, type Lang } from "./ambient";
export { WORDS, useWords, wordsOf, type Words } from "./words";
export { count, day, inBothZones, minute, money, percent, second, shortAddress, unitsText } from "./format";

export { AddressInput, type AddressInputProps } from "./AddressInput";
export { Flip, type FlipProps } from "./Flip";
export { ChainRail, type ChainRailProps, type RailRoute } from "./ChainRail";
export { railHandsOf, type LeftOut, type RailHand } from "./rail";
export { ChipRow, type ChipOption, type ChipRowProps } from "./ChipRow";
export { CopyRow, type CopyRowProps } from "./CopyRow";
export { CostLine, type CostLineProps } from "./CostLine";
export { DealCard, dealDescriptionOf, type DealCardProps, type DealDescription } from "./DealCard";
export { Disclose, type DiscloseProps } from "./Disclose";
export { Emoji } from "./Emoji";
export { ErrorBand, type ErrorBandProps } from "./ErrorBand";
export { Identity, type IdentityProps } from "./Identity";
export { LandPicker, LandSheet, type LandPickerProps, type LandSheetProps } from "./LandSheet";
export { Logo } from "./Logo";
export { Mark, type MarkKind, type MarkProps } from "./Mark";
export { MetaLine } from "./MetaLine";
export { MoneyInput, type MoneyInputProps } from "./MoneyInput";
export { Qr, type QrProps } from "./Qr";
export { QuietButton, type QuietButtonProps } from "./QuietButton";
export { ReceiptTable, type ReceiptTableProps } from "./ReceiptTable";
export { RewardBar, type RewardBarProps } from "./RewardBar";
export { Sheet, type SheetProps } from "./Sheet";
export { SwipeButton, type Gesture, type SwipeButtonProps } from "./SwipeButton";
export { ThemeToggle } from "./ThemeToggle";
export { TxRail, type TxRailProps, type TxReached } from "./TxRail";

export { payeeOf, readAddress, readMoney, type AddressReading, type MoneyReading, type PayeeContext } from "./judge";
export { makeWords, type FreshWords, type GiveSigning, type Landing } from "./land";
export { QR_MAX_VERSION, QR_MIN_PIXELS_PER_MODULE, QR_QUIET_MODULES, qrOf, qrSegments, type QrCode } from "./qr-code";
export { lineLanded, receiptLines, type ReceiptLine, type ReceiptLines } from "./receipt";
