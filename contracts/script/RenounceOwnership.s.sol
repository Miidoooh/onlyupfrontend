// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";
import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyV4Hook} from "../src/hook/BountyV4Hook.sol";
import {NetSellPressureBountyPolicy} from "../src/policy/NetSellPressureBountyPolicy.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function envAddress(string calldata key) external returns (address);
    function envBool(string calldata key) external returns (bool);
    function envUint(string calldata key) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Permanently renounces ownership of the launch contracts.
/// @dev Renouncing does NOT put holder funds at risk. None of the four
///      `onlyOwner` surfaces (token launch knobs, hook routes, core pool
///      config, policy hook wiring) can move balances, mint, burn, change
///      `totalSupply` (it's `immutable`), or pull liquidity. What you lose
///      is the ability to ever re-tune anti-bot limits, whitelist new
///      routers, flag new AMM pairs, or swap out the hook if a bug
///      surfaces — the current configuration becomes load-bearing forever.
///
///      `BountyLaunchToken` is 2-step `Ownable` and ships WITHOUT a
///      `renounceOwnership()`. `transferOwnership(0xdEaD)` alone does
///      nothing — `0xdEaD` cannot call `acceptOwnership`, so `owner`
///      stays with the deployer. We deploy a single-purpose
///      {TokenOwnershipSink} whose only function is to call
///      `acceptOwnership` exactly once. After it does, the token's
///      `owner` slot points at a contract with zero admin surface, which
///      is operationally equivalent to renouncement.
///
///      The other three (BountyHookCore / BountyV4Hook /
///      NetSellPressureBountyPolicy) use single-step `transferOwnership`
///      with a non-zero check, so they renounce cleanly to `0x…dEaD`.
///
///      Idempotent: each leg checks `owner() == sender` first, so re-runs
///      after partial success are no-ops on already-renounced contracts.
///
/// Required env:
///   PRIVATE_KEY            — the current owner of all four contracts
///   BOUNTY_TOKEN_ADDRESS   — BountyLaunchToken
///   BOUNTY_HOOK_ADDRESS    — BountyHookCore
///   REAL_V4_HOOK_ADDRESS   — BountyV4Hook
///   POLICY_ADDRESS         — NetSellPressureBountyPolicy
///
/// Optional toggles (default true; set =false in env to skip a leg):
///   RENOUNCE_TOKEN
///   RENOUNCE_CORE
///   RENOUNCE_HOOK
///   RENOUNCE_POLICY
contract RenounceOwnership {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// @dev EIP-1191 dead address. Non-zero so the contracts' `address(0)` guards pass.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    event RenouncedDirect(address indexed contractAddr, address indexed previousOwner, address indexed newOwner);
    event RenouncedViaSink(address indexed token, address indexed sink, address indexed previousOwner);
    event RenounceSkipped(address indexed contractAddr, bytes32 reason);

    function run() external returns (address tokenSink) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address sender = vm.addr(pk);

        BountyLaunchToken token = BountyLaunchToken(vm.envAddress("BOUNTY_TOKEN_ADDRESS"));
        BountyHookCore core = BountyHookCore(vm.envAddress("BOUNTY_HOOK_ADDRESS"));
        BountyV4Hook hook = BountyV4Hook(vm.envAddress("REAL_V4_HOOK_ADDRESS"));
        NetSellPressureBountyPolicy policy = NetSellPressureBountyPolicy(vm.envAddress("POLICY_ADDRESS"));

        bool wantToken = _envBoolOr("RENOUNCE_TOKEN", true);
        bool wantCore = _envBoolOr("RENOUNCE_CORE", true);
        bool wantHook = _envBoolOr("RENOUNCE_HOOK", true);
        bool wantPolicy = _envBoolOr("RENOUNCE_POLICY", true);

        vm.startBroadcast(pk);

        // Order: policy → hook → core → token. The token is last because
        // the sink deployment + accept is the heaviest leg; if anything
        // breaks earlier we'd rather not have an orphan sink contract.
        if (wantPolicy) {
            if (policy.owner() == sender) {
                policy.transferOwnership(BURN);
                emit RenouncedDirect(address(policy), sender, BURN);
            } else {
                emit RenounceSkipped(address(policy), "ALREADY_RENOUNCED");
            }
        }

        if (wantHook) {
            if (hook.owner() == sender) {
                hook.transferOwnership(BURN);
                emit RenouncedDirect(address(hook), sender, BURN);
            } else {
                emit RenounceSkipped(address(hook), "ALREADY_RENOUNCED");
            }
        }

        if (wantCore) {
            if (core.owner() == sender) {
                core.transferOwnership(BURN);
                emit RenouncedDirect(address(core), sender, BURN);
            } else {
                emit RenounceSkipped(address(core), "ALREADY_RENOUNCED");
            }
        }

        if (wantToken) {
            if (token.owner() == sender) {
                TokenOwnershipSink sink = new TokenOwnershipSink(address(token));
                token.transferOwnership(address(sink));
                sink.finalize();
                tokenSink = address(sink);
                emit RenouncedViaSink(address(token), address(sink), sender);
            } else {
                emit RenounceSkipped(address(token), "ALREADY_RENOUNCED");
            }
        }

        vm.stopBroadcast();
    }

    function _envBoolOr(string memory key, bool fallbackValue) private returns (bool) {
        try vm.envBool(key) returns (bool configured) {
            return configured;
        } catch {
            return fallbackValue;
        }
    }
}

/// @notice Single-purpose accepter for `BountyLaunchToken`'s 2-step Ownable.
///         The constructor pins the target token address. `finalize()`
///         calls `acceptOwnership()` exactly once and sets the irrevocable
///         `finalized` flag. After that, the sink IS the token's owner, but
///         it exposes zero admin functions on the token, so the token's
///         entire `onlyOwner` surface is permanently inert.
/// @dev Anyone can call `finalize()`. That's deliberate and safe — the
///      function only forwards the one-shot `acceptOwnership` and never
///      calls any other token method. There is no path here that can
///      `setLimits`, exempt addresses, flag AMM pairs, or transfer
///      ownership onward. Verifiable on Etherscan in ~30 lines of code.
contract TokenOwnershipSink {
    address public immutable token;
    bool public finalized;

    error AlreadyFinalized();
    error TokenAddressZero();

    event SinkFinalized(address indexed token, address indexed sink);

    constructor(address tokenAddr) {
        if (tokenAddr == address(0)) revert TokenAddressZero();
        token = tokenAddr;
    }

    function finalize() external {
        if (finalized) revert AlreadyFinalized();
        finalized = true;
        BountyLaunchToken(token).acceptOwnership();
        emit SinkFinalized(token, address(this));
    }
}
