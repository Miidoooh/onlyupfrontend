// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyV4Hook} from "../src/hook/BountyV4Hook.sol";

using PoolIdLibrary for PoolKey;

interface Vm {
    function envAddress(string calldata key) external returns (address);
    function envInt(string calldata key) external returns (int256);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract ConfigureNativeEthV4Route {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event NativeEthRouteConfigured(
        PoolId indexed poolId,
        address indexed core,
        address indexed hook,
        address token,
        uint24 fee,
        int24 tickSpacing
    );

    function run() external returns (PoolKey memory key, PoolId poolId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("BOUNTY_TOKEN_ADDRESS");
        address core = vm.envAddress("BOUNTY_HOOK_ADDRESS");
        address hook = vm.envAddress("REAL_V4_HOOK_ADDRESS");
        // Must match DeployNativeEthRealV4Launch.s.sol (native ETH pool defaults).
        uint24 fee = uint24(_envUintOr("V4_FEE", 10_000));
        int24 tickSpacing = int24(_envIntOr("V4_TICK_SPACING", 200));

        key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hook)
        });
        poolId = key.toId();

        vm.startBroadcast(privateKey);
        BountyHookCore(core).configurePool(PoolId.unwrap(poolId), token, address(0), true);
        BountyV4Hook(hook).configureRoute(key, Currency.wrap(token), Currency.wrap(address(0)), true);
        vm.stopBroadcast();

        emit NativeEthRouteConfigured(poolId, core, hook, token, fee, tickSpacing);
    }

    function _envUintOr(string memory key, uint256 fallbackValue) private returns (uint256 value) {
        try vm.envUint(key) returns (uint256 configured) {
            value = configured;
        } catch {
            value = fallbackValue;
        }
    }

    function _envIntOr(string memory key, int256 fallbackValue) private returns (int256 value) {
        try vm.envInt(key) returns (int256 configured) {
            value = configured;
        } catch {
            value = fallbackValue;
        }
    }
}
