// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {shakeStructHash, giveStructHash, digestOf, handOf, HandView} from "./Helpers.sol";

/// What Core itself answers about signed routes, written out for the SDK: the Hand's signed terms,
/// every Shake and the Give with their signatures, and what `checkRoute` and `checkGive` return
/// for them or which error they refuse them with. The SDK must reach the same hashes, sign the same
/// bytes with the same keys and name the same refusals from this file alone, so its formats and
/// its checks are pinned to Core and not to a copy of them.
///
/// The file is part of the repository. This test fails when Core no longer says what the file
/// says; `WRITE_VECTORS=true forge test --match-contract SdkVectorsTest` writes it anew.
contract SdkVectorsTest is Test {
    string constant PATH = "test/fixtures/sdk-vectors.json";

    // Keys of this test only, written into the file so that the SDK can sign with them too.
    uint256 constant ROOT_PK = 0xA0A0; // the link's root key
    uint256 constant FIRST_PK = 0xB0B0; // the keys the Shakes pass the Hand to, in route order
    uint256 constant SECOND_PK = 0xC0C0;
    uint256 constant THIRD_PK = 0xD0D0;
    uint256 constant GIVER_PK = 0xCA401;
    uint256 constant REWARD = 100e6;

    AHandCore core;
    MockUSD usd;
    address raiser;
    uint40 expiry;

    function setUp() public {
        core = new AHandCore();
        usd = new MockUSD();
        raiser = makeAddr("raiser");
        expiry = uint40(block.timestamp + 30 days);
        usd.mint(raiser, 3 * REWARD);
        vm.prank(raiser);
        usd.approve(address(core), type(uint256).max);
    }

    function test_vectors_sdkFixturesAreWhatCoreSays() public {
        string memory json = string.concat(
            "{\n",
            '"domain": ',
            _domainJson(),
            ",\n",
            '"keys": ',
            _keysJson(),
            ",\n",
            '"data": ',
            _dataJson(),
            ",\n",
            '"routes": [\n',
            _direct(),
            ",\n",
            _oneShake(),
            ",\n",
            _threeShakes(),
            "\n],\n",
            '"refusals": [\n',
            _refusals(),
            "\n]\n}\n"
        );
        if (vm.envOr("WRITE_VECTORS", false)) vm.writeFile(PATH, json);
        assertEq(vm.readFile(PATH), json);
    }

    /*//////////////////////////// a list of statements ////////////////////////////*/

    /// What applications put behind a `dataHash`: a list of named statements, sorted by name and
    /// hashed whole under a format tag. Core never reads it; the formula is written out here so
    /// that the SDK's hash of the same list is checked against Solidity's.
    function _dataJson() internal returns (string memory) {
        bytes32 format = keccak256("aHand.data/1");
        string[4] memory texts = ["author", "content", "judge", "series"]; // sorted
        bytes32[] memory names = new bytes32[](4);
        bytes32[] memory values = new bytes32[](4);
        for (uint256 index; index < 4; ++index) {
            names[index] = bytes32(bytes(texts[index]));
        }
        values[0] = bytes32(uint256(uint160(makeAddr("author"))));
        values[1] = keccak256("Who can fix a 1978 Vespa in Lisbon?");
        values[2] = bytes32(uint256(uint160(makeAddr("judge"))));
        values[3] = bytes32(uint256(7));

        string memory statements;
        for (uint256 index; index < 4; ++index) {
            statements = string.concat(
                statements,
                index == 0 ? "\n    " : ",\n    ",
                '{"name": "',
                texts[index],
                '", "value": "',
                vm.toString(values[index]),
                '"}'
            );
        }
        return string.concat(
            '{\n  "format": "',
            vm.toString(format),
            '",\n  "statements": [',
            statements,
            '\n  ],\n  "dataHash": "',
            vm.toString(keccak256(abi.encode(format, names, values))),
            '"\n}'
        );
    }

    /*//////////////////////////// routes Core accepts ////////////////////////////*/

    /// No Shakes: the root key and the giver sign the Give.
    function _direct() internal returns (string memory) {
        uint256 id = _raise(REWARD, 200, 0, "the first ask");
        SignedShake[] memory shakes;
        Give memory give = Give(vm.addr(GIVER_PK), vm.addr(GIVER_PK), 10_000, bytes32(0), keccak256("an answer"));
        return _routeJson(id, shakes, _signGive(id, give, ROOT_PK, GIVER_PK));
    }

    /// One Shake that keeps a tenth, on a Hand whose giver must keep at least half; the giver is
    /// paid at another address.
    function _oneShake() internal returns (string memory) {
        uint256 id = _raise(REWARD, 300, 5_000, "the second ask");
        Shake[] memory route = new Shake[](1);
        route[0] = Shake(vm.addr(FIRST_PK), makeAddr("first shaker"), 10_000, 9_000, keccak256("why"));
        SignedShake[] memory shakes = _signRoute(id, route);
        Give memory give = Give(vm.addr(GIVER_PK), makeAddr("giver's payee"), 9_000, _routeHash(id, route), bytes32(0));
        return _routeJson(id, shakes, _signGive(id, give, FIRST_PK, GIVER_PK));
    }

    /// Three Shakes, the middle one without a payee and without a margin, on a Hand without a
    /// reward and with the largest payout gas.
    function _threeShakes() internal returns (string memory) {
        uint256 id = _raise(0, type(uint16).max, 8_000, "the third ask");
        Shake[] memory route = _threeShakeRoute();
        return _routeJson(id, _signRoute(id, route), _signGive(id, _giveAfter(id, route), THIRD_PK, GIVER_PK));
    }

    function _raise(
        uint256 reward,
        uint16 payoutGasK,
        uint16 minClaimBps,
        string memory ask
    ) internal returns (uint256) {
        vm.prank(raiser);
        return
            core.raise(address(usd), reward, expiry, vm.addr(ROOT_PK), payoutGasK, minClaimBps, keccak256(bytes(ask)));
    }

    /// The route of three Shakes that leaves the giver 80 %.
    function _threeShakeRoute() internal returns (Shake[] memory route) {
        route = new Shake[](3);
        route[0] = Shake(vm.addr(FIRST_PK), makeAddr("first shaker"), 10_000, 9_500, keccak256("why"));
        route[1] = Shake(vm.addr(SECOND_PK), address(0), 9_500, 9_500, bytes32(0));
        route[2] = Shake(vm.addr(THIRD_PK), makeAddr("third shaker"), 9_500, 8_000, keccak256("why again"));
    }

    /// The giver's Give at the end of `route`, for the claim the route's last Shake passes on.
    function _giveAfter(uint256 id, Shake[] memory route) internal view returns (Give memory) {
        return Give(
            vm.addr(GIVER_PK),
            vm.addr(GIVER_PK),
            route[route.length - 1].nextClaimBps,
            _routeHash(id, route),
            keccak256("an answer")
        );
    }

    /*//////////////////////////// routes Core refuses ////////////////////////////*/

    /// The route of three Shakes with one thing wrong at a time, and once with several: what was
    /// signed and the error `checkGive` refuses it with.
    function _refusals() internal returns (string memory) {
        uint256 id = _raise(0, 200, 8_000, "the ask of the refused routes");
        return string.concat(
            _wrongShakes(id),
            ",\n",
            _wrongGives(id),
            ",\n",
            _belowTheMinimum(),
            ",\n",
            _wrongSignatures(id),
            ",\n",
            _severalWrong(id),
            ",\n",
            _orderOfChecks(id)
        );
    }

    function _wrongShakes(uint256 id) internal returns (string memory json) {
        Shake[] memory route = _threeShakeRoute();
        route[1].claimBps = 9_000;
        json = _refused("a Shake starts from another claim than the one that reached it", id, route);

        route = _threeShakeRoute();
        route[2].nextClaimBps = 9_600;
        json = string.concat(json, ",\n", _refused("a Shake passes on more than reached it", id, route));

        route = _threeShakeRoute();
        route[1].nextClaimBps = 9_400;
        json = string.concat(json, ",\n", _refused("a Shake without a payee keeps a margin", id, route));
    }

    function _wrongGives(uint256 id) internal returns (string memory json) {
        Shake[] memory route = _threeShakeRoute();
        SignedShake[] memory shakes = _signRoute(id, route);

        Give memory give = _giveAfter(id, route);
        give.claimBps = 8_100;
        json = _refusalJson(
            "the Give claims more than the route left", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK)
        );

        give = _giveAfter(id, route);
        give.routeHash = keccak256("another route");
        json = string.concat(
            json,
            ",\n",
            _refusalJson("the Give names another route", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK))
        );

        give = _giveAfter(id, route);
        give.signer = raiser;
        json = string.concat(
            json,
            ",\n",
            _refusalJson("the Give's signer is the raiser", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK))
        );

        give = _giveAfter(id, route);
        give.payee = address(0);
        json = string.concat(
            json, ",\n", _refusalJson("the Give names no payee", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK))
        );
    }

    /// The same route on a Hand whose giver must keep nine tenths.
    function _belowTheMinimum() internal returns (string memory) {
        uint256 id = _raise(0, 200, 9_000, "the ask whose giver keeps nine tenths");
        return _refused("the route leaves the giver less than the Hand's minimum", id, _threeShakeRoute());
    }

    function _wrongSignatures(uint256 id) internal returns (string memory json) {
        Shake[] memory route = _threeShakeRoute();
        Give memory give = _giveAfter(id, route);

        SignedShake[] memory shakes = _signRoute(id, route);
        shakes[2].keySig = _sign(GIVER_PK, digestOf(address(core), shakeStructHash(core, id, route[2])));
        json = _refusalJson("a Shake signed by another key", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK));

        shakes = _signRoute(id, route);
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "the Give signed with another key than the route's last",
                id,
                shakes,
                _signGive(id, give, SECOND_PK, GIVER_PK)
            )
        );
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "the Give signed by another key than its signer's", id, shakes, _signGive(id, give, THIRD_PK, THIRD_PK)
            )
        );

        SignedGive memory short = _signGive(id, give, THIRD_PK, GIVER_PK);
        short.giverSig = _shortForm(short.giverSig);
        json = string.concat(json, ",\n", _refusalJson("the giver's signature in the short form", id, shakes, short));

        shakes[0].keySig = _shortForm(shakes[0].keySig);
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "a link key's signature in the short form", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK)
            )
        );

        // The two other forms of the same signature that ecrecover takes and Core does not.
        shakes = _signRoute(id, route);
        shakes[0].keySig = _upperS(shakes[0].keySig);
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "a link key's signature with s in the upper half", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK)
            )
        );
        shakes = _signRoute(id, route);
        shakes[0].keySig = _vFromZero(shakes[0].keySig);
        json = string.concat(
            json,
            ",\n",
            _refusalJson("a link key's signature with v 0 or 1", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK))
        );

        shakes = _signRoute(id, route);
        SignedGive memory upper = _signGive(id, give, THIRD_PK, GIVER_PK);
        upper.giverSig = _upperS(upper.giverSig);
        json = string.concat(
            json, ",\n", _refusalJson("the giver's signature with s in the upper half", id, shakes, upper)
        );
        SignedGive memory fromZero = _signGive(id, give, THIRD_PK, GIVER_PK);
        fromZero.giverSig = _vFromZero(fromZero.giverSig);
        json = string.concat(json, ",\n", _refusalJson("the giver's signature with v 0 or 1", id, shakes, fromZero));
    }

    /// No payee, a claim the route did not leave and another route's hash: the first in the order
    /// of Core's checks is the one named.
    function _severalWrong(uint256 id) internal returns (string memory) {
        Shake[] memory route = _threeShakeRoute();
        Give memory give = _giveAfter(id, route);
        give.payee = address(0);
        give.claimBps = 8_100;
        give.routeHash = keccak256("another route");
        return _refusalJson(
            "several things wrong: the first in the order of Core's checks is named",
            id,
            _signRoute(id, route),
            _signGive(id, give, THIRD_PK, GIVER_PK)
        );
    }

    /// Two things wrong at a time, each pair next to each other in the order of Core's checks: the
    /// earlier one is named.
    function _orderOfChecks(uint256 id) internal returns (string memory json) {
        Shake[] memory route = _threeShakeRoute();
        SignedShake[] memory shakes = _signRoute(id, route);

        Give memory give = _giveAfter(id, route);
        give.signer = raiser;
        give.payee = address(0);
        json = _refusalJson(
            "the signer is the raiser and there is no payee", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK)
        );

        give = _giveAfter(id, route);
        give.payee = address(0);
        route[1].claimBps = 9_000;
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "no payee and a Shake that starts from another claim",
                id,
                _signRoute(id, route),
                _signGive(id, give, THIRD_PK, GIVER_PK)
            )
        );

        give = _giveAfter(id, route);
        give.claimBps = 8_100;
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "a Shake that starts from another claim and a Give that claims more",
                id,
                _signRoute(id, route),
                _signGive(id, give, THIRD_PK, GIVER_PK)
            )
        );

        route = _threeShakeRoute();
        shakes = _signRoute(id, route); // signed anew: the Shakes above were changed in place
        give = _giveAfter(id, route);
        give.claimBps = 8_100;
        give.routeHash = keccak256("another route");
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "a Give that claims more and names another route", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK)
            )
        );
        json = string.concat(json, ",\n", _orderAfterTheRoute());
    }

    /// The later half of the order, on the Hand whose giver must keep nine tenths.
    function _orderAfterTheRoute() internal returns (string memory json) {
        uint256 id = _raise(0, 200, 9_000, "the ask for the order of the later checks");
        Shake[] memory route = _threeShakeRoute();
        SignedShake[] memory shakes = _signRoute(id, route);

        Give memory give = _giveAfter(id, route);
        give.routeHash = keccak256("another route");
        json = _refusalJson(
            "another route and less than the Hand's minimum", id, shakes, _signGive(id, give, THIRD_PK, GIVER_PK)
        );

        give = _giveAfter(id, route);
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "less than the Hand's minimum and another key than the route's last",
                id,
                shakes,
                _signGive(id, give, SECOND_PK, GIVER_PK)
            )
        );

        id = _raise(0, 200, 8_000, "the ask for the order of the two signatures");
        json = string.concat(
            json,
            ",\n",
            _refusalJson(
                "another key than the route's last and another key than the signer's",
                id,
                _signRoute(id, route),
                _signGive(id, _giveAfter(id, route), SECOND_PK, THIRD_PK)
            )
        );
    }

    /// `route`, properly signed and ended by a properly signed Give for what it passes on.
    function _refused(string memory what, uint256 id, Shake[] memory route) internal view returns (string memory) {
        return _refusalJson(what, id, _signRoute(id, route), _signGive(id, _giveAfter(id, route), THIRD_PK, GIVER_PK));
    }

    /*//////////////////////////// signing ////////////////////////////*/

    /// Every Shake signed by the key the one before it passes the Hand to; the first by the root key.
    function _signRoute(uint256 id, Shake[] memory route) internal view returns (SignedShake[] memory shakes) {
        uint256[3] memory keys = [ROOT_PK, FIRST_PK, SECOND_PK];
        shakes = new SignedShake[](route.length);
        for (uint256 position; position < route.length; ++position) {
            bytes32 digest = digestOf(address(core), shakeStructHash(core, id, route[position]));
            shakes[position] = SignedShake(route[position], _sign(keys[position], digest));
        }
    }

    function _signGive(
        uint256 id,
        Give memory give,
        uint256 lastKey,
        uint256 giverKey
    ) internal view returns (SignedGive memory) {
        bytes32 digest = digestOf(address(core), giveStructHash(core, id, give));
        return SignedGive(give, _sign(lastKey, digest), _sign(giverKey, digest));
    }

    function _routeHash(uint256 id, Shake[] memory route) internal view returns (bytes32 routeHash) {
        for (uint256 position; position < route.length; ++position) {
            routeHash = keccak256(abi.encode(routeHash, shakeStructHash(core, id, route[position])));
        }
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The ERC-2098 form of a 65-byte signature: `r`, then `s` with the parity of `v` in its top bit.
    function _shortForm(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 sValue, uint8 v) = _parts(sig);
        return abi.encodePacked(r, bytes32(uint256(sValue) | (uint256(v - 27) << 255)));
    }

    /// The same signature with `s` in the upper half: the curve's order (forge-std's `SECP256K1_ORDER`)
    /// minus `s`, and the other `v`.
    function _upperS(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 sValue, uint8 v) = _parts(sig);
        return abi.encodePacked(r, bytes32(SECP256K1_ORDER - uint256(sValue)), v == 27 ? uint8(28) : uint8(27));
    }

    /// The same signature with `v` as 0 or 1 instead of 27 or 28, as some wallets return it.
    function _vFromZero(bytes memory sig) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 sValue, uint8 v) = _parts(sig);
        return abi.encodePacked(r, sValue, v - 27);
    }

    function _parts(bytes memory sig) internal pure returns (bytes32 r, bytes32 sValue, uint8 v) {
        assembly ("memory-safe") {
            r := mload(add(sig, 0x20))
            sValue := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
    }

    /*//////////////////////////// writing ////////////////////////////*/

    function _domainJson() internal view returns (string memory) {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            core.eip712Domain();
        return string.concat(
            '{"name": "',
            name,
            '", "version": "',
            version,
            '", "chainId": ',
            vm.toString(chainId),
            ', "verifyingContract": "',
            vm.toString(verifyingContract),
            '"}'
        );
    }

    function _keysJson() internal pure returns (string memory) {
        return string.concat(
            '{"root": "',
            vm.toString(bytes32(ROOT_PK)),
            '", "first": "',
            vm.toString(bytes32(FIRST_PK)),
            '", "second": "',
            vm.toString(bytes32(SECOND_PK)),
            '", "third": "',
            vm.toString(bytes32(THIRD_PK)),
            '", "giver": "',
            vm.toString(bytes32(GIVER_PK)),
            '"}'
        );
    }

    /// One accepted route: what was signed, and what Core answers when asked about it.
    function _routeJson(
        uint256 id,
        SignedShake[] memory shakes,
        SignedGive memory signedGive
    ) internal view returns (string memory) {
        (address lastKey, uint16 claimBps, bytes32 routeHash) = core.checkRoute(id, shakes);
        bytes32 giveHash = core.checkGive(id, shakes, signedGive);
        return string.concat(
            _signedJson(id, shakes, signedGive),
            ',\n  "core": {"lastKey": "',
            vm.toString(lastKey),
            '", "claimBps": ',
            vm.toString(claimBps),
            ', "routeHash": "',
            vm.toString(routeHash),
            '", "giveHash": "',
            vm.toString(giveHash),
            '"}\n}'
        );
    }

    /// One refused route: what was signed, and the error `checkGive` reverts with.
    function _refusalJson(
        string memory what,
        uint256 id,
        SignedShake[] memory shakes,
        SignedGive memory signedGive
    ) internal view returns (string memory) {
        string memory error;
        try core.checkGive(id, shakes, signedGive) {
            revert("Core accepted a route this test means to be refused");
        } catch (bytes memory reason) {
            error = _errorJson(reason);
        }
        return
            string.concat(_signedJson(id, shakes, signedGive), ',\n  "what": "', what, '",\n  "error": ', error, "\n}");
    }

    function _signedJson(
        uint256 id,
        SignedShake[] memory shakes,
        SignedGive memory signedGive
    ) internal view returns (string memory) {
        return string.concat(
            '{\n  "hand": ',
            _handJson(id),
            ',\n  "shakes": [',
            _shakesJson(shakes),
            '],\n  "give": ',
            _giveJson(signedGive)
        );
    }

    /// The error's name, and its position for the three errors that carry one.
    function _errorJson(bytes memory reason) internal pure returns (string memory) {
        bytes4 selector = bytes4(reason);
        uint256 position;
        assembly ("memory-safe") {
            position := mload(add(reason, 0x24))
        }
        if (selector == AHandCore.InvalidClaim.selector) return _positioned("InvalidClaim", position);
        if (selector == AHandCore.AnonymousMargin.selector) return _positioned("AnonymousMargin", position);
        if (selector == AHandCore.InvalidKeySig.selector) return _positioned("InvalidKeySig", position);
        if (selector == AHandCore.GiverIsRaiser.selector) return '{"name": "GiverIsRaiser"}';
        if (selector == AHandCore.ZeroPayee.selector) return '{"name": "ZeroPayee"}';
        if (selector == AHandCore.InvalidRouteHash.selector) return '{"name": "InvalidRouteHash"}';
        if (selector == AHandCore.BelowMinClaim.selector) return '{"name": "BelowMinClaim"}';
        if (selector == AHandCore.InvalidGiverSig.selector) return '{"name": "InvalidGiverSig"}';
        revert("an error this test does not know");
    }

    function _positioned(string memory name, uint256 position) internal pure returns (string memory) {
        return string.concat('{"name": "', name, '", "position": ', vm.toString(position), "}");
    }

    function _handJson(uint256 id) internal view returns (string memory) {
        HandView memory hand = handOf(core, id);
        return string.concat(
            '{"handId": "',
            vm.toString(id),
            '", "raiser": "',
            vm.toString(hand.raiser),
            '", "token": "',
            vm.toString(hand.token),
            '", "rootKey": "',
            vm.toString(hand.rootKey),
            '", "payoutGasK": ',
            vm.toString(hand.payoutGasK),
            ', "minClaimBps": ',
            vm.toString(hand.minClaimBps),
            ', "dataHash": "',
            vm.toString(hand.dataHash),
            '"}'
        );
    }

    function _shakesJson(SignedShake[] memory shakes) internal pure returns (string memory json) {
        for (uint256 position; position < shakes.length; ++position) {
            Shake memory shake = shakes[position].shake;
            json = string.concat(
                json,
                position == 0 ? "\n    " : ",\n    ",
                '{"nextKey": "',
                vm.toString(shake.nextKey),
                '", "payee": "',
                vm.toString(shake.payee),
                '", "claimBps": ',
                vm.toString(shake.claimBps),
                ', "nextClaimBps": ',
                vm.toString(shake.nextClaimBps),
                ', "dataHash": "',
                vm.toString(shake.dataHash),
                '", "keySig": "',
                vm.toString(shakes[position].keySig),
                '"}'
            );
        }
        if (shakes.length != 0) json = string.concat(json, "\n  ");
    }

    function _giveJson(SignedGive memory signedGive) internal pure returns (string memory) {
        Give memory give = signedGive.give;
        return string.concat(
            '{"signer": "',
            vm.toString(give.signer),
            '", "payee": "',
            vm.toString(give.payee),
            '", "claimBps": ',
            vm.toString(give.claimBps),
            ', "routeHash": "',
            vm.toString(give.routeHash),
            '", "dataHash": "',
            vm.toString(give.dataHash),
            '", "keySig": "',
            vm.toString(signedGive.keySig),
            '", "giverSig": "',
            vm.toString(signedGive.giverSig),
            '"}'
        );
    }
}
