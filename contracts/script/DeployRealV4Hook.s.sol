// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {BountyV4Hook} from "../src/hook/BountyV4Hook.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployRealV4Hook {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    uint160 private constant HOOK_FLAGS = Hooks.AFTER_SWAP_FLAG;

    event RealHookMined(address indexed hook, bytes32 salt, address indexed core, address indexed owner);

    function run() external returns (BountyV4Hook hook) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(privateKey);
        address core = vm.envAddress("BOUNTY_HOOK_ADDRESS");
        address poolManager = _poolManager();

        bytes memory constructorArgs = abi.encode(IPoolManager(poolManager), core, owner);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, HOOK_FLAGS, type(BountyV4Hook).creationCode, constructorArgs);

        vm.startBroadcast(privateKey);
        hook = new BountyV4Hook{salt: salt}(IPoolManager(poolManager), core, owner);
        vm.stopBroadcast();

        require(address(hook) == hookAddress, "hook address mismatch");
        emit RealHookMined(address(hook), salt, core, owner);
    }

    function _poolManager() private returns (address poolManager) {
        try vm.envAddress("V4_POOL_MANAGER") returns (address configured) {
            poolManager = configured;
        } catch {
            poolManager = SEPOLIA_POOL_MANAGER;
        }
    }
}
