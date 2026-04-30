// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBountyPressurePolicy {
    function recordFlow(bytes32 poolId, bool isSell, uint256 amount) external;
    function currentBountyBps(bytes32 poolId) external view returns (uint16);
    function pressure(bytes32 poolId) external view returns (uint256 sellVolume, uint256 buyVolume, uint16 bountyBps);
}
