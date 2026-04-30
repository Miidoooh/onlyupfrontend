// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {NetSellPressureBountyPolicy} from "../src/policy/NetSellPressureBountyPolicy.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

interface Vm {
    function prank(address sender) external;
    function roll(uint256 blockNumber) external;
}

contract BountyHookCoreTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant POOL_ID = keccak256("BHOOK/ETH");
    address private constant WHALE = address(0xA11CE);
    address private constant BUYER = address(0xB01);

    BountyHookCore private core;
    NetSellPressureBountyPolicy private policy;
    MockERC20 private bountyToken;
    MockERC20 private quoteToken;

    function setUp() public {
        policy = new NetSellPressureBountyPolicy(address(this), 500, 1_000, 5, 12);
        core = new BountyHookCore(address(this), address(this), address(policy), 50, 10 ether);
        policy.setHook(address(core));
        bountyToken = new MockERC20("Bounty Hook", "BHOOK");
        quoteToken = new MockERC20("Ether", "ETH");
        bountyToken.mint(WHALE, 1_000 ether);
        core.configurePool(POOL_ID, address(bountyToken), address(quoteToken), true);
        vm.prank(WHALE);
        bountyToken.approve(address(core), type(uint256).max);
    }

    function testDynamicSellPressureFundsWindow() public {
        bytes32 windowId = core.reportSwap(
            POOL_ID,
            WHALE,
            address(bountyToken),
            address(quoteToken),
            BountyHookCore.SwapSide.Sell,
            100 ether
        );

        BountyHookCore.BountyWindow memory window = core.getWindow(windowId);
        require(window.totalBounty == 10 ether, "dynamic bounty");
        require(policy.currentBountyBps(POOL_ID) == 1_000, "pressure bps");
    }

    function testBuyersStillSplitDynamicWindow() public {
        bytes32 windowId = core.reportSwap(
            POOL_ID,
            WHALE,
            address(bountyToken),
            address(quoteToken),
            BountyHookCore.SwapSide.Sell,
            100 ether
        );

        core.reportSwap(POOL_ID, BUYER, address(bountyToken), address(quoteToken), BountyHookCore.SwapSide.Buy, 50 ether);
        vm.roll(block.number + 51);

        require(core.claimable(windowId, BUYER) == 10 ether, "buyer share");
    }

    function testRejectsUnconfiguredPool() public {
        bool reverted;
        try core.reportSwap(
            keccak256("OTHER"),
            WHALE,
            address(bountyToken),
            address(quoteToken),
            BountyHookCore.SwapSide.Sell,
            100 ether
        ) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "pool validation");
    }
}
