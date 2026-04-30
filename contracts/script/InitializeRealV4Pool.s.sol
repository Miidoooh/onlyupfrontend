// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyV4Hook} from "../src/hook/BountyV4Hook.sol";
import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

using PoolIdLibrary for PoolKey;

interface Vm {
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract InitializeRealV4Pool {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant SEPOLIA_POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address private constant SEPOLIA_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant SEPOLIA_UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    address private constant SEPOLIA_WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    uint24 private constant DEFAULT_FEE = 10_000;
    int24 private constant DEFAULT_TICK_SPACING = 200;
    uint160 private constant DEFAULT_SQRT_PRICE_X96 = 79_228_162_514_264_337_593_543_950_336;

    event RealV4PoolReady(
        PoolId indexed poolId,
        address indexed hook,
        address indexed token,
        address currency0,
        address currency1,
        uint24 fee,
        int24 tickSpacing
    );

    function run() external returns (PoolKey memory key, PoolId poolId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address token = vm.envAddress("BOUNTY_TOKEN_ADDRESS");
        address core = vm.envAddress("BOUNTY_HOOK_ADDRESS");
        address hook = vm.envAddress("REAL_V4_HOOK_ADDRESS");
        address poolManager = _envAddressOr("V4_POOL_MANAGER", SEPOLIA_POOL_MANAGER);
        address weth = _envAddressOr("WETH_ADDRESS", SEPOLIA_WETH);

        key = _poolKey(token, weth, hook);
        poolId = key.toId();

        vm.startBroadcast(privateKey);
        BountyHookCore(core).setReporter(hook);
        BountyHookCore(core).configurePool(PoolId.unwrap(poolId), token, weth, true);
        BountyV4Hook(hook).configureRoute(key, Currency.wrap(token), Currency.wrap(weth), true);

        BountyLaunchToken(token).setLimitExempt(poolManager, true);
        BountyLaunchToken(token).setLimitExempt(hook, true);
        BountyLaunchToken(token).setLimitExempt(core, true);
        BountyLaunchToken(token).setLimitExempt(SEPOLIA_POSITION_MANAGER, true);
        BountyLaunchToken(token).setLimitExempt(SEPOLIA_PERMIT2, true);
        BountyLaunchToken(token).setLimitExempt(SEPOLIA_UNIVERSAL_ROUTER, true);

        try IPoolManager(poolManager).initialize(key, _sqrtPriceX96()) {
            // initialized
        } catch {
            // If it is already initialized, keep the script idempotent for repeated launch attempts.
        }
        vm.stopBroadcast();

        emit RealV4PoolReady(
            poolId,
            hook,
            token,
            Currency.unwrap(key.currency0),
            Currency.unwrap(key.currency1),
            key.fee,
            key.tickSpacing
        );
    }

    function _poolKey(address token, address weth, address hook) private pure returns (PoolKey memory key) {
        Currency tokenCurrency = Currency.wrap(token);
        Currency wethCurrency = Currency.wrap(weth);
        (Currency currency0, Currency currency1) =
            tokenCurrency < wethCurrency ? (tokenCurrency, wethCurrency) : (wethCurrency, tokenCurrency);
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: DEFAULT_FEE,
            tickSpacing: DEFAULT_TICK_SPACING,
            hooks: IHooks(hook)
        });
    }

    function _sqrtPriceX96() private returns (uint160 sqrtPriceX96) {
        try vm.envUint("SQRT_PRICE_X96") returns (uint256 configured) {
            // forge-lint: disable-next-line(unsafe-typecast)
            sqrtPriceX96 = uint160(configured);
        } catch {
            sqrtPriceX96 = DEFAULT_SQRT_PRICE_X96;
        }
    }

    function _envAddressOr(string memory key, address fallbackValue) private returns (address value) {
        try vm.envAddress(key) returns (address configured) {
            value = configured;
        } catch {
            value = fallbackValue;
        }
    }
}
