// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BountyHookCore} from "../src/hook/BountyHookCore.sol";
import {BountyHookV4} from "../src/hook/BountyHookV4.sol";
import {BountyLaunchToken} from "../src/token/BountyLaunchToken.sol";

contract ConfigureLaunch {
    function configurePool(
        BountyLaunchToken token,
        BountyHookCore core,
        BountyHookV4 adapter,
        bytes32 poolId,
        address quoteToken,
        address poolManager,
        bool enableTrading
    ) external {
        token.setLimitExempt(address(core), true);
        token.setLimitExempt(address(adapter), true);
        token.setLimitExempt(poolManager, true);
        core.configurePool(poolId, address(token), quoteToken, true);
        adapter.configureRoute(poolId, address(token), quoteToken, true);
        if (enableTrading) {
            token.enableTrading();
        }
    }
}
