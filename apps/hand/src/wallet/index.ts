// The wallet layer (ARCHITECTURE §7): wagmi config, dev wallet (local builds only, loaded by
// config.ts behind the build flag), ConnectSheet, useSend, useTypedSigner. Screens import only
// from here and never call wagmi themselves. Nothing here exports or imports ./dev statically.
export { ConnectButton, ConnectSheet, CONNECT_TID, devAccountTid, type ConnectSheetProps } from "./ConnectSheet";
export { LOCAL, walletConfig, walletConfigOf } from "./config";
export { safeIcon } from "./icons";
export {
  canBatch,
  pause,
  resume,
  sendCalls,
  type Intent,
  type Probe,
  type SendAction,
  type SendEnv,
  type SendOptions,
  type SendProgress,
  type SendResult,
  type SignedInWallet,
  type StepInfo,
} from "./send";
export { approvalProbe, extendedProbe, fundedProbe, raisedProbe, refundedProbe, thankedProbe, withdrawnProbe } from "./effects";
export { useKeptSend, type KeptSend } from "./useKeptSend";
export {
  connectedWallet,
  connectWallet,
  disconnectWallet,
  optionAddress,
  switchToAppChain,
  useWallet,
  useWalletOptions,
  unknownNetwork,
  type ConnectOutcome,
  type WalletOption,
  type WalletState,
} from "./state";
export { useSend, type SendState, type UseSend } from "./useSend";
export { signTypedWith, type TypedAnswer } from "./typed";
export { useTypedSigner, type TypedOutcome, type UseTypedSigner } from "./useTypedSigner";
export { useWalletWords, WALLET_WORDS, type WalletWords } from "./words";
