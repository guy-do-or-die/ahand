// aHand Core mappings (survival baseline). BigInt-exact, no floats.
//
// Event ordering guarantees relied upon (from the Core spec, Phase C):
// - raise emits Raised before HandTagged in the same tx;
// - thank emits Settled before RouteHopSettled occurrences and PayoutAllocated;
// - reclaim emits Reclaimed before PayoutAllocated(RaiserRefund).
// Handlers therefore assume parent entities exist and only log defensively.

import {
  Address,
  BigInt,
  Bytes,
  crypto,
  dataSource,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";

import {
  Raised,
  HandTagged,
  Settled,
  RouteHopSettled,
  Reclaimed,
  PayoutAllocated,
  PayoutWithdrawn,
  TokenPolicyUpdated,
  CharityPolicyUpdated,
} from "../generated/AHandCore/AHandCore";

import {
  Hand,
  HandTag,
  Settlement,
  RouteHop,
  PayoutAllocation,
  Withdrawal,
  Actor,
  TokenPolicy,
  CharityPolicy,
} from "../generated/schema";

const ONE = BigInt.fromI32(1);

// Enum ordinal → schema label. Solidity guarantees the ordinal range, so the
// fallback branches are unreachable for events emitted by the real Core.
const VISIBILITY_LABELS = ["Public", "Preview", "Dark"];
const ALLOCATION_KIND_LABELS = [
  "Charity",
  "ShakerMargin",
  "GiverResidual",
  "RaiserRefund",
];

function visibilityLabel(ordinal: i32): string {
  if (ordinal >= 0 && ordinal < VISIBILITY_LABELS.length) {
    return VISIBILITY_LABELS[ordinal];
  }
  log.error("Unknown Visibility ordinal {}", [ordinal.toString()]);
  return "Public";
}

function allocationKindLabel(ordinal: i32): string {
  if (ordinal >= 0 && ordinal < ALLOCATION_KIND_LABELS.length) {
    return ALLOCATION_KIND_LABELS[ordinal];
  }
  log.error("Unknown AllocationKind ordinal {}", [ordinal.toString()]);
  return "GiverResidual";
}

// Manifest network name → EVM chainId. Extend when new networks are added;
// unknown networks index fine but get chainId 0 and a null handRef.
function chainIdForNetwork(network: string): BigInt {
  if (network == "base-sepolia") return BigInt.fromI32(84532);
  if (network == "base") return BigInt.fromI32(8453);
  if (network == "sepolia") return BigInt.fromI32(11155111);
  if (network == "mainnet") return BigInt.fromI32(1);
  if (network == "anvil" || network == "localhost" || network == "hardhat") {
    return BigInt.fromI32(31337);
  }
  return BigInt.zero();
}

// Hand id = "<core hex>-<handId hex>", both lowercase 0x-prefixed.
function handEntityId(core: Address, handId: BigInt): string {
  return core.toHexString() + "-" + handId.toHexString();
}

// keccak256(abi.encode(chainId, core, handId)) — byte-identical to the
// contract-side handRef (a static tuple encodes exactly like abi.encode of
// its members). Null when the chainId is unknown, never a guessed value.
function computeHandRef(
  chainId: BigInt,
  core: Address,
  handId: BigInt
): Bytes | null {
  if (chainId.isZero()) return null;
  const values: Array<ethereum.Value> = [
    ethereum.Value.fromUnsignedBigInt(chainId),
    ethereum.Value.fromAddress(core),
    ethereum.Value.fromUnsignedBigInt(handId),
  ];
  const encoded = ethereum.encode(
    ethereum.Value.fromTuple(changetype<ethereum.Tuple>(values))
  );
  if (encoded === null) return null;
  return Bytes.fromByteArray(crypto.keccak256(encoded));
}

// Load-or-create an Actor and stamp update provenance. Caller mutates
// counters and MUST save().
function touchActor(address: Address, event: ethereum.Event): Actor {
  const id = address.toHexString();
  let actor = Actor.load(id);
  if (actor === null) {
    actor = new Actor(id);
    actor.address = address;
    actor.raisedCount = BigInt.zero();
    actor.reclaimedCount = BigInt.zero();
    actor.giverSettlementCount = BigInt.zero();
    actor.shakerHopCount = BigInt.zero();
    actor.allocationCount = BigInt.zero();
    actor.allocatedTotal = BigInt.zero();
    actor.withdrawalCount = BigInt.zero();
    actor.withdrawnTotal = BigInt.zero();
    actor.block = event.block.number;
    actor.timestamp = event.block.timestamp;
    actor.tx = event.transaction.hash;
  }
  actor.updatedBlock = event.block.number;
  actor.updatedTimestamp = event.block.timestamp;
  actor.updatedTx = event.transaction.hash;
  return actor as Actor;
}

function eventScopedId(event: ethereum.Event): string {
  return (
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
}

export function handleRaised(event: Raised): void {
  const core = event.address;
  const id = handEntityId(core, event.params.handId);
  const network = dataSource.network();
  const chainId = chainIdForNetwork(network);

  const raiser = touchActor(event.params.raiser, event);
  raiser.raisedCount = raiser.raisedCount.plus(ONE);
  raiser.save();

  const hand = new Hand(id);
  hand.handId = event.params.handId;
  hand.core = core;
  hand.chainId = chainId;
  hand.network = network;
  hand.handRef = computeHandRef(chainId, core, event.params.handId);
  hand.raiser = raiser.id;
  hand.status = "Active";
  hand.token = event.params.token;
  hand.creditedReward = event.params.credited;
  hand.usdScaleAtRaise = event.params.usdScaleAtRaise;
  hand.policyRevision = event.params.policyRevision;
  hand.expiry = event.params.expiry;
  hand.rootCapability = event.params.rootCapability;
  hand.visibility = visibilityLabel(event.params.visibility);
  hand.metadataCommitment = event.params.metadataCommitment;
  hand.discoveryCommitment = event.params.discoveryCommitment;
  hand.discoveryRef = event.params.discoveryRef;
  hand.minGiverClaimBps = event.params.minGiverClaimBps;
  hand.charityRecipient = event.params.charityRecipient;
  hand.charityBps = event.params.charityBps;
  hand.block = event.block.number;
  hand.timestamp = event.block.timestamp;
  hand.tx = event.transaction.hash;
  hand.updatedBlock = event.block.number;
  hand.updatedTimestamp = event.block.timestamp;
  hand.updatedTx = event.transaction.hash;
  hand.save();
}

export function handleHandTagged(event: HandTagged): void {
  const handId = handEntityId(event.address, event.params.handId);
  const tagIds = event.params.tagIds;
  for (let i = 0; i < tagIds.length; i++) {
    const tag = new HandTag(handId + "-" + tagIds[i].toHexString());
    tag.hand = handId;
    tag.tag = tagIds[i];
    tag.raiser = event.params.raiser;
    tag.position = i;
    tag.block = event.block.number;
    tag.timestamp = event.block.timestamp;
    tag.tx = event.transaction.hash;
    tag.save();
  }
}

export function handleSettled(event: Settled): void {
  const handId = handEntityId(event.address, event.params.handId);

  const giver = touchActor(event.params.giver, event);
  giver.giverSettlementCount = giver.giverSettlementCount.plus(ONE);
  giver.save();

  const settlement = new Settlement(handId);
  settlement.hand = handId;
  settlement.giver = giver.id;
  settlement.solutionHash = event.params.solutionHash;
  settlement.routeHash = event.params.routeHash;
  settlement.giveHash = event.params.giveHash;
  settlement.token = event.params.token;
  settlement.creditedPool = event.params.creditedPool;
  settlement.distributablePool = event.params.distributablePool;
  settlement.giverAllocation = event.params.giverAllocation;
  settlement.charityRecipient = event.params.charityRecipient;
  settlement.charityAllocation = event.params.charityAllocation;
  settlement.usdScale = event.params.usdScale;
  settlement.charityUsd = event.params.charityUsd;
  settlement.block = event.block.number;
  settlement.timestamp = event.block.timestamp;
  settlement.tx = event.transaction.hash;
  settlement.save();

  const hand = Hand.load(handId);
  if (hand === null) {
    log.error("Settled for unknown hand {}", [handId]);
    return;
  }
  hand.status = "Settled";
  hand.settlement = settlement.id;
  hand.updatedBlock = event.block.number;
  hand.updatedTimestamp = event.block.timestamp;
  hand.updatedTx = event.transaction.hash;
  hand.save();
}

export function handleRouteHopSettled(event: RouteHopSettled): void {
  const handId = handEntityId(event.address, event.params.handId);
  const position = event.params.position;

  // One RouteHop per occurrence: position is unique within the single
  // settlement of a hand, so this id never collides and never collapses
  // repeated shakers or anonymous hops.
  const hop = new RouteHop(handId + "-" + position.toString());
  hop.hand = handId;
  hop.settlement = handId;
  hop.routeHash = event.params.routeHash;
  hop.position = position;
  hop.parentCapability = event.params.parentCapability;
  hop.childCapability = event.params.childCapability;
  hop.parentClaimBps = event.params.parentClaimBps;
  hop.childClaimBps = event.params.childClaimBps;
  hop.marginBps = event.params.parentClaimBps - event.params.childClaimBps;
  hop.shaker = event.params.shaker;
  if (event.params.shaker.notEqual(Address.zero())) {
    const shaker = touchActor(event.params.shaker, event);
    shaker.shakerHopCount = shaker.shakerHopCount.plus(ONE);
    shaker.save();
    hop.shakerActor = shaker.id;
  }
  hop.shakeHash = event.params.shakeHash;
  hop.hopDataHash = event.params.hopDataHash;
  hop.marginAllocation = event.params.marginAllocation;
  hop.block = event.block.number;
  hop.timestamp = event.block.timestamp;
  hop.tx = event.transaction.hash;
  hop.save();
}

export function handleReclaimed(event: Reclaimed): void {
  const handId = handEntityId(event.address, event.params.handId);

  const raiser = touchActor(event.params.raiser, event);
  raiser.reclaimedCount = raiser.reclaimedCount.plus(ONE);
  raiser.save();

  const hand = Hand.load(handId);
  if (hand === null) {
    log.error("Reclaimed for unknown hand {}", [handId]);
    return;
  }
  hand.status = "Reclaimed";
  hand.reclaimRefund = event.params.refund;
  hand.reclaimedTimestamp = event.block.timestamp;
  hand.updatedBlock = event.block.number;
  hand.updatedTimestamp = event.block.timestamp;
  hand.updatedTx = event.transaction.hash;
  hand.save();
}

export function handlePayoutAllocated(event: PayoutAllocated): void {
  const beneficiary = touchActor(event.params.beneficiary, event);
  beneficiary.allocationCount = beneficiary.allocationCount.plus(ONE);
  beneficiary.allocatedTotal = beneficiary.allocatedTotal.plus(
    event.params.amount
  );
  beneficiary.save();

  const allocation = new PayoutAllocation(eventScopedId(event));
  allocation.hand = handEntityId(event.address, event.params.handId);
  allocation.token = event.params.token;
  allocation.beneficiary = beneficiary.id;
  allocation.kind = allocationKindLabel(event.params.kind);
  allocation.routePosition = event.params.routePosition;
  allocation.amount = event.params.amount;
  allocation.block = event.block.number;
  allocation.timestamp = event.block.timestamp;
  allocation.tx = event.transaction.hash;
  allocation.save();
}

export function handlePayoutWithdrawn(event: PayoutWithdrawn): void {
  const beneficiary = touchActor(event.params.beneficiary, event);
  beneficiary.withdrawalCount = beneficiary.withdrawalCount.plus(ONE);
  beneficiary.withdrawnTotal = beneficiary.withdrawnTotal.plus(
    event.params.amount
  );
  beneficiary.save();

  // Aggregate by construction: claims[token][beneficiary] pools every hand,
  // so a Withdrawal deliberately has no hand link.
  const withdrawal = new Withdrawal(eventScopedId(event));
  withdrawal.token = event.params.token;
  withdrawal.beneficiary = beneficiary.id;
  withdrawal.amount = event.params.amount;
  withdrawal.block = event.block.number;
  withdrawal.timestamp = event.block.timestamp;
  withdrawal.tx = event.transaction.hash;
  withdrawal.save();
}

export function handleTokenPolicyUpdated(event: TokenPolicyUpdated): void {
  const id = event.params.token.toHexString();
  let policy = TokenPolicy.load(id);
  if (policy === null) {
    policy = new TokenPolicy(id);
    policy.token = event.params.token;
  }
  policy.enabled = event.params.enabled;
  policy.policyRevision = event.params.policyRevision;
  policy.block = event.block.number;
  policy.timestamp = event.block.timestamp;
  policy.tx = event.transaction.hash;
  policy.save();
}

export function handleCharityPolicyUpdated(event: CharityPolicyUpdated): void {
  const id = event.params.charity.toHexString();
  let policy = CharityPolicy.load(id);
  if (policy === null) {
    policy = new CharityPolicy(id);
    policy.charity = event.params.charity;
  }
  policy.allowed = event.params.allowed;
  policy.policyRevision = event.params.policyRevision;
  policy.block = event.block.number;
  policy.timestamp = event.block.timestamp;
  policy.tx = event.transaction.hash;
  policy.save();
}
