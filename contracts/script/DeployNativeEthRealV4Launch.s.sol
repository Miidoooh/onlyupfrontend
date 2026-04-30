// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyV4Hook} from "../src/hook/BountyV4Hook.sol";
import {LaunchConfig} from "../src/launch/LaunchConfig.sol";
import {NetSellPressureBountyPolicy} from "../src/policy/NetSellPressureBountyPolicy.sol";
import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

using PoolIdLibrary for PoolKey;

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployNativeEthRealV4Launch {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant SEPOLIA_POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address private constant SEPOLIA_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant SEPOLIA_UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;

    uint160 private constant HOOK_FLAGS = Hooks.AFTER_SWAP_FLAG;
    uint24 private constant FEE = 10_000;
    int24 private constant TICK_SPACING = 200;
    uint160 private constant ONE_ETH_PER_ONE_BILLION_BHOOK_SQRT_PRICE_X96 =
        2_505_414_483_750_416_458_579_128_823_926_757;

    event NativeEthRealV4LaunchReady(
        address indexed policy,
        address indexed core,
        address indexed hook,
        PoolId poolId,
        PoolKey key,
        uint160 sqrtPriceX96
    );

    function run() external returns (NetSellPressureBountyPolicy policy, BountyHookCore core, BountyV4Hook hook, PoolId poolId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(privateKey);
        address token = vm.envAddress("BOUNTY_TOKEN_ADDRESS");
        address poolManager = _poolManager();

        vm.startBroadcast(privateKey);
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
            10 ether
        );

        bytes memory constructorArgs = abi.encode(IPoolManager(poolManager), address(core), owner);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, HOOK_FLAGS, type(BountyV4Hook).creationCode, constructorArgs);

        PoolKey memory key = _nativeEthPoolKey(token, hookAddress);
        poolId = key.toId();

        hook = new BountyV4Hook{salt: salt}(IPoolManager(poolManager), address(core), owner);
        require(address(hook) == hookAddress, "hook address mismatch");

        policy.setHook(address(core));
        core.setReporter(address(hook));
        core.configurePool(PoolId.unwrap(poolId), token, address(0), true);
        hook.configureRoute(key, Currency.wrap(token), Currency.wrap(address(0)), true);

        BountyLaunchToken(token).setLimitExempt(poolManager, true);
        BountyLaunchToken(token).setLimitExempt(SEPOLIA_POSITION_MANAGER, true);
        BountyLaunchToken(token).setLimitExempt(SEPOLIA_PERMIT2, true);
        BountyLaunchToken(token).setLimitExempt(SEPOLIA_UNIVERSAL_ROUTER, true);
        BountyLaunchToken(token).setLimitExempt(address(core), true);
        BountyLaunchToken(token).setLimitExempt(address(hook), true);

        IPoolManager(poolManager).initialize(key, ONE_ETH_PER_ONE_BILLION_BHOOK_SQRT_PRICE_X96);
        vm.stopBroadcast();

        emit NativeEthRealV4LaunchReady(
            address(policy),
            address(core),
            address(hook),
            poolId,
            key,
            ONE_ETH_PER_ONE_BILLION_BHOOK_SQRT_PRICE_X96
        );
    }

    function _nativeEthPoolKey(address token, address hook) private pure returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    function _poolManager() private returns (address poolManager) {
        try vm.envAddress("V4_POOL_MANAGER") returns (address configured) {
            poolManager = configured;
        } catch {
            poolManager = SEPOLIA_POOL_MANAGER;
        }
    }
}
