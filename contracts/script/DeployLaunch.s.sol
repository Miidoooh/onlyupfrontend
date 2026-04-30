// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyHookV4} from "../src/hook/BountyHookV4.sol";
import {LaunchConfig} from "../src/launch/LaunchConfig.sol";
import {NetSellPressureBountyPolicy} from "../src/policy/NetSellPressureBountyPolicy.sol";
import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployLaunch {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant SEPOLIA_WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    bytes32 private constant DEMO_POOL_ID = keccak256("BHOOK/WETH-SEPOLIA");

    struct Deployment {
        BountyLaunchToken token;
        NetSellPressureBountyPolicy policy;
        BountyHookCore core;
        BountyHookV4 adapter;
    }

    event DeploymentReady(
        address indexed token,
        address indexed policy,
        address indexed core,
        address adapter,
        address owner,
        bytes32 poolId
    );

    function run() external returns (Deployment memory deployment) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);
        deployment = _deploy(
            "Bounty Hook",
            "BHOOK",
            deployer,
            deployer,
            deployer,
            DEMO_POOL_ID,
            SEPOLIA_WETH,
            10 ether
        );
        vm.stopBroadcast();

        emit DeploymentReady(
            address(deployment.token),
            address(deployment.policy),
            address(deployment.core),
            address(deployment.adapter),
            deployer,
            DEMO_POOL_ID
        );
    }

    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        address treasury,
        address poolManager,
        bytes32 poolId,
        address quoteToken,
        uint256 minDumpAmount
    ) external returns (Deployment memory deployment) {
        return _deploy(name, symbol, owner, treasury, poolManager, poolId, quoteToken, minDumpAmount);
    }

    function _deploy(
        string memory name,
        string memory symbol,
        address owner,
        address treasury,
        address poolManager,
        bytes32 poolId,
        address quoteToken,
        uint256 minDumpAmount
    ) private returns (Deployment memory deployment) {
        deployment.token = new BountyLaunchToken(name, symbol, owner, treasury);
        deployment.policy = new NetSellPressureBountyPolicy(
            owner,
            LaunchConfig.BASE_BOUNTY_BPS,
            LaunchConfig.MAX_DYNAMIC_BOUNTY_BPS,
            LaunchConfig.PRESSURE_BUCKET_BLOCKS,
            LaunchConfig.PRESSURE_BUCKET_COUNT
        );
        deployment.core = new BountyHookCore(
            owner,
            owner,
            address(deployment.policy),
            LaunchConfig.BOUNTY_WINDOW_BLOCKS,
            minDumpAmount
        );
        deployment.adapter = new BountyHookV4(owner, poolManager, address(deployment.core));

        deployment.policy.setHook(address(deployment.core));
        deployment.core.setReporter(address(deployment.adapter));
        deployment.core.configurePool(poolId, address(deployment.token), quoteToken, true);
        deployment.adapter.configureRoute(poolId, address(deployment.token), quoteToken, true);
        deployment.token.setLimitExempt(address(deployment.core), true);
        deployment.token.setLimitExempt(address(deployment.adapter), true);
        deployment.token.setLimitExempt(poolManager, true);
    }
}
