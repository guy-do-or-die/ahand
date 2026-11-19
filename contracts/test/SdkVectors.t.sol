// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {shakeStructHash, giveStructHash, digestOf, handOf, HandView} from "./Helpers.sol";

/// What Core itself answers about three signed routes, written out for the SDK: the Hand's signed
/// terms, every Shake and the Give with their signatures, and what `checkRoute` and `checkGive`
/// return for them. The SDK must reach the same hashes and recover the same signers from this file
/// alone, so its formats are pinned to Core and not to a copy of them.
///
/// The file is part of the repository. This test fails when Core no longer says what the file
/// says; `WRITE_VECTORS=true forge test --match-contract SdkVectorsTest` writes it anew.
contract SdkVectorsTest is Test {
    string constant PATH = "../packages/sdk/tests/core-vectors.json";

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
            '"routes": [\n',
            _direct(),
            ",\n",
            _oneShake(),
            ",\n",
            _threeShakes(),
            "\n]\n}\n"
        );
        if (vm.envOr("WRITE_VECTORS", false)) vm.writeFile(PATH, json);
        assertEq(vm.readFile(PATH), json);
    }

    /*//////////////////////////// the three routes ////////////////////////////*/

    /// No Shakes: the root key and the giver sign the Give.
    function _direct() internal returns (string memory) {
        vm.prank(raiser);
        uint256 id = core.raise(address(usd), REWARD, expiry, vm.addr(ROOT_PK), 200, 0, keccak256("the first ask"));
        SignedShake[] memory shakes;
        return _routeJson(id, shakes, _give(id, shakes, ROOT_PK, vm.addr(GIVER_PK), 10_000, keccak256("an answer")));
    }

    /// One Shake that keeps a tenth, on a Hand whose giver must keep at least half; the giver is
    /// paid at another address.
    function _oneShake() internal returns (string memory) {
        vm.prank(raiser);
        uint256 id = core.raise(address(usd), REWARD, expiry, vm.addr(ROOT_PK), 300, 5_000, keccak256("the second ask"));
        SignedShake[] memory shakes = new SignedShake[](1);
        shakes[0] =
            _shake(id, ROOT_PK, Shake(vm.addr(FIRST_PK), makeAddr("first shaker"), 10_000, 9_000, keccak256("why")));
        return _routeJson(id, shakes, _give(id, shakes, FIRST_PK, makeAddr("giver's payee"), 9_000, bytes32(0)));
    }

    /// Three Shakes, the middle one without a payee and without a margin, on a Hand without a
    /// reward and with the largest payout gas.
    function _threeShakes() internal returns (string memory) {
        vm.prank(raiser);
        uint256 id =
            core.raise(address(usd), 0, expiry, vm.addr(ROOT_PK), type(uint16).max, 8_000, keccak256("the third ask"));
        SignedShake[] memory shakes = new SignedShake[](3);
        shakes[0] =
            _shake(id, ROOT_PK, Shake(vm.addr(FIRST_PK), makeAddr("first shaker"), 10_000, 9_500, keccak256("why")));
        shakes[1] = _shake(id, FIRST_PK, Shake(vm.addr(SECOND_PK), address(0), 9_500, 9_500, bytes32(0)));
        shakes[2] = _shake(
            id, SECOND_PK, Shake(vm.addr(THIRD_PK), makeAddr("third shaker"), 9_500, 8_000, keccak256("why again"))
        );
        return _routeJson(id, shakes, _give(id, shakes, THIRD_PK, vm.addr(GIVER_PK), 8_000, keccak256("an answer")));
    }

    /*//////////////////////////// signing ////////////////////////////*/

    function _shake(uint256 id, uint256 key, Shake memory shake) internal view returns (SignedShake memory) {
        return SignedShake(shake, _sign(key, digestOf(address(core), shakeStructHash(core, id, shake))));
    }

    /// The Give at the end of `shakes`, signed with the route's last key and by the giver.
    function _give(
        uint256 id,
        SignedShake[] memory shakes,
        uint256 lastKey,
        address payee,
        uint16 claimBps,
        bytes32 dataHash
    ) internal view returns (SignedGive memory) {
        bytes32 routeHash;
        for (uint256 position; position < shakes.length; ++position) {
            routeHash = keccak256(abi.encode(routeHash, shakeStructHash(core, id, shakes[position].shake)));
        }
        Give memory give = Give(vm.addr(GIVER_PK), payee, claimBps, routeHash, dataHash);
        bytes32 digest = digestOf(address(core), giveStructHash(core, id, give));
        return SignedGive(give, _sign(lastKey, digest), _sign(GIVER_PK, digest));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
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

    /// One route: what was signed, and what Core answers when asked about it.
    function _routeJson(
        uint256 id,
        SignedShake[] memory shakes,
        SignedGive memory signedGive
    ) internal view returns (string memory) {
        (address lastKey, uint16 claimBps, bytes32 routeHash) = core.checkRoute(id, shakes);
        bytes32 giveHash = core.checkGive(id, shakes, signedGive);
        return string.concat(
            '{\n  "hand": ',
            _handJson(id),
            ',\n  "shakes": [',
            _shakesJson(shakes),
            '],\n  "give": ',
            _giveJson(signedGive),
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
