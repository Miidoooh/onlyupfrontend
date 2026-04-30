// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyHook} from "../src/BountyHook.sol";

contract DeployBountyHook {
    function deploy(address poolManager, uint16 bountyBps, uint64 windowBlocks, uint256 minDumpAmount)
        external
        returns (BountyHook)
    {
        return new BountyHook(poolManager, bountyBps, windowBlocks, minDumpAmount);
    }
}
