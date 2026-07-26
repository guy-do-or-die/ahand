# Capabilities and routing

## Why capabilities

A Hand travels among strangers through arbitrary channels without writing every pass to the chain. A capability is an address whose holder may extend the route: sign the next `Shake` or sign the terminal `Give`. Identity answers "who is this?"; a capability answers "may this holder extend this route?" — the two stay separate.

`raise` commits a `rootCapability` address. The first `Shake` must be signed by that capability; every later hop must be signed by the previous hop's `childCapability`. Nothing touches the chain until `thank` submits the complete signed chain.

## The Shake struct

```solidity
struct Shake {
    uint256 handId;
    address childCapability; // bearer: fresh ephemeral key; personal: wallet of the recipient
    address shaker;          // stable attributed account; zero = anonymous (zero-margin only)
    uint16  parentClaimBps;  // = childClaimBps of the previous hop
    uint16  childClaimBps;   // hop margin = parent − child
    bytes32 hopDataHash;     // app-opaque commitment; zero = none
    uint40  deadline;        // never past the Hand expiry
}
```

Field order feeds `SHAKE_TYPEHASH` and is frozen. `hopDataHash` optionally commits application-specific hop data without teaching Core its schema; private hop data uses canonical bytes and a nonce before hashing.

## Shaker consent modes

The capability address and the attributed `shaker` account may differ: route authority can be ephemeral while attribution — and any positive margin — goes to a stable wallet. Three modes:

```text
anonymous => shaker == 0; valid only at zero margin; acceptance bytes must be empty
self      => shaker == the signing capability; the Shake signature is also consent; acceptance bytes must be empty
explicit  => shaker is a distinct non-zero account; a ShakerAcceptance(shakeHash) signature by that account is required
```

`ShakerAcceptance` contains a single field, `shakeHash` — the EIP-712 struct hash of the accepted Shake — so signing it consents to exactly that hop's attribution and payout terms. Core enforces the matrix strictly: an explicit shaker without a valid acceptance reverts `ShakerAcceptanceInvalid`; an anonymous or self-attributed hop carrying non-empty acceptance bytes reverts `UnexpectedAcceptance`; a paid hop with a zero shaker reverts `AnonymousShakerWithMargin`.

## EIP-712 domain and typehashes

The domain binds name `"aHand"`, version `"2"`, `block.chainid`, and the verifying `AHandCore` address. `DOMAIN_SEPARATOR()` returns a value cached at deployment while `block.chainid` still equals the deployment chain id and recomputes it otherwise, so signatures never silently stay valid across a chain split (`AHand.forksafety.t.sol` pins this).

The `AHandSig` library in `AHandTypes.sol` defines the frozen type strings:

```solidity
SHAKE_TYPEHASH             = keccak256("Shake(uint256 handId,address childCapability,address shaker,uint16 parentClaimBps,uint16 childClaimBps,bytes32 hopDataHash,uint40 deadline)");
SHAKER_ACCEPTANCE_TYPEHASH = keccak256("ShakerAcceptance(bytes32 shakeHash)");
GIVE_TYPEHASH              = keccak256("Give(uint256 handId,bytes32 routeHash,address giver,bytes32 solutionHash,uint16 finalClaimBps,uint40 deadline)");
GIVER_ACCEPTANCE_TYPEHASH  = keccak256("GiverAcceptance(bytes32 giveHash)");
THANK_PERMIT_TYPEHASH      = keccak256("ThankPermit(uint256 handId,bytes32 routeHash,bytes32 giveHash,uint256 nonce,uint40 deadline)"); // reserved; no entry point consumes it
```

The SDK (`packages/sdk`) reproduces these byte-for-byte; `GenVectors.t.sol` generates the cross-language test vectors that pin the equality, with the contract side authoritative.

## Hash construction

```text
shakeHash = keccak256(abi.encode(SHAKE_TYPEHASH, handId, childCapability, shaker,
                                 parentClaimBps, childClaimBps, hopDataHash, deadline))
handRef   = keccak256(abi.encode(block.chainid, core, handId))
routeHash = keccak256(abi.encode(handRef, shakeHashes))    // ordered hashStruct(Shake) values
digest    = keccak256(0x1901 || DOMAIN_SEPARATOR || structHash)
```

Signature bytes are deliberately excluded from `shakeHash` and `routeHash`: signature malleability cannot rename a route. An empty `shakeHashes` array is valid — the zero-shake route, where the root capability signs the `Give` directly with `finalClaimBps = 10_000`. `handRef` binds chain and core, so the same `handId` on another chain or core is a distinct reference.

## Route verification

`_verifyRoute` walks the chain from the root, in order, with these checks per hop (exact revert names):

```text
expectedCap   = rootCapability
expectedClaim = BPS_DENOMINATOR (10_000)

for each Shake s:
  s.handId == handId                             else WrongHand
  signature by expectedCap over hashShake(s)     else CapabilityProof
  s.parentClaimBps == expectedClaim              else ClaimMismatch
  s.childClaimBps  <= s.parentClaimBps           else ClaimMustNotGrow
  s.childClaimBps  >= minGiverClaimBps           else ClaimBelowFloor
  block.timestamp  <= s.deadline                 else TicketExpired
  s.deadline       <= hand.expiry                else DeadlineExceedsExpiry
  margin = s.parentClaimBps − s.childClaimBps
  if margin > 0:
    s.shaker != 0                                else AnonymousShakerWithMargin
    floor(distributable * margin / 10_000) != 0  else MarginRoundsToZero
  consent matrix (see above)                     else ShakerAcceptanceInvalid / UnexpectedAcceptance
  expectedCap = s.childCapability; expectedClaim = s.childClaimBps
```

A route longer than `MAX_SHAKES = 6` reverts `RouteTooLong`, and the positional arrays (`shakes`, `shakeSigs`, `shakerAcceptances`) must match lengths (`LengthMismatch`). The loop is atomic by design: the first invalid hop reverts the entire `thank`; there is no partial acceptance of a route prefix.

Claims telescope monotonically from `10_000` down and can never dip below the `minGiverClaimBps` floor committed at raise, so every party signs knowing the worst-case giver share. A dust margin whose token allocation floors to zero is invalid (`MarginRoundsToZero`) rather than silently unpaid.

After the walk, the terminal capability and claim feed `_verifyGive`: `give.routeHash` must equal the computed route hash and `give.finalClaimBps` the terminal claim (see [settlement](settlement-and-giver-protection.md)).

## Signature verification and ERC-1271

One verifier, `_isValidSig`, serves all four signature families (Shake, ShakerAcceptance, Give, GiverAcceptance). It tries ECDSA recovery first; if that does not match and the signer has code, it falls back to ERC-1271 via a manual `staticcall` to `isValidSignature(bytes32,bytes)` capped at `ERC1271_GAS = 350_000`, accepting only the magic value `0x1626ba7e`. The staticcall makes the check mutation-proof by construction, and the cap keeps a hostile wallet from gas-bombing settlement: the worst-case `thank` performs 14 verifications (6 shakes + 6 acceptances + give + giver acceptance), roughly a 4.9M-gas ceiling. Contract wallets therefore work as capabilities, shakers, and givers (`AHand.erc1271.t.sol`).

## Bearer and personal capabilities

A **bearer** capability is a fresh private key carried in the link payload: link-only onboarding, but copyable by any recipient. A **personal** capability is the recipient's own wallet or smart account: no raw-key transport, but the intended recipient must sign before forwarding or giving. Core does not distinguish the modes — both are addresses that must produce valid signatures.

When forwarding a bearer route, the SDK creates a fresh child key, signs the Shake with the current key, appends the hop and signature, includes only the child secret in the forwarded payload, and strips the parent secret. Stripping protects the downstream payload; it does not revoke a sender's retained copy — any earlier holder can still authorize an alternate branch, and Core cannot distinguish that from any other legitimate branch. Exclusive one-time transfer would require on-chain nonce consumption and is not claimed.
