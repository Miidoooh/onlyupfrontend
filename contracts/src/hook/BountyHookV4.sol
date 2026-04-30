// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyHookCore} from "./BountyHookCore.sol";

/// @notice Minimal v4-facing adapter path for launch wiring.
/// @dev Replace reportAfterSwap with the exact BaseHook afterSwap signature when v4 deps are vendored.
contract BountyHookV4 {
    struct PoolRoute {
        address bountyToken;
        address quoteToken;
        bool enabled;
    }

    BountyHookCore public immutable core;
    address public owner;
    address public poolManager;

    mapping(bytes32 poolId => PoolRoute route) public routes;

    event PoolManagerUpdated(address indexed oldPoolManager, address indexed newPoolManager);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RouteConfigured(bytes32 indexed poolId, address indexed bountyToken, address indexed quoteToken, bool enabled);
    event V4SwapReported(bytes32 indexed poolId, address indexed trader, bool indexed isSell, uint256 amountIn);

    error NotOwner();
    error NotPoolManager();
    error InvalidAddress();
    error RouteNotEnabled();
    error UnsupportedRoute();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPoolManager() {
        if (msg.sender != poolManager) revert NotPoolManager();
        _;
    }

    constructor(address initialOwner, address initialPoolManager, address coreHook) {
        if (initialOwner == address(0) || initialPoolManager == address(0) || coreHook == address(0)) {
            revert InvalidAddress();
        }
        owner = initialOwner;
        poolManager = initialPoolManager;
        core = BountyHookCore(coreHook);
    }

    function setPoolManager(address newPoolManager) external onlyOwner {
        if (newPoolManager == address(0)) revert InvalidAddress();
        emit PoolManagerUpdated(poolManager, newPoolManager);
        poolManager = newPoolManager;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function configureRoute(bytes32 poolId, address bountyToken, address quoteToken, bool enabled) external onlyOwner {
        if (poolId == bytes32(0) || bountyToken == address(0) || quoteToken == address(0)) revert InvalidAddress();
        routes[poolId] = PoolRoute({bountyToken: bountyToken, quoteToken: quoteToken, enabled: enabled});
        emit RouteConfigured(poolId, bountyToken, quoteToken, enabled);
    }

    function reportAfterSwap(bytes32 poolId, address trader, address tokenIn, address tokenOut, uint256 amountIn)
        external
        onlyPoolManager
        returns (bytes32 windowId)
    {
        PoolRoute storage route = routes[poolId];
        if (!route.enabled) revert RouteNotEnabled();

        if (tokenIn == route.bountyToken && tokenOut == route.quoteToken) {
            emit V4SwapReported(poolId, trader, true, amountIn);
            return core.reportSwap(
                poolId,
                trader,
                route.bountyToken,
                route.quoteToken,
                BountyHookCore.SwapSide.Sell,
                amountIn
            );
        }

        if (tokenIn == route.quoteToken && tokenOut == route.bountyToken) {
            emit V4SwapReported(poolId, trader, false, amountIn);
            return core.reportSwap(
                poolId,
                trader,
                route.bountyToken,
                route.quoteToken,
                BountyHookCore.SwapSide.Buy,
                amountIn
            );
        }

        revert UnsupportedRoute();
    }
}
