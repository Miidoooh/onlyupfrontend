// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyV4Hook} from "../src/hook/BountyV4Hook.sol";
import {LaunchConfig} from "../src/launch/LaunchConfig.sol";
import {NetSellPressureBountyPolicy} from "../src/policy/NetSellPressureBountyPolicy.sol";
import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata key) external returns (address);
    function envString(string calldata key) external returns (string memory);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys a complete fresh launch: token, policy, core hook, v4 afterSwap hook.
/// @dev Does NOT initialize any v4 pool. The operator creates the pool/liquidity through the
///      Uniswap UI (with or without our hook in the PoolKey). Once the pool exists, set
///      POOL_ID in .env and (optionally) call ConfigureNativeEthV4Route to opt the pool
///      into the bounty mechanism.
contract DeployFreshNativeEthLaunch {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Sepolia v4 deployment (Uniswap docs).
    address private constant SEPOLIA_POOL_MANAGER     = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant SEPOLIA_POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address private constant SEPOLIA_PERMIT2          = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant SEPOLIA_UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;

    // Mainnet v4 deployment (Uniswap docs — same Permit2 address everywhere).
    address private constant MAINNET_POOL_MANAGER     = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address private constant MAINNET_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address private constant MAINNET_PERMIT2          = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant MAINNET_UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;

    uint160 private constant HOOK_FLAGS = Hooks.AFTER_SWAP_FLAG;
    uint256 private constant DEFAULT_MIN_DUMP_AMOUNT = 10 ether;

    struct V4Addresses {
        address poolManager;
        address positionManager;
        address permit2;
        address universalRouter;
    }

    event FreshLaunchReady(
        address indexed token,
        address indexed core,
        address indexed hook,
        address policy,
        address owner,
        string name,
        string symbol
    );

    function run()
        external
        returns (
            BountyLaunchToken token,
            NetSellPressureBountyPolicy policy,
            BountyHookCore core,
            BountyV4Hook hook
        )
    {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(privateKey);

        string memory name = _envStringOr("TOKEN_NAME", "Only Up");
        string memory symbol = _envStringOr("TOKEN_SYMBOL", "UP");
        uint256 minDumpAmount = _envUintOr("MIN_DUMP_AMOUNT", DEFAULT_MIN_DUMP_AMOUNT);

        // Chain-specific Uniswap v4 addresses (struct keeps locals < stack depth).
        V4Addresses memory v4 = _resolveV4Addresses();

        vm.startBroadcast(privateKey);

        token = new BountyLaunchToken(name, symbol, owner, owner);

        policy = new NetSellPressureBountyPolicy(
            owner,
            LaunchConfig.BASE_BOUNTY_BPS,
            LaunchConfig.MAX_DYNAMIC_BOUNTY_BPS,
            LaunchConfig.PRESSURE_BUCKET_BLOCKS,
            LaunchConfig.PRESSURE_BUCKET_COUNT
        );

        core = new BountyHookCore(
            owner,
            owner,
            address(policy),
            LaunchConfig.BOUNTY_WINDOW_BLOCKS,
            minDumpAmount
        );

        {
            bytes memory constructorArgs = abi.encode(IPoolManager(v4.poolManager), address(core), owner);
            (address hookAddress, bytes32 salt) =
                HookMiner.find(CREATE2_DEPLOYER, HOOK_FLAGS, type(BountyV4Hook).creationCode, constructorArgs);

            hook = new BountyV4Hook{salt: salt}(IPoolManager(v4.poolManager), address(core), owner);
            require(address(hook) == hookAddress, "hook address mismatch");
        }

        policy.setHook(address(core));
        core.setReporter(address(hook));

        // Limit exemptions so v4 routers/managers can move the token while wallet is gated by maxTx.
        token.setLimitExempt(v4.poolManager, true);
        token.setLimitExempt(v4.positionManager, true);
        token.setLimitExempt(v4.permit2, true);
        token.setLimitExempt(v4.universalRouter, true);
        token.setLimitExempt(address(core), true);
        token.setLimitExempt(address(hook), true);

        // Open trading immediately so non-exempt wallets can transfer once liquidity is added.
        token.enableTrading();

        vm.stopBroadcast();

        emit FreshLaunchReady(address(token), address(core), address(hook), address(policy), owner, name, symbol);
    }

    function _envStringOr(string memory key, string memory fallbackValue) private returns (string memory) {
        try vm.envString(key) returns (string memory configured) {
            return bytes(configured).length == 0 ? fallbackValue : configured;
        } catch {
            return fallbackValue;
        }
    }

    function _envUintOr(string memory key, uint256 fallbackValue) private returns (uint256) {
        try vm.envUint(key) returns (uint256 configured) {
            return configured == 0 ? fallbackValue : configured;
        } catch {
            return fallbackValue;
        }
    }

    function _envAddressOr(string memory key, address fallbackValue) private returns (address) {
        try vm.envAddress(key) returns (address configured) {
            return configured == address(0) ? fallbackValue : configured;
        } catch {
            return fallbackValue;
        }
    }

    function _resolveV4Addresses() private returns (V4Addresses memory v4) {
        bool isMainnet = block.chainid == 1;
        v4.poolManager     = _envAddressOr("V4_POOL_MANAGER",     isMainnet ? MAINNET_POOL_MANAGER     : SEPOLIA_POOL_MANAGER);
        v4.positionManager = _envAddressOr("V4_POSITION_MANAGER", isMainnet ? MAINNET_POSITION_MANAGER : SEPOLIA_POSITION_MANAGER);
        v4.permit2         = _envAddressOr("PERMIT2_ADDRESS",     isMainnet ? MAINNET_PERMIT2          : SEPOLIA_PERMIT2);
        v4.universalRouter = _envAddressOr("UNIVERSAL_ROUTER",    isMainnet ? MAINNET_UNIVERSAL_ROUTER : SEPOLIA_UNIVERSAL_ROUTER);

        // Sanity-gate to prevent the Sepolia-PoolManager-on-mainnet bug. The hook
        // bakes IPoolManager into immutable state — wrong here means the hook is
        // permanently bricked and every swap reverts in afterSwap.
        if (isMainnet && v4.poolManager != MAINNET_POOL_MANAGER) {
            revert("V4_POOL_MANAGER mismatch: chainid 1 requires mainnet PM 0x000000000004444c5dc75cB358380D2e3dE08A90");
        }
        if (block.chainid == 11155111 && v4.poolManager != SEPOLIA_POOL_MANAGER) {
            revert("V4_POOL_MANAGER mismatch: chainid 11155111 requires sepolia PM 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543");
        }
    }
}
