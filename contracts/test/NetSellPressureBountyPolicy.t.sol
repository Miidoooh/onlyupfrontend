// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NetSellPressureBountyPolicy} from "../src/policy/NetSellPressureBountyPolicy.sol";

interface Vm {
    function roll(uint256 blockNumber) external;
}

contract NetSellPressureBountyPolicyTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant POOL_ID = keccak256("BHOOK/ETH");

    NetSellPressureBountyPolicy private policy;

    function setUp() public {
        policy = new NetSellPressureBountyPolicy(address(this), 500, 1_000, 5, 12);
        policy.setHook(address(this));
    }

    function testStartsAtBaseBounty() public view {
        require(policy.currentBountyBps(POOL_ID) == 500, "base");
    }

    function testSellPressureBoostsBounty() public {
        policy.recordFlow(POOL_ID, true, 100 ether);
        policy.recordFlow(POOL_ID, false, 20 ether);

        require(policy.currentBountyBps(POOL_ID) == 1_000, "max pressure");
    }

    function testBuyPressureReturnsToBase() public {
        policy.recordFlow(POOL_ID, true, 100 ether);
        policy.recordFlow(POOL_ID, false, 100 ether);

        require(policy.currentBountyBps(POOL_ID) == 500, "balanced");
    }

    function testBucketsAgeOut() public {
        policy.recordFlow(POOL_ID, true, 100 ether);
        vm.roll(block.number + 65);

        require(policy.currentBountyBps(POOL_ID) == 500, "aged out");
    }

    function testCapCannotExceedMax() public {
        policy.recordFlow(POOL_ID, true, 1_000 ether);

        require(policy.currentBountyBps(POOL_ID) == 1_000, "cap");
    }
}
