// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BountyHookCore} from "./BountyHookCore.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";

using PoolIdLibrary for PoolKey;

/// @notice v4-native bounty hook. Skims `bountyAmount` of the bounty token from
///         every exact-input sell via `BeforeSwapDelta` + `poolManager.take`,
///         hands the funds to {BountyHookCore}, and records buys (using the
///         actual `BalanceDelta`) in `afterSwap`. No allowance from the swapper
///         is ever required — the previous design relied on
///         `bountyToken.transferFrom(seller)` which silently failed for every
///         router-mediated swap and produced an empty event stream.
/// @dev The hook never reverts inside the v4 callbacks: routing problems and
///      core failures are surfaced as events so liquidity, not bounty wiring,
///      determines whether a swap succeeds. Exact-output sells are observed
///      but NOT skimmed (rare path on a meme pool); pressure metrics still
///      record the flow via the buy/sell classification.
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
    event V4HookSkipped(PoolId indexed poolId, bytes32 indexed reason);

    bytes32 public constant SKIP_ROUTE_DISABLED      = keccak256("ROUTE_DISABLED");
    bytes32 public constant SKIP_UNSUPPORTED_ROUTE   = keccak256("UNSUPPORTED_ROUTE");
    bytes32 public constant SKIP_EXACT_OUTPUT_SELL   = keccak256("EXACT_OUTPUT_SELL");
    bytes32 public constant SKIP_BOUNTY_BELOW_FLOOR  = keccak256("BOUNTY_BELOW_FLOOR");
    bytes32 public constant SKIP_TRANSFER_TO_CORE    = keccak256("TRANSFER_TO_CORE");

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
        permissions.beforeSwap = true;
        permissions.beforeSwapReturnDelta = true;
        permissions.afterSwap = true;
    }

    function configureRoute(PoolKey calldata key, Currency bountyCurrency, Currency quoteCurrency, bool enabled)
        external
        onlyOwner
    {
        PoolId poolId = key.toId();
        if (Currency.unwrap(bountyCurrency) == address(0)) revert InvalidAddress();
        if (key.hooks != this) revert UnsupportedRoute();

        routes[poolId] = Route({bountyCurrency: bountyCurrency, quoteCurrency: quoteCurrency, enabled: enabled});
        emit RouteConfigured(poolId, bountyCurrency, quoteCurrency, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  v4 callbacks
    // ─────────────────────────────────────────────────────────────────────────

    function _beforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        return (BaseHook.beforeSwap.selector, _runBeforeSwap(sender, key, params, hookData), 0);
    }

    /// @dev Hoisted out of `_beforeSwap` so the outer frame stays shallow
    ///      enough for Solidity's stack-too-deep checker.
    function _runBeforeSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata hookData
    ) private returns (BeforeSwapDelta) {
        PoolId poolId = key.toId();
        Route memory route = routes[poolId];
        if (!route.enabled) {
            emit V4HookSkipped(poolId, SKIP_ROUTE_DISABLED);
            return BeforeSwapDeltaLibrary.ZERO_DELTA;
        }

        (bool classified, bool isSell) = _classify(key, route, params);
        if (!classified) {
            emit V4HookSkipped(poolId, SKIP_UNSUPPORTED_ROUTE);
            return BeforeSwapDeltaLibrary.ZERO_DELTA;
        }

        // Buys are observed in afterSwap (we want the real BalanceDelta).
        if (!isSell) return BeforeSwapDeltaLibrary.ZERO_DELTA;

        // Exact-output sells: specified currency is the quote, not the bounty.
        // Skimming via specifiedDelta would take the wrong currency, so we skip
        // the skim. afterSwap records the flow with bountyAmount=0.
        if (params.amountSpecified >= 0) {
            emit V4HookSkipped(poolId, SKIP_EXACT_OUTPUT_SELL);
            return BeforeSwapDeltaLibrary.ZERO_DELTA;
        }

        return _skimSell(poolId, route, sender, hookData, uint256(-params.amountSpecified));
    }

    /// @dev Computes the bounty, applies the BeforeSwapDelta, materializes the
    ///      tokens via `poolManager.take`, forwards them to core, and reports.
    function _skimSell(
        PoolId poolId,
        Route memory route,
        address sender,
        bytes calldata hookData,
        uint256 sellAmount
    ) private returns (BeforeSwapDelta delta) {
        uint16 bountyBps = core.pressurePolicy().currentBountyBps(PoolId.unwrap(poolId));
        uint256 bountyAmount = (sellAmount * bountyBps) / 10_000;

        if (bountyAmount == 0 || sellAmount < core.minDumpAmount()) {
            emit V4HookSkipped(poolId, SKIP_BOUNTY_BELOW_FLOOR);
            _reportSell(poolId, route, sender, hookData, sellAmount, 0);
            return BeforeSwapDeltaLibrary.ZERO_DELTA;
        }

        // Skim: PoolManager debits the user, credits this hook with bountyAmount
        // of the specified (=bounty) currency. We then take() to materialize.
        // bountyAmount = sellAmount * bps / 10_000 with bps <= 1000, sellAmount
        // bounded by token supply (1e27 wei) — fits int128 (~1.7e38) trivially.
        // forge-lint: disable-next-line(unsafe-typecast)
        delta = toBeforeSwapDelta(int128(int256(bountyAmount)), 0);
        poolManager.take(route.bountyCurrency, address(this), bountyAmount);

        if (!IERC20Minimal(Currency.unwrap(route.bountyCurrency)).transfer(address(core), bountyAmount)) {
            // Token rejected the transfer. The PoolManager already credited
            // the hook, so the tokens stay here until rescued. The swap still
            // succeeds — bounty wiring never gates trades.
            emit V4HookSkipped(poolId, SKIP_TRANSFER_TO_CORE);
            emit V4HookReportFailed(poolId, _trader(sender, hookData), true, abi.encode(SKIP_TRANSFER_TO_CORE));
            return delta;
        }

        _reportSell(poolId, route, sender, hookData, sellAmount, bountyAmount);
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
        if (!route.enabled) return (BaseHook.afterSwap.selector, 0);

        (bool classified, bool isSell) = _classify(key, route, params);
        if (!classified) return (BaseHook.afterSwap.selector, 0);

        // Sells: handled in beforeSwap (skim path) or already classified as
        // exact-output (no skim). For the exact-output path, fall back to a
        // zero-bounty record so pressure metrics still reflect the flow.
        if (isSell) {
            if (params.amountSpecified >= 0) {
                // Bounty-currency input from the seller (positive in their
                // accounting? actually negative — they paid). Take absolute.
                int128 bountyIn = key.currency0 == route.bountyCurrency ? delta.amount0() : delta.amount1();
                uint256 sellAmount = _absolute(int256(bountyIn));
                _reportSell(poolId, route, sender, hookData, sellAmount, 0);
            }
            return (BaseHook.afterSwap.selector, 0);
        }

        // Buys: compute the actual bounty token delivered from the delta.
        int128 bountyOut = key.currency0 == route.bountyCurrency ? delta.amount0() : delta.amount1();
        if (bountyOut <= 0) return (BaseHook.afterSwap.selector, 0);
        // bountyOut > 0 guarded above; uint128 cast is safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 buyAmount = uint256(uint128(bountyOut));

        address trader = _trader(sender, hookData);
        try core.recordBuy(
            PoolId.unwrap(poolId),
            trader,
            Currency.unwrap(route.bountyCurrency),
            Currency.unwrap(route.quoteCurrency),
            buyAmount
        ) {
            emit V4HookSwapObserved(poolId, trader, false, buyAmount, true);
        } catch (bytes memory reason) {
            emit V4HookReportFailed(poolId, trader, false, reason);
            emit V4HookSwapObserved(poolId, trader, false, buyAmount, false);
        }

        return (BaseHook.afterSwap.selector, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _classify(PoolKey calldata key, Route memory route, SwapParams calldata params)
        private
        pure
        returns (bool classified, bool isSell)
    {
        Currency tokenIn = params.zeroForOne ? key.currency0 : key.currency1;
        Currency tokenOut = params.zeroForOne ? key.currency1 : key.currency0;

        if (tokenIn == route.bountyCurrency && tokenOut == route.quoteCurrency) {
            return (true, true);
        }
        if (tokenIn == route.quoteCurrency && tokenOut == route.bountyCurrency) {
            return (true, false);
        }
        return (false, false);
    }

    function _reportSell(
        PoolId poolId,
        Route memory route,
        address sender,
        bytes calldata hookData,
        uint256 sellAmount,
        uint256 bountyAmount
    ) private {
        address trader = _trader(sender, hookData);
        try core.recordSell(
            PoolId.unwrap(poolId),
            trader,
            Currency.unwrap(route.bountyCurrency),
            Currency.unwrap(route.quoteCurrency),
            sellAmount,
            bountyAmount
        ) {
            emit V4HookSwapObserved(poolId, trader, true, sellAmount, true);
        } catch (bytes memory reason) {
            emit V4HookReportFailed(poolId, trader, true, reason);
            emit V4HookSwapObserved(poolId, trader, true, sellAmount, false);
        }
    }

    /// @dev Resolve the actual trader behind a swap.
    ///      1. If hookData carries an address (20 or 32 bytes), trust it — our
    ///         own swap panel forwards the user's address there.
    ///      2. Otherwise (Uniswap UI / aggregators that drop hookData), `sender`
    ///         is the router contract, which would pollute the leaderboard. Fall
    ///         back to `tx.origin` so the EOA who signed the transaction gets
    ///         credit. tx.origin is read-only here (never used for auth) so the
    ///         classic "tx.origin == sender" auth attack does not apply.
    function _trader(address sender, bytes calldata hookData) private view returns (address) {
        // forge-lint: disable-next-line(unsafe-typecast)
        if (hookData.length == 20) return address(bytes20(hookData));
        if (hookData.length == 32) return abi.decode(hookData, (address));
        // sender == PoolManager when the hook is called by a router-mediated
        // swap. tx.origin is the EOA that signed.
        return tx.origin == address(0) ? sender : tx.origin;
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return uint256(value < 0 ? -value : value);
    }
}
