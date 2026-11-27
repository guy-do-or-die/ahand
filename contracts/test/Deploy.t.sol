// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";

import {AHandCore, Shake, Give, SignedShake, SignedGive} from "../src/AHandCore.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {MockUSD} from "./mocks/MockUSD.sol";
import {KeyAccount, KeyAccountFactory} from "./mocks/KeyAccount.sol";
import {Forwarder} from "./mocks/Forwarder.sol";
import {giveStructHash, digestOf} from "./Helpers.sol";

/// The deploy script, run as a local deploy runs it, and what its JSON says.
contract DeployTest is Test, Deploy {
    string constant OUT = "deployments/31337-forge-test.json";

    function test_coreSitsAtItsCreate2Address() public {
        vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 0));
        Deployment memory d = deploy(true);
        vm.stopBroadcast();

        address expected = vm.computeCreate2Address(SALT, keccak256(type(AHandCore).creationCode), CREATE2_FACTORY);
        assertEq(address(d.core), expected, "Core is at create2(factory, salt, initcodeHash)");
        assertEq(d.initcodeHash, keccak256(type(AHandCore).creationCode));
        assertEq(SALT, keccak256("aHand.core/1"));
        assertGt(address(d.core).code.length, 0, "code is there");
        assertEq(d.runtimeHash, keccak256(address(d.core).code));

        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,) =
            d.core.eip712Domain();
        assertEq(name, "aHand");
        assertEq(version, "core");
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(d.core));
    }

    function test_testContractsAndMints() public {
        vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 0));
        Deployment memory d = deploy(true);
        vm.stopBroadcast();

        for (uint32 i = 1; i <= 5; ++i) {
            address account = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i));
            assertEq(MockUSD(d.usd).balanceOf(account), MINT);
            assertEq(MockUSD(d.blacklist).balanceOf(account), MINT);
        }
        assertGt(d.forwarder.code.length, 0);
        assertGt(d.accountFactory.code.length, 0);
    }

    function test_secondRunKeepsWhatIsThere() public {
        vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 0));
        Deployment memory first = deploy(true);
        Deployment memory second = deploy(true);
        vm.stopBroadcast();

        assertEq(address(second.core), address(first.core));
        assertEq(second.usd, first.usd);
        assertEq(second.deployBlock, 0, "an existing Core gives no deploy block");
        assertEq(MockUSD(first.usd).balanceOf(vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 1))), MINT, "no second mint");
    }

    function test_otherChainsGetCoreOnly() public {
        vm.chainId(8453);
        vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 0));
        Deployment memory d = deploy(false);
        vm.stopBroadcast();

        assertGt(address(d.core).code.length, 0);
        assertEq(d.usd, address(0));
        assertEq(d.forwarder, address(0));
        assertEq(d.accountFactory, address(0));

        string memory json = toJson(d, "", "");
        assertEq(vm.parseJsonUint(json, ".chainId"), 8453);
        assertTrue(vm.indexOf(json, '"tokens":[]') != type(uint256).max, "no tokens");
        assertTrue(vm.indexOf(json, '"forwarder":null,"accountFactory":null') != type(uint256).max, "both null");
    }

    function test_jsonHasEveryField() public {
        vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 0));
        Deployment memory d = deploy(true);
        vm.stopBroadcast();

        // Passed as arguments, not set with vm.setEnv: the environment is shared by tests that run
        // in parallel.
        vm.createDir("deployments", true);
        vm.writeJson(toJson(d, "0123456789abcdef0123456789abcdef01234567", "true"), OUT);
        string memory json = vm.readFile(OUT);
        vm.removeFile(OUT);

        string[18] memory fields = [
            "chainId",
            "core",
            "factory",
            "salt",
            "initcodeHash",
            "runtimeHash",
            "deployBlock",
            "tokens",
            "forwarder",
            "accountFactory",
            "commit",
            "dirty",
            "solc",
            "optimizerRuns",
            "evmVersion",
            "oz",
            "tokens[0].kind",
            "tokens[1].kind"
        ];
        for (uint256 i; i < fields.length; ++i) {
            assertTrue(vm.keyExistsJson(json, string.concat(".", fields[i])), fields[i]);
        }
        assertEq(vm.parseJsonAddress(json, ".core"), address(d.core));
        assertEq(vm.parseJsonAddress(json, ".factory"), CREATE2_FACTORY);
        assertEq(vm.parseJsonBytes32(json, ".salt"), SALT);
        assertEq(vm.parseJsonBytes32(json, ".initcodeHash"), keccak256(type(AHandCore).creationCode));
        assertEq(
            vm.computeCreate2Address(
                vm.parseJsonBytes32(json, ".salt"),
                vm.parseJsonBytes32(json, ".initcodeHash"),
                vm.parseJsonAddress(json, ".factory")
            ),
            vm.parseJsonAddress(json, ".core"),
            "the JSON alone derives the Core's address"
        );
        assertEq(vm.parseJsonAddress(json, ".forwarder"), d.forwarder);
        assertEq(vm.parseJsonAddress(json, ".accountFactory"), d.accountFactory);
        assertEq(vm.parseJsonAddress(json, ".tokens[0].address"), d.usd);
        assertEq(vm.parseJsonString(json, ".tokens[0].symbol"), "mUSD");
        assertEq(vm.parseJsonUint(json, ".tokens[0].decimals"), 6);
        assertEq(vm.parseJsonString(json, ".tokens[1].kind"), "blacklist");
        assertEq(vm.parseJsonString(json, ".commit"), "0123456789abcdef0123456789abcdef01234567");
        assertTrue(vm.parseJsonBool(json, ".dirty"));
        assertEq(vm.parseJsonString(json, ".solc"), "0.8.35");
        assertEq(vm.parseJsonUint(json, ".optimizerRuns"), 200);
        assertEq(vm.parseJsonString(json, ".evmVersion"), "prague");
        assertEq(vm.parseJsonString(json, ".oz"), "5.6.1");
    }

    function test_writingOutsideDeploymentsIsRefused() public {
        Deployment memory d;
        vm.expectRevert();
        this.writeAt(toJson(d, "", ""), "/tmp/ahand-deploy-test.json");
    }

    function writeAt(string memory json, string memory path) external {
        vm.writeJson(json, path);
    }

    function test_emptyCommitAndDirtyAreNull() public {
        Deployment memory d;
        string memory json = toJson(d, "", "");
        assertTrue(vm.indexOf(json, '"commit":null,"dirty":null') != type(uint256).max, "both null");
    }

    function test_badCommitOrDirtyIsRefused() public {
        Deployment memory d;
        vm.expectRevert("Deploy: DEPLOY_COMMIT must be a 40-digit commit");
        this.jsonOf(d, "abc", "");
        vm.expectRevert("Deploy: DEPLOY_COMMIT must be lowercase hex");
        this.jsonOf(d, "0123456789ABCDEF0123456789abcdef01234567", "");
        vm.expectRevert("Deploy: DEPLOY_DIRTY must be true or false");
        this.jsonOf(d, "", "yes");
    }

    function jsonOf(
        Deployment memory d,
        string memory commit,
        string memory dirty
    ) external view returns (string memory) {
        return toJson(d, commit, dirty);
    }
}

/// The Core recorded on Base Sepolia is the Core this tree builds: offline, from the committed
/// deployment file alone. If Core's source or its build settings (foundry.toml: compiler, optimizer,
/// evm_version, remappings) change, its initcode hash changes and this fails, because the new Core
/// would sit at another address.
contract DeploymentRecordTest is Test {
    string constant RECORD = "deployments/84532.json";
    /// @dev aHand's Core on every chain: what contracts/exit/ahand.sh pins.
    address constant PINNED_CORE = 0x0f0555972388151D2C187f636A0855b6eE9B9685;
    address constant FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function test_deployment_baseSepoliaCoreIsTheCoreThisTreeBuilds() public view {
        string memory record = vm.readFile(RECORD);
        bytes32 initcodeHash = vm.parseJsonBytes32(record, ".initcodeHash");
        bytes32 salt = vm.parseJsonBytes32(record, ".salt");
        address factory = vm.parseJsonAddress(record, ".factory");
        address core = vm.parseJsonAddress(record, ".core");

        assertEq(vm.parseJsonUint(record, ".chainId"), 84532);
        assertEq(keccak256(type(AHandCore).creationCode), initcodeHash, "this tree builds the recorded initcode");
        assertEq(salt, keccak256("aHand.core/1"), "salt");
        assertEq(factory, FACTORY, "the deterministic deployer");
        assertEq(
            vm.computeCreate2Address(salt, initcodeHash, factory), core, "core = create2(factory, salt, initcodeHash)"
        );
        assertEq(core, PINNED_CORE, "the pinned address");
        assertEq(CREATE2_FACTORY, FACTORY, "forge's CREATE2 deployer is the same one");
    }
}

/// A giver whose smart account is not deployed yet (it signed with an ERC-6492 wrapper): Core refuses
/// the Give until the account exists, and the forwarder, which holds nothing, can create it and ask
/// Core in one call.
contract KeyAccountGiveTest is Test {
    AHandCore core;
    MockUSD usd;
    KeyAccountFactory factory;
    Forwarder forwarder;

    address raiser = makeAddr("raiser");
    uint256 rootPk = 0xA11CE;
    uint256 ownerPk = 0xB0B;
    address owner;
    address account;
    uint256 handId;

    function setUp() public {
        core = new AHandCore();
        usd = new MockUSD();
        factory = new KeyAccountFactory();
        forwarder = new Forwarder();
        owner = vm.addr(ownerPk);
        account = factory.getAddress(owner, 7);

        usd.mint(raiser, 100e6);
        vm.startPrank(raiser);
        usd.approve(address(core), 100e6);
        handId = core.raise(address(usd), 100e6, uint40(block.timestamp + 1 days), vm.addr(rootPk), 250, 0, 0);
        vm.stopPrank();
    }

    function _signedGive() internal view returns (SignedShake[] memory shakes, SignedGive memory signed) {
        shakes = new SignedShake[](0);
        (, uint16 claim, bytes32 routeHash) = core.checkRoute(handId, shakes);
        Give memory give = Give({signer: account, payee: account, claimBps: claim, routeHash: routeHash, dataHash: 0});
        bytes32 digest = digestOf(address(core), giveStructHash(core, handId, give));
        signed = SignedGive({give: give, keySig: _sign(rootPk, digest), giverSig: _sign(ownerPk, digest)});
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_factoryIsCreate2AndIdempotent() public {
        assertEq(account.code.length, 0);
        address created = address(factory.createAccount(owner, 7));
        assertEq(created, account);
        assertEq(KeyAccount(payable(created)).owner(), owner);
        assertEq(address(factory.createAccount(owner, 7)), account, "a second call returns the same account");
        assertTrue(factory.getAddress(owner, 8) != account);
        assertTrue(factory.getAddress(makeAddr("other"), 7) != account);
    }

    function test_accountAcceptsOnlyItsOwner() public {
        KeyAccount acc = factory.createAccount(owner, 7);
        bytes32 digest = keccak256("anything");
        assertEq(acc.isValidSignature(digest, _sign(ownerPk, digest)), KeyAccount.isValidSignature.selector);
        assertEq(acc.isValidSignature(digest, _sign(rootPk, digest)), bytes4(0));
        assertEq(acc.isValidSignature(digest, hex"1234"), bytes4(0), "unreadable: refused, no revert");
    }

    function test_giveFailsBeforeTheAccountExists() public {
        (SignedShake[] memory shakes, SignedGive memory signed) = _signedGive();
        vm.expectRevert(AHandCore.InvalidGiverSig.selector);
        core.checkGive(handId, shakes, signed);
    }

    function test_givePassesOnceTheForwarderCalledTheFactory() public {
        (SignedShake[] memory shakes, SignedGive memory signed) = _signedGive();

        Forwarder.Call3[] memory calls = new Forwarder.Call3[](2);
        calls[0] = Forwarder.Call3(address(factory), false, abi.encodeCall(factory.createAccount, (owner, 7)));
        calls[1] = Forwarder.Call3(address(core), false, abi.encodeCall(core.checkGive, (handId, shakes, signed)));
        Forwarder.Result[] memory results = forwarder.aggregate3(calls);

        bytes32 giveHash = abi.decode(results[1].returnData, (bytes32));
        assertEq(giveHash, giveStructHash(core, handId, signed.give));
        assertEq(core.checkGive(handId, shakes, signed), giveHash, "and directly, now that the code is there");

        uint256 before = usd.balanceOf(account);
        vm.prank(raiser);
        core.thank(handId, shakes, signed, 0);
        assertEq(usd.balanceOf(account), before + 100e6, "the account was paid");

        // its owner can move what it holds
        vm.prank(owner);
        KeyAccount(payable(account)).execute(address(usd), 0, abi.encodeCall(usd.transfer, (owner, 100e6)));
        assertEq(usd.balanceOf(owner), 100e6);
    }

    function test_forwarderFailsLikeMulticall3() public {
        (SignedShake[] memory shakes, SignedGive memory signed) = _signedGive();
        Forwarder.Call3[] memory calls = new Forwarder.Call3[](1);
        calls[0] = Forwarder.Call3(address(core), false, abi.encodeCall(core.checkGive, (handId, shakes, signed)));
        vm.expectRevert(bytes("Multicall3: call failed"));
        forwarder.aggregate3(calls);

        calls[0].allowFailure = true;
        Forwarder.Result[] memory results = forwarder.aggregate3(calls);
        assertFalse(results[0].success);
        assertEq(bytes4(results[0].returnData), AHandCore.InvalidGiverSig.selector, "the refusal comes back as data");
    }

    /// A hostile "setup call" names the token as the factory. Through the forwarder it acts as a
    /// stranger with nothing and no allowance: the raiser who sends it loses nothing.
    function test_hostileSetupThroughTheForwarderMovesNothing() public {
        address thief = makeAddr("thief");
        usd.mint(raiser, 50e6);

        Forwarder.Call3[] memory calls = new Forwarder.Call3[](2);
        calls[0] = Forwarder.Call3(address(usd), true, abi.encodeCall(usd.transfer, (thief, 50e6)));
        calls[1] = Forwarder.Call3(address(usd), true, abi.encodeCall(usd.transferFrom, (raiser, thief, 50e6)));
        vm.prank(raiser);
        Forwarder.Result[] memory results = forwarder.aggregate3(calls);

        assertFalse(results[0].success);
        assertFalse(results[1].success);
        assertEq(usd.balanceOf(raiser), 50e6);
        assertEq(usd.balanceOf(thief), 0);
    }

    function test_onlyTheOwnerExecutes() public {
        KeyAccount acc = factory.createAccount(owner, 7);
        vm.expectRevert(KeyAccount.NotOwner.selector);
        acc.execute(address(usd), 0, "");
    }
}
