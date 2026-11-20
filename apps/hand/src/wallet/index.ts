// The wallet layer (ARCHITECTURE §7): wagmi config, dev wallet (local builds only, loaded by
// config.ts behind the build flag), ConnectSheet, useSend, useTypedSigner. Screens import only
// from here and never call wagmi themselves. Nothing here exports or imports ./dev statically.
export { ConnectButton, ConnectSheet, CONNECT_TID, devAccountTid, type ConnectSheetProps } from "./ConnectSheet";
export { LOCAL, walletConfig, walletConfigOf } from "./config";
export { safeIcon } from "./icons";
export { canBatch, pause, resume, sendCalls, type Intent, type SendEnv, type SendOptions, type SendProgress, type SendResult, type SignedInWallet } from "./send";
export {
  connectedWallet,
  connectWallet,
  disconnectWallet,
  optionAddress,
  switchToAppChain,
  useWallet,
  useWalletOptions,
  type ConnectOutcome,
  type WalletOption,
  type WalletState,
} from "./state";
export { useSend, type SendState, type UseSend } from "./useSend";
export { signTypedWith, type TypedAnswer } from "./typed";
export { useTypedSigner, type TypedOutcome, type UseTypedSigner } from "./useTypedSigner";
export { useWalletWords, WALLET_WORDS, type WalletWords } from "./words";
