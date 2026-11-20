// The chain layer (ARCHITECTURE §7): viem clients per chain, one block watcher, useNow, useHand,
// usePending, useFinality, useCost. Screens import only from here. The one clock is the chain's.
export { isNetworkError } from "./errors";
export { giveOnChain, type GiveOnChain, type GiveOnChainInput } from "./give";
export { WATCH_TIMING, chainOf, clientsOf, publicClientOf, transportOf, watchClientOf, type TransportTiming } from "./clients";
export { follow, receiptOrNothing, standingOf, type FollowOptions, type Progress, type Reached } from "./finality";
export { isNoDataError, presenceOf, PresenceStore, readFailureOf, type Presence, type PresenceState, type ReadFailure } from "./presence";
export {
  CANONICAL_CORE,
  CLIENTS,
  clientOf,
  corePresence,
  useCorePresence,
  useBlockRead,
  useChainStatus,
  useCost,
  useFinality,
  useHand,
  useNow,
  usePending,
  watcherOf,
  type BlockRead,
  type CostRead,
  type HandRead,
  type Now,
} from "./hooks";
export { simulateAll, simulateOne, type Simulation } from "./simulate";
export { BlockWatcher, READ_TIMEOUT_MS, latestTip, staleAfterPolls, type ChainStatus, type Tip } from "./watcher";
