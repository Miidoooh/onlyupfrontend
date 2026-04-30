// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BountyHookCore} from "./BountyHookCore.sol";

using PoolIdLibrary for PoolKey;

/// @notice Real Uniswap v4 afterSwap hook for BHOOK launch pools.
/// @dev The hook reports swaps into BountyHookCore. It never reverts inside afterSwap: unknown pools,
///      disabled routes, unsupported directions, and core.reportSwap failures are logged as events only,
///      so routing and liquidity—not bounty wiring—always determine whether a swap succeeds.
contract BountyV4Hook is BaseHook {
    struct Route {
        Currency bountyCurrency;
        Currency quoteCurrency;
        bool enabled;
    }

    BountyHookCore public immutable core;
    address public owner;
    mapping(PoolId poolId => Route route) public routes;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RouteConfigured(PoolId indexed poolId, Currency bountyCurrency, Currency quoteCurrency, bool enabled);
    event V4HookSwapObserved(
        PoolId indexed poolId,
        address indexed trader,
        bool indexed isSell,
        uint256 amount,
        bool reportedToCore
    );
    event V4HookReportFailed(PoolId indexed poolId, address indexed trader, bool indexed isSell, bytes reason);
    /// @dev Emitted when afterSwap skips bounty reporting (swap still succeeds).
    event V4HookSkipped(PoolId indexed poolId, bytes32 indexed reason);

    bytes32 public constant SKIP_ROUTE_DISABLED = keccak256("ROUTE_DISABLED");
    bytes32 public constant SKIP_UNSUPPORTED_ROUTE = keccak256("UNSUPPORTED_ROUTE");

    error NotOwner();
    error InvalidAddress();
    error UnsupportedRoute();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager manager, address coreHook, address initialOwner) BaseHook(manager) {
        if (coreHook == address(0) || initialOwner == address(0)) revert InvalidAddress();
        core = BountyHookCore(coreHook);
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.afterSwap = true;
    }

    function configureRoute(PoolKey calldata key, Currency bountyCurrency, Currency quoteCurrency, bool enabled)
        external
        onlyOwner
    {
        PoolId poolId = key.toId();
        if (Currency.unwrap(bountyCurrency) == address(0)) {
            revert InvalidAddress();
        }
        if (key.hooks != this) revert UnsupportedRoute();

        routes[poolId] = Route({bountyCurrency: bountyCurrency, quoteCurrency: quoteCurrency, enabled: enabled});
        emit RouteConfigured(poolId, bountyCurrency, quoteCurrency, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        PoolId poolId = key.toId();
        Route memory route = routes[poolId];
        if (!route.enabled) {
            emit V4HookSkipped(poolId, SKIP_ROUTE_DISABLED);
            return (BaseHook.afterSwap.selector, 0);
        }

        address trader = _trader(sender, hookData);
        (bool classified, bool isSell, uint256 amount) = _tryClassifySwap(key, route, params, delta);
        if (!classified) {
            emit V4HookSkipped(poolId, SKIP_UNSUPPORTED_ROUTE);
            return (BaseHook.afterSwap.selector, 0);
        }

        try core.reportSwap(
            PoolId.unwrap(poolId),
            trader,
            Currency.unwrap(route.bountyCurrency),
            Currency.unwrap(route.quoteCurrency),
            isSell ? BountyHookCore.SwapSide.Sell : BountyHookCore.SwapSide.Buy,
            amount
        ) {
            emit V4HookSwapObserved(poolId, trader, isSell, amount, true);
        } catch (bytes memory reason) {
            emit V4HookReportFailed(poolId, trader, isSell, reason);
            emit V4HookSwapObserved(poolId, trader, isSell, amount, false);
        }

        return (BaseHook.afterSwap.selector, 0);
    }

    /// @return classified False if swap direction does not match bounty vs quote (swap still valid).
    function _tryClassifySwap(PoolKey calldata key, Route memory route, SwapParams calldata params, BalanceDelta delta)
        private
        pure
        returns (bool classified, bool isSell, uint256 amount)
    {
        Currency tokenIn = params.zeroForOne ? key.currency0 : key.currency1;
        Currency tokenOut = params.zeroForOne ? key.currency1 : key.currency0;

        if (tokenIn == route.bountyCurrency && tokenOut == route.quoteCurrency) {
            return (true, true, _absolute(params.amountSpecified));
        }

        if (tokenIn == route.quoteCurrency && tokenOut == route.bountyCurrency) {
            int128 bountyDelta = key.currency0 == route.bountyCurrency ? delta.amount0() : delta.amount1();
            return (true, false, _absolute(int256(bountyDelta)));
        }

        return (false, false, 0);
    }

    function _trader(address sender, bytes calldata hookData) private pure returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        if (hookData.length == 20) return address(bytes20(hookData));
        if (hookData.length == 32) return abi.decode(hookData, (address));
        return sender;
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return uint256(value < 0 ? -value : value);
    }
}
