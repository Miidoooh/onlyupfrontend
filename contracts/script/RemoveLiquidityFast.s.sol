// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";

interface Vm {
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Fast liquidity removal helper for Uniswap v4 positions.
/// @dev By default it removes ~10x "base" liquidity, clamped to current position liquidity.
///      If REMOVE_BASE_LIQUIDITY is unset, base defaults to currentLiquidity / 10.
contract RemoveLiquidityFast {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant DEFAULT_MULTIPLIER = 10;

    /// @dev Bundling locals into memory dodges the "stack too deep" trap that hits
    ///      when run() carries many uint256 values across the broadcast call.
    struct RunInputs {
        uint256 privateKey;
        IPositionManager posm;
        uint256 tokenId;
        uint256 multiplier;
        uint128 amount0Min;
        uint128 amount1Min;
        uint256 baseLiquidity;
    }

    event LiquidityRemoved(
        uint256 indexed tokenId,
        uint128 liquidityBefore,
        uint128 liquidityRemoved,
        uint128 liquidityAfter,
        uint256 baseLiquidity,
        uint256 multiplier
    );

    function run() external {
        RunInputs memory i = _readInputs();
        uint128 currentLiquidity = i.posm.getPositionLiquidity(i.tokenId);
        require(currentLiquidity > 0, "position has no liquidity");

        uint128 liquidityToRemove = _clampLiquidity(currentLiquidity, i.baseLiquidity, i.multiplier);
        require(liquidityToRemove > 0, "liquidityToRemove=0");

        bytes memory unlockData = _buildUnlockData(i, liquidityToRemove);

        vm.startBroadcast(i.privateKey);
        i.posm.modifyLiquidities(unlockData, block.timestamp + 5 minutes);
        vm.stopBroadcast();

        emit LiquidityRemoved(
            i.tokenId,
            currentLiquidity,
            liquidityToRemove,
            i.posm.getPositionLiquidity(i.tokenId),
            i.baseLiquidity,
            i.multiplier
        );
    }

    function _readInputs() private returns (RunInputs memory i) {
        i.privateKey = vm.envUint("PRIVATE_KEY");
        i.posm = IPositionManager(vm.envAddress("V4_POSITION_MANAGER"));
        i.tokenId = vm.envUint("REMOVE_TOKEN_ID");
        i.multiplier = _envUintOr("REMOVE_MULTIPLIER", DEFAULT_MULTIPLIER);
        i.amount0Min = uint128(_envUintOr("REMOVE_AMOUNT0_MIN", 0));
        i.amount1Min = uint128(_envUintOr("REMOVE_AMOUNT1_MIN", 0));

        uint128 currentLiquidity = i.posm.getPositionLiquidity(i.tokenId);
        uint256 defaultBase = uint256(currentLiquidity) / DEFAULT_MULTIPLIER;
        if (defaultBase == 0) defaultBase = 1;
        i.baseLiquidity = _envUintOr("REMOVE_BASE_LIQUIDITY", defaultBase);
    }

    function _clampLiquidity(uint128 currentLiquidity, uint256 baseLiquidity, uint256 multiplier)
        private
        pure
        returns (uint128)
    {
        uint256 requested = baseLiquidity * multiplier;
        return requested >= uint256(currentLiquidity) ? currentLiquidity : uint128(requested);
    }

    function _buildUnlockData(RunInputs memory i, uint128 liquidityToRemove) private view returns (bytes memory) {
        (PoolKey memory key,) = i.posm.getPoolAndPositionInfo(i.tokenId);

        bytes memory actions = abi.encodePacked(
            bytes1(uint8(Actions.DECREASE_LIQUIDITY)),
            bytes1(uint8(Actions.CLOSE_CURRENCY)),
            bytes1(uint8(Actions.CLOSE_CURRENCY))
        );

        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(i.tokenId, liquidityToRemove, i.amount0Min, i.amount1Min, bytes(""));
        params[1] = abi.encode(key.currency0);
        params[2] = abi.encode(key.currency1);

        return abi.encode(actions, params);
    }

    function _envUintOr(string memory key, uint256 fallbackValue) private returns (uint256 value) {
        try vm.envUint(key) returns (uint256 configured) {
            value = configured;
        } catch {
            value = fallbackValue;
        }
    }
}
