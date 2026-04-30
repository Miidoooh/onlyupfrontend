// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyV4Hook} from "../src/hook/BountyV4Hook.sol";
import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploys a fresh BountyV4Hook with the correct chain-aware
///         IPoolManager and re-wires core/token to point at it. Token,
///         policy, and core stay in place — only the hook is replaced.
/// @dev Idempotent. Safe to re-run.
///        - Skips deploy if code already exists at the salt-mined address.
///        - Skips setReporter if core.reporter already equals the new hook.
///        - Skips setLimitExempt if token already exempts the new hook.
///
///      Required env: PRIVATE_KEY, BOUNTY_HOOK_ADDRESS (BountyHookCore),
///                    BOUNTY_TOKEN_ADDRESS, V4_POOL_MANAGER (defaults to
///                    mainnet PoolManager when chainid == 1).
///
///      After this runs, you MUST:
///        1. Update REAL_V4_HOOK_ADDRESS (and NEXT_PUBLIC_REAL_V4_HOOK_ADDRESS)
///           in .env to the address printed in the broadcast log.
///        2. Verify the new hook on Etherscan (npm run verify).
///        3. Create a NEW v4 pool with hooks=<new hook> in the PoolKey
///           (the old pool is permanently bound to the broken hook and
///           cannot be reused).
///        4. Run npm run post-deploy -- <new POOL_ID> --fee 3000 --tick 60
///           to register the pool with core + new hook.
contract RedeployHook {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant CREATE2_DEPLOYER     = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address private constant MAINNET_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address private constant SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;

    uint160 private constant HOOK_FLAGS = Hooks.AFTER_SWAP_FLAG;

    event HookRedeployed(
        address indexed newHook,
        address indexed core,
        address indexed token,
        bytes32 salt,
        bool deployed,
        bool reporterUpdated,
        bool exemptionAdded
    );

    function run() external returns (BountyV4Hook newHook) {
        (address mined, bytes32 salt) = _findHookAddress();

        bool needDeploy = mined.code.length == 0;
        bool needReporter = BountyHookCore(_core()).reporter() != mined;
        bool needExempt = !BountyLaunchToken(_token()).isLimitExempt(mined);

        if (needDeploy || needReporter || needExempt) {
            vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
            if (needDeploy) {
                newHook = new BountyV4Hook{salt: salt}(
                    IPoolManager(_poolManager()),
                    _core(),
                    vm.addr(vm.envUint("PRIVATE_KEY"))
                );
                require(address(newHook) == mined, "hook addr mismatch");
            } else {
                newHook = BountyV4Hook(mined);
            }
            if (needReporter) {
                BountyHookCore(_core()).setReporter(mined);
            }
            if (needExempt) {
                BountyLaunchToken(_token()).setLimitExempt(mined, true);
            }
            vm.stopBroadcast();
        } else {
            newHook = BountyV4Hook(mined);
        }

        emit HookRedeployed(mined, _core(), _token(), salt, needDeploy, needReporter, needExempt);
    }

    function _findHookAddress() private returns (address mined, bytes32 salt) {
        bytes memory ctorArgs = abi.encode(
            IPoolManager(_poolManager()),
            _core(),
            vm.addr(vm.envUint("PRIVATE_KEY"))
        );
        (mined, salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            HOOK_FLAGS,
            type(BountyV4Hook).creationCode,
            ctorArgs
        );
    }

    function _core() private returns (address) {
        return vm.envAddress("BOUNTY_HOOK_ADDRESS");
    }

    function _token() private returns (address) {
        return vm.envAddress("BOUNTY_TOKEN_ADDRESS");
    }

    function _poolManager() private returns (address) {
        try vm.envAddress("V4_POOL_MANAGER") returns (address configured) {
            if (configured != address(0)) return configured;
        } catch {}
        return block.chainid == 1 ? MAINNET_POOL_MANAGER : SEPOLIA_POOL_MANAGER;
    }
}
