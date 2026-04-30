// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBountyPressurePolicy} from "../interfaces/IBountyPressurePolicy.sol";
import {LaunchConfig} from "../launch/LaunchConfig.sol";

contract NetSellPressureBountyPolicy is IBountyPressurePolicy {
    struct Bucket {
        uint256 epoch;
        uint256 sellVolume;
        uint256 buyVolume;
    }

    uint16 public immutable baseBountyBps;
    uint16 public immutable maxBountyBps;
    uint16 public immutable bucketBlocks;
    uint8 public immutable bucketCount;
    address public owner;
    address public hook;

    mapping(bytes32 poolId => mapping(uint256 bucketIndex => Bucket bucket)) private buckets;

    event HookUpdated(address indexed oldHook, address indexed newHook);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FlowRecorded(bytes32 indexed poolId, bool indexed isSell, uint256 amount, uint16 bountyBps);

    error NotOwner();
    error NotHook();
    error InvalidConfig();
    error InvalidAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    constructor(address initialOwner, uint16 initialBaseBps, uint16 initialMaxBps, uint16 initialBucketBlocks, uint8 initialBucketCount) {
        if (initialOwner == address(0)) revert InvalidAddress();
        if (initialBaseBps == 0 || initialMaxBps < initialBaseBps || initialMaxBps > LaunchConfig.MAX_DYNAMIC_BOUNTY_BPS) {
            revert InvalidConfig();
        }
        if (initialBucketBlocks == 0 || initialBucketCount < 2) revert InvalidConfig();

        owner = initialOwner;
        baseBountyBps = initialBaseBps;
        maxBountyBps = initialMaxBps;
        bucketBlocks = initialBucketBlocks;
        bucketCount = initialBucketCount;
    }

    function setHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert InvalidAddress();
        emit HookUpdated(hook, newHook);
        hook = newHook;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function recordFlow(bytes32 poolId, bool isSell, uint256 amount) external onlyHook {
        if (amount == 0) return;

        Bucket storage bucket = _currentBucket(poolId);
        if (isSell) {
            bucket.sellVolume += amount;
        } else {
            bucket.buyVolume += amount;
        }

        emit FlowRecorded(poolId, isSell, amount, currentBountyBps(poolId));
    }

    function currentBountyBps(bytes32 poolId) public view returns (uint16) {
        (uint256 sellVolume, uint256 buyVolume,) = pressure(poolId);
        if (sellVolume <= buyVolume || sellVolume == 0) return baseBountyBps;

        uint256 pressureBps = ((sellVolume - buyVolume) * 10_000) / sellVolume;
        uint16 boost;

        if (pressureBps >= 7_500) {
            boost = 500;
        } else if (pressureBps >= 5_000) {
            boost = 350;
        } else if (pressureBps >= 2_500) {
            boost = 200;
        } else if (pressureBps >= 1_000) {
            boost = 100;
        }

        uint256 bounty = uint256(baseBountyBps) + boost;
        // forge-lint: disable-next-line(unsafe-typecast)
        return bounty > maxBountyBps ? maxBountyBps : uint16(bounty);
    }

    function pressure(bytes32 poolId) public view returns (uint256 sellVolume, uint256 buyVolume, uint16 bountyBps) {
        uint256 currentEpoch = _epoch();
        for (uint256 index = 0; index < bucketCount; index++) {
            Bucket storage bucket = buckets[poolId][index];
            if (bucket.epoch + bucketCount > currentEpoch) {
                sellVolume += bucket.sellVolume;
                buyVolume += bucket.buyVolume;
            }
        }
        bountyBps = _bountyFromVolumes(sellVolume, buyVolume);
    }

    function _currentBucket(bytes32 poolId) private returns (Bucket storage bucket) {
        uint256 currentEpoch = _epoch();
        uint256 bucketIndex = currentEpoch % bucketCount;
        bucket = buckets[poolId][bucketIndex];
        if (bucket.epoch != currentEpoch) {
            bucket.epoch = currentEpoch;
            bucket.sellVolume = 0;
            bucket.buyVolume = 0;
        }
    }

    function _epoch() private view returns (uint256) {
        return block.number / bucketBlocks;
    }

    function _bountyFromVolumes(uint256 sellVolume, uint256 buyVolume) private view returns (uint16) {
        if (sellVolume <= buyVolume || sellVolume == 0) return baseBountyBps;
        uint256 pressureBps = ((sellVolume - buyVolume) * 10_000) / sellVolume;
        uint16 boost;

        if (pressureBps >= 7_500) boost = 500;
        else if (pressureBps >= 5_000) boost = 350;
        else if (pressureBps >= 2_500) boost = 200;
        else if (pressureBps >= 1_000) boost = 100;

        uint256 bounty = uint256(baseBountyBps) + boost;
        // forge-lint: disable-next-line(unsafe-typecast)
        return bounty > maxBountyBps ? maxBountyBps : uint16(bounty);
    }
}
