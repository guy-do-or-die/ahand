// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import "./AHandTestBase.sol";

/*//////////////////////////////////////////////////////////////
        SUITE: conservation — the settlement matrix is exact.
        P == C + sum(margins) + giverResidual holds to the unit:
        floor math everywhere, the giver residual absorbs dust,
        and duplicate shakers aggregate into one ledger entry.
//////////////////////////////////////////////////////////////*/

contract AHandConservationTest is AHandTestBase {
    /// Sixth child capability: the base fixture stops at E5, a 6-hop route
    /// needs children E1..E6.
    uint256 constant E6 = 0xE6aa;

    /// @dev Hybrid settlement pushes each allocation to the beneficiary's wallet
    ///      (MockUSD never defers), so the exact-split assertions now read the
    ///      recipient balance — the same numbers, a different destination.
    function paidOf(address a) internal view returns (uint256) {
        return usd.balanceOf(a);
    }

    function claimOf(address a) internal view returns (uint256) {
        return core.claims(address(usd), a);
    }

    /// @dev Assert a (Transfer, PayoutPushed) pair at logs[i]/logs[i+1] delivering
    ///      `amount` to `beneficiary`. Transfer is the token's, PayoutPushed the core's.
    function assertPushedInOrder(Vm.Log[] memory logs, uint256 i, address beneficiary, uint96 amount) internal pure {
        assertEq(logs[i].topics[0], keccak256("Transfer(address,address,uint256)"), "token Transfer precedes push");
        assertEq(address(uint160(uint256(logs[i].topics[2]))), beneficiary, "Transfer to beneficiary");
        assertEq(abi.decode(logs[i].data, (uint256)), amount, "Transfer amount");

        assertEq(logs[i + 1].topics[0], AHandCore.PayoutPushed.selector, "PayoutPushed follows");
        assertEq(address(uint160(uint256(logs[i + 1].topics[3]))), beneficiary, "pushed to beneficiary");
        assertEq(abi.decode(logs[i + 1].data, (uint96)), amount, "pushed amount");
    }

    /*──────────────── golden fixture from the design doc ────────────────*/

    /// $20 pool, 1000 bps charity, claims telescope q = [10000, 9500, 9500, 9000]:
    /// charity 2.00, margins 0.90 / 0.00 / 0.90, giver 16.20 (6-dec units).
    /// Three RouteHopSettled, exactly four PayoutAllocated, in the frozen order:
    /// Settled -> hops -> Charity -> ShakerMargin (margin > 0 only) -> GiverResidual;
    /// then each allocation is PUSHED (Transfer + PayoutPushed) in the same order.
    function test_Golden_TwentyDollarFixture() public {
        RaiseParams memory p = defaultParams();
        p.amount = 20e6;
        uint256 h = makeRaise(p);

        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_500); // margin 500 -> 0.90
        addSelfHop(r, h, E2, 9_500);                          // margin 0, self-attributed
        addExplicitHop(r, h, E3, shakerB, SHAKER_B_PK, 9_000); // margin 500 -> 0.90

        vm.recordLogs();
        settle(h, r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Hybrid push: the exact allocation set lands in recipient wallets.
        assertEq(paidOf(charity), 2_000_000, "charity 2.00");
        assertEq(paidOf(shakerA), 900_000, "hop 0 margin 0.90");
        assertEq(paidOf(vm.addr(E1)), 0, "hop 1 zero margin pays nothing");
        assertEq(paidOf(shakerB), 900_000, "hop 2 margin 0.90");
        assertEq(paidOf(giver), 16_200_000, "giver 16.20");
        assertEq(
            paidOf(charity) + paidOf(shakerA) + paidOf(shakerB) + paidOf(giver),
            20e6,
            "P == C + sum(margins) + giverResidual"
        );
        // Successful pushes leave nothing in the claims ledger.
        assertEq(claimOf(charity), 0, "no deferral");
        assertEq(claimOf(giver), 0, "no deferral");

        // Event stream: Settled + 3 hops + 4 allocations, then 3 pushes
        // (charity, shakerA, shakerB, giver — but the zero-margin hop pays
        // nobody, so four beneficiaries, each a Transfer + PayoutPushed pair).
        // The four accounting events keep the frozen order at indices 0..7.
        assertEq(logs[0].topics[0], AHandCore.Settled.selector);
        for (uint256 i = 1; i <= 3; ++i) {
            assertEq(logs[i].topics[0], AHandCore.RouteHopSettled.selector, "hops in route order");
        }
        for (uint256 i = 4; i <= 7; ++i) {
            assertEq(logs[i].topics[0], AHandCore.PayoutAllocated.selector);
        }
        // Four allocations pushed: each emits a token Transfer then PayoutPushed.
        assertEq(logs.length, 8 + 4 * 2, "8 accounting logs + 4 (Transfer, PayoutPushed) pushes");
        assertPushedInOrder(logs, 8, charity, 2_000_000);
        assertPushedInOrder(logs, 10, shakerA, 900_000);
        assertPushedInOrder(logs, 12, shakerB, 900_000);
        assertPushedInOrder(logs, 14, giver, 16_200_000);

        // Settled carries the split and the USD mirror of the charity cut.
        {
            (,,,, uint96 creditedPool, uint96 distributable, uint96 giverAlloc,, uint96 charityAlloc,, uint256 charityUsd)
            = abi.decode(
                logs[0].data, (bytes32, bytes32, bytes32, address, uint96, uint96, uint96, address, uint96, uint64, uint256)
            );
            assertEq(creditedPool, 20e6);
            assertEq(distributable, 18e6);
            assertEq(giverAlloc, 16_200_000);
            assertEq(charityAlloc, 2_000_000);
            assertEq(charityUsd, 2_000_000 * uint256(USD_SCALE), "charityUsd = C * usdScaleAtRaise");
        }

        // Hop margins 0.90 / 0.00 / 0.90, every occurrence emitted.
        uint96[3] memory expectedMargins = [uint96(900_000), 0, 900_000];
        address[3] memory expectedShakers = [shakerA, vm.addr(E1), shakerB];
        for (uint256 i; i < 3; ++i) {
            (uint8 position,,,,, address shaker,,, uint96 marginAllocation) = abi.decode(
                logs[1 + i].data, (uint8, address, address, uint16, uint16, address, bytes32, bytes32, uint96)
            );
            assertEq(position, uint8(i));
            assertEq(shaker, expectedShakers[i]);
            assertEq(marginAllocation, expectedMargins[i]);
        }

        // Exactly the right PayoutAllocated set, in the frozen order.
        assertPayout(logs[4], charity, AllocationKind.Charity, 0, 2_000_000);
        assertPayout(logs[5], shakerA, AllocationKind.ShakerMargin, 0, 900_000);
        assertPayout(logs[6], shakerB, AllocationKind.ShakerMargin, 2, 900_000);
        assertPayout(logs[7], giver, AllocationKind.GiverResidual, 0, 16_200_000);
    }

    function assertPayout(
        Vm.Log memory log,
        address beneficiary,
        AllocationKind kind,
        uint8 position,
        uint96 amount
    ) internal pure {
        assertEq(address(uint160(uint256(log.topics[3]))), beneficiary, "beneficiary");
        (uint8 kind_, uint8 position_, uint96 amount_) = abi.decode(log.data, (uint8, uint8, uint96));
        assertEq(kind_, uint8(kind), "kind");
        assertEq(position_, position, "routePosition");
        assertEq(amount_, amount, "amount");
    }

    /*──────────────── fuzz: exact conservation under any split ────────────────*/

    /// Any pool, any charity cut, any telescope of up to six margins:
    /// claims sum exactly to P, the giver never nets zero, and every unit
    /// of flooring dust lands on the giver.
    function testFuzz_Conservation_Exact(
        uint96 amount,
        uint16 charityBps,
        uint8 hopCount,
        uint16[6] memory rawDeltas
    ) public {
        amount = uint96(bound(amount, 10, type(uint96).max / 2));
        charityBps = uint16(bound(charityBps, 100, 3_000));
        vm.assume(uint256(amount) * charityBps >= 10_000); // raise requires C > 0
        hopCount = uint8(bound(hopCount, 0, 6));

        RaiseParams memory p = defaultParams();
        p.amount = amount;
        p.charityBps = charityBps;
        p.minGiverClaimBps = 1; // widest legal delta space
        usd.mint(raiser, amount);
        uint256 h = makeRaise(p);

        uint256 C = (uint256(amount) * charityBps) / 10_000;
        uint256 D = amount - C;

        uint256[7] memory keys = [E0, E1, E2, E3, E4, E5, E6];
        RouteBuild memory r = newRoute();
        uint16 claim = 10_000;
        uint256 marginSum;
        for (uint256 i; i < hopCount; ++i) {
            uint16 delta = uint16(bound(rawDeltas[i], 0, claim - 1)); // floor is 1 bps
            if (delta != 0 && (D * delta) / 10_000 == 0) delta = 0; // flooring-to-zero is a revert, not a target
            claim -= delta;
            addSelfHop(r, h, keys[i + 1], claim); // margin accrues to vm.addr(keys[i])
            marginSum += (D * delta) / 10_000;
        }
        // Snapshot before: self-hop shakers are vm.addr(keys[i]); a shaker can
        // repeat across hops, so read balances after a single settlement where
        // every beneficiary starts at zero. Giver may equal a hop's self-shaker
        // only if keys collide (they never do here: distinct E-keys, distinct giver).
        settle(h, r);

        assertEq(paidOf(charity), C, "charity floor cut");

        uint256 total = paidOf(charity) + paidOf(giver);
        for (uint256 i; i < hopCount; ++i) {
            total += paidOf(vm.addr(keys[i]));
        }
        assertEq(total, amount, "P == C + sum(margins) + giverResidual, exactly");

        assertEq(paidOf(giver), D - marginSum, "residual is D minus floored margins");
        assertGe(paidOf(giver), 1, "giver allocation is always at least one unit");
        assertGe(paidOf(giver), (D * claim) / 10_000, "dust lands on the giver, never below the floored share");
    }

    /*──────────────── duplicate shakers aggregate ────────────────*/

    /// The same shaker on two hops earns one claims entry summing both
    /// margins, while events keep per-occurrence granularity.
    function test_DuplicateShaker_AggregatesClaims() public {
        uint256 h = makeRaise(); // 100 USDC, 10% charity -> D = 90e6
        RouteBuild memory r = newRoute();
        addExplicitHop(r, h, E1, shakerA, SHAKER_A_PK, 9_000); // margin 1000 -> 9.0
        addExplicitHop(r, h, E2, shakerA, SHAKER_A_PK, 8_500); // margin 500  -> 4.5

        vm.recordLogs();
        settle(h, r);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Duplicate shaker: both margins are pushed to the same wallet, so the
        // summed balance delta equals the aggregate (9.0 + 4.5 = 13.5).
        assertEq(paidOf(shakerA), 13_500_000, "one wallet, both margins pushed");
        assertEq(paidOf(giver), 76_500_000);
        assertEq(paidOf(charity) + paidOf(shakerA) + paidOf(giver), uint256(DEPOSIT), "conserved");

        // Per-occurrence events survive aggregation: two ShakerMargin
        // allocations to the same beneficiary at positions 0 and 1.
        uint256 marginEvents;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != AHandCore.PayoutAllocated.selector) continue;
            (uint8 kind, uint8 position, uint96 amount) = abi.decode(logs[i].data, (uint8, uint8, uint96));
            if (kind != uint8(AllocationKind.ShakerMargin)) continue;
            assertEq(address(uint160(uint256(logs[i].topics[3]))), shakerA);
            if (position == 0) assertEq(amount, 9_000_000);
            else if (position == 1) assertEq(amount, 4_500_000);
            else fail();
            ++marginEvents;
        }
        assertEq(marginEvents, 2, "one event per occurrence");

        // Both occurrences were pushed straight through: no claim to withdraw.
        assertEq(claimOf(shakerA), 0, "aggregate delivered, not deferred");
        vm.expectRevert(ZeroClaim.selector);
        core.withdraw(address(usd), shakerA);
    }
}
