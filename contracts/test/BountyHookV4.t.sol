// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyHookV4} from "../src/hook/BountyHookV4.sol";
import {NetSellPressureBountyPolicy} from "../src/policy/NetSellPressureBountyPolicy.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

interface Vm {
    function prank(address sender) external;
}

contract BountyHookV4Test {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant POOL_ID = keccak256("BHOOK/ETH");
    address private constant WHALE = address(0xA11CE);
    address private constant POOL_MANAGER = address(0xF00D);

    BountyHookCore private core;
    BountyHookV4 private adapter;
    NetSellPressureBountyPolicy private policy;
    MockERC20 private bountyToken;
    MockERC20 private quoteToken;

    function setUp() public {
        policy = new NetSellPressureBountyPolicy(address(this), 500, 1_000, 5, 12);
        core = new BountyHookCore(address(this), address(this), address(policy), 50, 10 ether);
        policy.setHook(address(core));
        adapter = new BountyHookV4(address(this), POOL_MANAGER, address(core));
        core.setReporter(address(adapter));
        bountyToken = new MockERC20("Bounty Hook", "BHOOK");
        quoteToken = new MockERC20("Ether", "ETH");
        bountyToken.mint(WHALE, 1_000 ether);
        core.configurePool(POOL_ID, address(bountyToken), address(quoteToken), true);
        adapter.configureRoute(POOL_ID, address(bountyToken), address(quoteToken), true);
        vm.prank(WHALE);
        bountyToken.approve(address(core), type(uint256).max);
    }

    function testPoolManagerCanReportSellRoute() public {
        vm.prank(POOL_MANAGER);
        bytes32 windowId =
            adapter.reportAfterSwap(POOL_ID, WHALE, address(bountyToken), address(quoteToken), 100 ether);

        BountyHookCore.BountyWindow memory window = core.getWindow(windowId);
        require(window.totalBounty == 10 ether, "v4 sell");
    }

    function testRejectsNonPoolManager() public {
        bool reverted;
        try adapter.reportAfterSwap(POOL_ID, WHALE, address(bountyToken), address(quoteToken), 100 ether) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "pool manager gate");
    }
}
