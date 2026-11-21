// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {AHandCore} from "../src/AHandCore.sol";
import {MockUSD} from "../test/mocks/MockUSD.sol";
import {BlacklistToken} from "../test/mocks/BlacklistToken.sol";
import {KeyAccountFactory} from "../test/mocks/KeyAccount.sol";
import {Forwarder} from "../test/mocks/Forwarder.sol";

/// @notice Deploys AHandCore by CREATE2 through the deterministic deployer
///         (0x4e59b44847b379578588920cA78FbF26c0B4956C) with a named salt and no constructor
///         arguments, so its address is the same on every chain that has that deployer and
///         follows from the initcode alone: anyone who rebuilds the initcode from the source can
///         derive the address and check that the code there is this Core. On the local chain
///         (31337) only, it also deploys the test tokens, mints them to anvil accounts 1 to 5, and
///         deploys the test account factory and the forwarder. Running it again is harmless: what
///         is already there is kept, and nothing is minted twice.
///
///         With --broadcast (or --resume) it writes the deployment JSON (described in
///         deployments/README.md) to `DEPLOY_OUT`, default `deployments/<chainId>.json`; a dry run
///         writes nothing and prints it. The file is written while forge simulates, before the
///         transactions are sent: script/deploy.sh removes a new record if the broadcast fails. foundry.toml's fs_permissions refuse any path outside
///         `./deployments`. Off the local chain an existing file is never overwritten unless
///         `DEPLOY_OVERWRITE=true`: a committed record of a public chain is not rewritten by
///         accident. `DEPLOY_COMMIT` and `DEPLOY_DIRTY` fill `commit` and `dirty`
///         (script/deploy.sh sets them from git); without them both are null.
///
///         Sender: on 31337 with no sender given, anvil's public test account 0. Anywhere else the
///         caller names one: `--account <name>` (a cast keystore), `--ledger` or `--trezor`. A key
///         passed with `--private-key` shows in `ps` and stays in the shell history.
///
///         bash script/deploy.sh <rpc-url> --account <name>
///         DEPLOY_OUT=deployments/31337-local.json $FOUNDRY_BIN/forge script script/Deploy.s.sol \
///             --rpc-url http://127.0.0.1:18945 --broadcast
contract Deploy is Script {
    /// @notice The salt of the Core's CREATE2 deployment: a fixed name, so that the address
    ///         depends on Core's initcode alone.
    bytes32 public constant SALT = keccak256("aHand.core/1");

    uint256 internal constant LOCAL_CHAIN_ID = 31337;
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    /// @dev Minted to each of anvil accounts 1 to 5 in each test token: 1 000 000 at 6 decimals.
    uint256 internal constant MINT = 1_000_000e6;

    /// @dev The compiler settings this Core is built with, written into the JSON so that anyone can
    ///      rebuild the initcode. Forge cannot read foundry.toml from a script; these constants are
    ///      compared with foundry.toml and the OpenZeppelin package by script/check-deployment.sh.
    string internal constant SOLC = "0.8.35";
    uint256 internal constant OPTIMIZER_RUNS = 200;
    string internal constant EVM_VERSION = "prague";
    string internal constant OZ_VERSION = "5.6.1";

    struct Deployment {
        AHandCore core;
        bytes32 initcodeHash;
        bytes32 runtimeHash;
        /// @dev A block at or before the one holding the Core's deployment: the next block when this
        ///      run deploys it; when Core was already there, what an earlier run wrote to the same
        ///      file, else 0 (scan from genesis).
        uint256 deployBlock;
        address usd;
        address blacklist;
        address forwarder;
        address accountFactory;
    }

    function run() external returns (Deployment memory d) {
        string memory out = vm.envOr("DEPLOY_OUT", string.concat("deployments/", vm.toString(block.chainid), ".json"));
        bool local = block.chainid == LOCAL_CHAIN_ID;
        bool writes =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        // Checked before any transaction, so that a refused write leaves the chain untouched too.
        require(
            local || !writes || !vm.isFile(out) || vm.envOr("DEPLOY_OVERWRITE", false),
            "Deploy: the deployment file exists; set DEPLOY_OVERWRITE=true to write it again, or DEPLOY_OUT elsewhere"
        );

        if (local && msg.sender == DEFAULT_SENDER) vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 0));
        else vm.startBroadcast();
        d = deploy(local);
        vm.stopBroadcast();

        if (d.deployBlock == 0) d.deployBlock = _previousDeployBlock(out, address(d.core));
        string memory json = toJson(d, vm.envOr("DEPLOY_COMMIT", string("")), vm.envOr("DEPLOY_DIRTY", string("")));
        if (!writes) {
            console.log("dry run: nothing written to %s; with --broadcast it would hold:", out);
            console.log(json);
            return d;
        }
        vm.createDir("deployments", true);
        vm.writeJson(json, out);
    }

    /// @dev The deploy block an earlier run wrote to `path` for the same Core, so that running
    ///      again does not lose it; 0 when there is no such file or it names another Core.
    function _previousDeployBlock(string memory path, address core) internal view returns (uint256) {
        if (!vm.isFile(path)) return 0;
        string memory json = vm.readFile(path);
        if (!vm.keyExistsJson(json, ".core") || !vm.keyExistsJson(json, ".deployBlock")) return 0;
        if (vm.parseJsonAddress(json, ".core") != core) return 0;
        return vm.parseJsonUint(json, ".deployBlock");
    }

    /// @notice Deploys what is missing and returns where everything is. Called inside a broadcast.
    function deploy(bool local) public returns (Deployment memory d) {
        require(CREATE2_FACTORY.code.length != 0, "Deploy: no CREATE2 deployer at 0x4e59...956C on this chain");

        d.initcodeHash = keccak256(type(AHandCore).creationCode);
        address predicted = vm.computeCreate2Address(SALT, d.initcodeHash, CREATE2_FACTORY);
        if (predicted.code.length == 0) {
            d.deployBlock = block.number + 1;
            d.core = new AHandCore{salt: SALT}();
            require(address(d.core) == predicted, "Deploy: Core is not at its CREATE2 address");
        } else {
            d.core = AHandCore(predicted);
        }
        d.runtimeHash = keccak256(address(d.core).code);

        if (!local) return d;

        d.usd = _deployOnce(keccak256("aHand.test/MockUSD"), type(MockUSD).creationCode);
        d.blacklist = _deployOnce(keccak256("aHand.test/BlacklistToken"), type(BlacklistToken).creationCode);
        d.forwarder = _deployOnce(keccak256("aHand.test/Forwarder"), type(Forwarder).creationCode);
        d.accountFactory = _deployOnce(keccak256("aHand.test/KeyAccountFactory"), type(KeyAccountFactory).creationCode);
    }

    /// @dev CREATE2 through the same deployer, so the test contracts too sit at one address on
    ///      every local chain. A token deployed by this call is minted to anvil accounts 1 to 5.
    function _deployOnce(bytes32 salt, bytes memory initcode) internal returns (address deployed) {
        deployed = vm.computeCreate2Address(salt, keccak256(initcode), CREATE2_FACTORY);
        if (deployed.code.length != 0) return deployed;

        (bool ok,) = CREATE2_FACTORY.call(abi.encodePacked(salt, initcode));
        require(ok && deployed.code.length != 0, "Deploy: a test contract did not deploy");

        if (salt == keccak256("aHand.test/MockUSD") || salt == keccak256("aHand.test/BlacklistToken")) {
            for (uint32 i = 1; i <= 5; ++i) {
                MockUSD(deployed).mint(vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i)), MINT);
            }
        }
    }

    /// @notice The deployment JSON (deployments/README.md), as text. `commit` is a 40-digit
    ///         lowercase hex commit or empty, `dirty` is "true", "false" or empty; empty writes null.
    function toJson(
        Deployment memory d,
        string memory commit,
        string memory dirty
    ) public view returns (string memory) {
        bool local = d.forwarder != address(0);
        string memory tokens =
            local ? string.concat("[", _token(d.usd, "usd"), ",", _token(d.blacklist, "blacklist"), "]") : "[]";

        string memory head = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"core":"',
            vm.toString(address(d.core)),
            '","factory":"',
            vm.toString(CREATE2_FACTORY),
            '","salt":"',
            vm.toString(SALT),
            '","initcodeHash":"',
            vm.toString(d.initcodeHash),
            '","runtimeHash":"',
            vm.toString(d.runtimeHash),
            '","deployBlock":',
            vm.toString(d.deployBlock)
        );
        string memory middle = string.concat(
            ',"tokens":',
            tokens,
            ',"forwarder":',
            _addressOrNull(d.forwarder),
            ',"accountFactory":',
            _addressOrNull(d.accountFactory),
            ',"commit":',
            _commit(commit),
            ',"dirty":',
            _dirty(dirty)
        );
        string memory tail = string.concat(
            ',"solc":"',
            SOLC,
            '","optimizerRuns":',
            vm.toString(OPTIMIZER_RUNS),
            ',"evmVersion":"',
            EVM_VERSION,
            '","oz":"',
            OZ_VERSION,
            '"}'
        );
        return string.concat(head, middle, tail);
    }

    function _token(address token, string memory kind) internal view returns (string memory) {
        return string.concat(
            '{"address":"',
            vm.toString(token),
            '","symbol":"',
            MockUSD(token).symbol(),
            '","decimals":',
            vm.toString(uint256(MockUSD(token).decimals())),
            ',"kind":"',
            kind,
            '"}'
        );
    }

    function _addressOrNull(address a) internal pure returns (string memory) {
        return a == address(0) ? "null" : string.concat('"', vm.toString(a), '"');
    }

    /// @dev A 40-digit hex commit, or null when empty; anything else is refused.
    function _commit(string memory commit) internal pure returns (string memory) {
        bytes memory b = bytes(commit);
        if (b.length == 0) return "null";
        require(b.length == 40, "Deploy: DEPLOY_COMMIT must be a 40-digit commit");
        for (uint256 i; i < 40; ++i) {
            bytes1 c = b[i];
            require((c >= "0" && c <= "9") || (c >= "a" && c <= "f"), "Deploy: DEPLOY_COMMIT must be lowercase hex");
        }
        return string.concat('"', commit, '"');
    }

    /// @dev "true" or "false", or null when empty.
    function _dirty(string memory dirty) internal pure returns (string memory) {
        if (bytes(dirty).length == 0) return "null";
        bytes32 h = keccak256(bytes(dirty));
        require(h == keccak256("true") || h == keccak256("false"), "Deploy: DEPLOY_DIRTY must be true or false");
        return dirty;
    }
}
