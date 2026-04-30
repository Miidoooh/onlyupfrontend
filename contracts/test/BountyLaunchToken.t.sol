// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

interface Vm {
    function prank(address sender) external;
}

contract BountyLaunchTokenTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant TREASURY = address(0xBEEF);
    address private constant PAIR = address(0xCAFE);
    address private constant HUNTER = address(0xB01);

    BountyLaunchToken private token;

    function setUp() public {
        token = new BountyLaunchToken("Bounty Hook", "BHOOK", OWNER, TREASURY);
    }

    function testInitialSupplyAndOnePercentLimits() public view {
        require(token.totalSupply() == 1_000_000_000 ether, "supply");
        require(token.maxTxAmount() == 10_000_000 ether, "max tx");
        require(token.maxWalletAmount() == 10_000_000 ether, "max wallet");
    }

    function testTradingGateBlocksNonExemptTransfers() public {
        vm.prank(TREASURY);
        require(token.transfer(HUNTER, 1 ether), "seed hunter");

        bool reverted;
        vm.prank(HUNTER);
        try token.transfer(address(0xB02), 1 ether) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "trading gate");
    }

    function testOwnerCanEnableTradingAndSetPair() public {
        vm.prank(OWNER);
        token.enableTrading();
        vm.prank(OWNER);
        token.setAutomatedMarketMakerPair(PAIR, true);

        vm.prank(TREASURY);
        require(token.transfer(HUNTER, 1 ether), "seed hunter");
        vm.prank(HUNTER);
        require(token.transfer(PAIR, 1 ether), "sell to pair");

        require(token.balanceOf(PAIR) == 1 ether, "pair sell");
    }

    function testMaxWalletLimit() public {
        vm.prank(OWNER);
        token.enableTrading();

        bool reverted;
        vm.prank(TREASURY);
        try token.transfer(HUNTER, token.maxWalletAmount() + 1) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "max wallet");
    }

    function testTwoStepOwnership() public {
        address nextOwner = address(0xDAD);
        vm.prank(OWNER);
        token.transferOwnership(nextOwner);
        vm.prank(nextOwner);
        token.acceptOwnership();

        require(token.owner() == nextOwner, "owner");
    }
}
