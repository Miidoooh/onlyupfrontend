// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyHook} from "../src/BountyHook.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

interface Vm {
    function roll(uint256 blockNumber) external;
    function prank(address sender) external;
}

contract BountyHookTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant POOL_ID = keccak256("ETH/BOUNTY");
    address private constant WHALE = address(0xA11CE);
    address private constant BUYER_ONE = address(0xB01);
    address private constant BUYER_TWO = address(0xB02);

    BountyHook private hook;
    MockERC20 private bountyToken;
    MockERC20 private quoteToken;

    function setUp() public {
        hook = new BountyHook(address(this), 500, 50, 10 ether);
        bountyToken = new MockERC20("Bounty", "BNTY");
        quoteToken = new MockERC20("Quote", "QTE");
        bountyToken.mint(WHALE, 1_000 ether);
        bountyToken.mint(address(this), 1_000 ether);
    }

    function testDumpOpensFiftyBlockWindow() public {
        _fundDumpApproval(100 ether);

        bytes32 windowId = hook.reportSwap(
            POOL_ID,
            WHALE,
            address(bountyToken),
            address(quoteToken),
            BountyHook.SwapSide.Sell,
            100 ether
        );

        BountyHook.BountyWindow memory window = hook.getWindow(windowId);
        require(window.totalBounty == 5 ether, "wrong bounty");
        require(window.endBlock == block.number + 50, "wrong end block");
    }

    function testBuyersSplitBountyProportionally() public {
        bytes32 windowId = _openWindow(100 ether);

        hook.reportSwap(POOL_ID, BUYER_ONE, address(bountyToken), address(quoteToken), BountyHook.SwapSide.Buy, 30 ether);
        hook.reportSwap(POOL_ID, BUYER_TWO, address(bountyToken), address(quoteToken), BountyHook.SwapSide.Buy, 70 ether);

        require(hook.claimable(windowId, BUYER_ONE) == 1.5 ether, "buyer one share");
        require(hook.claimable(windowId, BUYER_TWO) == 3.5 ether, "buyer two share");
    }

    function testBuyOutsideWindowDoesNotEarnRewards() public {
        bytes32 windowId = _openWindow(100 ether);
        vm.roll(block.number + 51);
        hook.closeWindow(windowId);

        hook.reportSwap(POOL_ID, BUYER_ONE, address(bountyToken), address(quoteToken), BountyHook.SwapSide.Buy, 100 ether);

        require(hook.claimable(windowId, BUYER_ONE) == 0, "outside buyer rewarded");
    }

    function testCannotDoubleClaim() public {
        bytes32 windowId = _openWindow(100 ether);
        hook.reportSwap(POOL_ID, BUYER_ONE, address(bountyToken), address(quoteToken), BountyHook.SwapSide.Buy, 100 ether);

        vm.roll(block.number + 51);
        vm.prank(BUYER_ONE);
        hook.claim(windowId);
        bool reverted;
        vm.prank(BUYER_ONE);
        try hook.claim(windowId) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "second claim should fail");
    }

    function testSecondDumpTopsUpActiveWindow() public {
        bytes32 windowId = _openWindow(100 ether);
        _fundDumpApproval(200 ether);

        bytes32 secondWindow = hook.reportSwap(
            POOL_ID,
            WHALE,
            address(bountyToken),
            address(quoteToken),
            BountyHook.SwapSide.Sell,
            200 ether
        );

        BountyHook.BountyWindow memory window = hook.getWindow(windowId);
        require(secondWindow == windowId, "created unexpected window");
        require(window.totalBounty == 15 ether, "wrong top up amount");
    }

    function testSkimBoundsHold() public {
        bool reverted;
        try new BountyHook(address(this), 1_001, 50, 10 ether) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "bps bound not enforced");
    }

    function testFuzzClaimableNeverExceedsBounty(uint96 rawBuyerOne, uint96 rawBuyerTwo) public {
        uint256 buyerOneAmount = (uint256(rawBuyerOne) % 1_000 ether) + 1;
        uint256 buyerTwoAmount = (uint256(rawBuyerTwo) % 1_000 ether) + 1;
        bytes32 windowId = _openWindow(100 ether);

        hook.reportSwap(
            POOL_ID,
            BUYER_ONE,
            address(bountyToken),
            address(quoteToken),
            BountyHook.SwapSide.Buy,
            buyerOneAmount
        );
        hook.reportSwap(
            POOL_ID,
            BUYER_TWO,
            address(bountyToken),
            address(quoteToken),
            BountyHook.SwapSide.Buy,
            buyerTwoAmount
        );

        BountyHook.BountyWindow memory window = hook.getWindow(windowId);
        uint256 totalClaimable = hook.claimable(windowId, BUYER_ONE) + hook.claimable(windowId, BUYER_TWO);
        require(totalClaimable <= window.totalBounty, "claimable exceeds bounty");
    }

    function _openWindow(uint256 sellAmount) private returns (bytes32 windowId) {
        _fundDumpApproval(sellAmount);
        return hook.reportSwap(
            POOL_ID,
            WHALE,
            address(bountyToken),
            address(quoteToken),
            BountyHook.SwapSide.Sell,
            sellAmount
        );
    }

    function _fundDumpApproval(uint256 sellAmount) private {
        uint256 bountyAmount = (sellAmount * hook.bountyBps()) / 10_000;
        require(bountyToken.transfer(WHALE, bountyAmount), "fund whale");
        vm.prank(WHALE);
        bountyToken.approve(address(hook), type(uint256).max);
    }
}
