// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

interface Vm {
    function envAddress(string calldata key) external returns (address);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Finishes a partially-broadcast DeployFreshNativeEthLaunch run.
/// @dev Idempotent. Reads on-chain state and only sends the txs that are
///      still missing:
///        1. BountyLaunchToken.enableTrading()                 — if not yet enabled
///        2. BountyLaunchToken.setLimitExempt(addr, true)      — for the six v4
///           plumbing addresses, skipping any already exempt.
///
///      Reads BOUNTY_TOKEN_ADDRESS, BOUNTY_HOOK_ADDRESS, REAL_V4_HOOK_ADDRESS
///      from .env. V4 router/manager/permit2 default to chain-aware constants
///      so V4_POOL_MANAGER / V4_POSITION_MANAGER / PERMIT2_ADDRESS /
///      UNIVERSAL_ROUTER are optional overrides.
contract FinishLaunch {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Mainnet v4 deployment.
    address private constant MAINNET_POOL_MANAGER     = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address private constant MAINNET_POSITION_MANAGER = 0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e;
    address private constant MAINNET_PERMIT2          = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant MAINNET_UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;

    // Sepolia v4 deployment.
    address private constant SEPOLIA_POOL_MANAGER     = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant SEPOLIA_POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address private constant SEPOLIA_PERMIT2          = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant SEPOLIA_UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;

    event LaunchFinished(
        address indexed token,
        bool tradingEnabled,
        uint8 newExemptionsBroadcast
    );

    function run() external returns (bool, uint8) {
        BountyLaunchToken token = BountyLaunchToken(vm.envAddress("BOUNTY_TOKEN_ADDRESS"));
        address[6] memory targets = _resolveTargets();

        bool tradingAlready = token.tradingEnabled();
        bool[6] memory needs;
        uint8 needCount;
        for (uint256 i = 0; i < 6; i++) {
            if (targets[i] == address(0)) continue;
            if (!token.isLimitExempt(targets[i])) {
                needs[i] = true;
                needCount++;
            }
        }

        if (tradingAlready && needCount == 0) {
            emit LaunchFinished(address(token), true, 0);
            return (true, 0);
        }

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        if (!tradingAlready) {
            token.enableTrading();
        }
        for (uint256 i = 0; i < 6; i++) {
            if (needs[i]) {
                token.setLimitExempt(targets[i], true);
            }
        }
        vm.stopBroadcast();

        emit LaunchFinished(address(token), true, needCount);
        return (true, needCount);
    }

    function _resolveTargets() private returns (address[6] memory targets) {
        bool isMainnet = block.chainid == 1;
        targets[0] = _envAddressOr("V4_POOL_MANAGER",     isMainnet ? MAINNET_POOL_MANAGER     : SEPOLIA_POOL_MANAGER);
        targets[1] = _envAddressOr("V4_POSITION_MANAGER", isMainnet ? MAINNET_POSITION_MANAGER : SEPOLIA_POSITION_MANAGER);
        targets[2] = _envAddressOr("PERMIT2_ADDRESS",     isMainnet ? MAINNET_PERMIT2          : SEPOLIA_PERMIT2);
        targets[3] = _envAddressOr("UNIVERSAL_ROUTER",    isMainnet ? MAINNET_UNIVERSAL_ROUTER : SEPOLIA_UNIVERSAL_ROUTER);
        targets[4] = vm.envAddress("BOUNTY_HOOK_ADDRESS");
        targets[5] = vm.envAddress("REAL_V4_HOOK_ADDRESS");
    }

    function _envAddressOr(string memory key, address fallbackValue) private returns (address) {
        try vm.envAddress(key) returns (address configured) {
            return configured == address(0) ? fallbackValue : configured;
        } catch {
            return fallbackValue;
        }
    }
}
