// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library LaunchConfig {
    uint256 internal constant DEFAULT_SUPPLY = 1_000_000_000 ether;
    uint16 internal constant MAX_LAUNCH_LIMIT_BPS = 100;
    uint16 internal constant BASE_BOUNTY_BPS = 500;
    uint16 internal constant MAX_DYNAMIC_BOUNTY_BPS = 1_000;
    uint64 internal constant BOUNTY_WINDOW_BLOCKS = 50;
    uint16 internal constant PRESSURE_BUCKET_BLOCKS = 5;
    uint8 internal constant PRESSURE_BUCKET_COUNT = 12;
}
