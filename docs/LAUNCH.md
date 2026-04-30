# Launch / relaunch playbook

This repo uses a **custom ERC‑20** (`contracts/src/token/BountyLaunchToken.sol`) plus **Uniswap v4** (`contracts/src/hook/BountyV4Hook.sol`, `BountyHookCore.sol`). There is no separate “Uniswap contract” in-repo: trading is **swaps against a v4 pool** created with your token, fee tier, tick spacing, and hook address.

## Why swaps can fail (even when “the hook works elsewhere”)

1. **Liquidity** — `initialize` sets price only. With **no LP positions**, effective swaps fail or quote as impossible. You must add liquidity via Uniswap v4 **Position Manager** (Sepolia: see addresses in deploy scripts).
2. **Wrong pool in the UI** — The pool key is `(currency0, currency1, fee, tickSpacing, hooks)`. If the app or link uses a **different fee/tick/hook** than your deployment, you are not in your pool.
3. **Native ETH vs WETH** — `DeployNativeEthRealV4Launch.s.sol` builds **ETH-native** pools (`currency0 = address(0)`). `InitializeRealV4Pool.s.sol` builds **token/WETH** pools. Those are **different pools**; routes and `.env` must match the one you actually use.
4. **Token gates** — Until `enableTrading()` is called, non-exempt wallets revert with `TradingDisabled`. Deploy scripts exempt Pool Manager, Permit2, Universal Router, Position Manager, core, and hook; retail wallets still need trading enabled for wallet-to-wallet transfers outside swaps.

The hook’s `afterSwap` **does not revert** on route mismatches (it emits `V4HookSkipped`). Swaps are gated by **Pool Manager / liquidity / token rules**, not by bounty reporting.

## One-command contract build + test + deploy (Sepolia)

Prerequisites:

- Install [Foundry](https://book.getfoundry.sh/).
- Repo-root `.env` (or shell env) includes at least:
  - `RPC_HTTP_URL` — HTTPS Sepolia endpoint (worker/API require HTTPS).
  - `PRIVATE_KEY` — deployer key with Sepolia ETH.
  - `BOUNTY_TOKEN_ADDRESS` — deployed `BountyLaunchToken` when running `DeployNativeEthRealV4Launch`.

Commands:

```bash
npm run contracts:build
npm run contracts:test
npm run deploy
```

`deploy` runs `DeployNativeEthRealV4Launch` on `sepolia` using `[rpc_endpoints]` in `contracts/foundry.toml` (`RPC_HTTP_URL`).

### Verification (Etherscan / Sourcify)

Set `ETHERSCAN_API_KEY` (Sepolia uses Etherscan API v2). Then either:

- Add `--verify` to the forge script invocation (see `npm run deploy:verify`), or  
- Verify each deployed contract manually with `forge verify-contract` + encoded constructor args.

### Sync `.env` after broadcast

```bash
node scripts/deploy/sync-env-from-broadcast.mjs DeployNativeEthRealV4Launch.s.sol
```

Copy printed addresses into `.env` / `.env.example` fields: `BOUNTY_HOOK_ADDRESS`, `REAL_V4_HOOK_ADDRESS`, `POOL_ID`, etc. Always cross-check **forge’s console logs** for `poolId` and contract order.

## Relaunch without “deleting everything”

- **New token + new pool:** Deploy token → run `DeployNativeEthRealV4Launch` (or hook-only + init scripts) → **append** new addresses in `.env` or use a second env file (e.g. `.env.sepolia.v2`). Point `NEXT_PUBLIC_*` and worker/API at the addresses you want live.
- **Same contracts, fix route:** Use `ConfigureNativeEthV4Route.s.sol` / `InitializeRealV4Pool.s.sol` with matching `V4_FEE`, `V4_TICK_SPACING`, `WETH_ADDRESS`, `V4_POOL_MANAGER`. Defaults for native ETH route script match **fee 10000**, **tickSpacing 200**.

## Indexer / “nodes not connecting”

- Worker **must** use an **HTTPS** RPC URL (`RPC_HTTP_URL`). Many providers reject or mishandle `wss://` when the code expects HTTP JSON-RPC.
- Run `npm run doctor` after updating `.env` to validate RPC, contracts, API, and checkpoint.

## Native ETH only (Sepolia launch)

The production launch script `DeployNativeEthRealV4Launch.s.sol` builds **native ETH** pools (`currency0 = address(0)`), **fee = 10_000** (1%), **tickSpacing = 200**. Uniswap’s Sepolia UI often **does not auto-route** custom v4 hook pools—use the site’s **“direct v4 router”** panel and ensure `.env` matches forge:

- `POOL_ID`, `V4_FEE`, `V4_TICK_SPACING`
- Same values mirrored for Next.js: `NEXT_PUBLIC_V4_POOL_FEE`, `NEXT_PUBLIC_V4_TICK_SPACING`, `NEXT_PUBLIC_BOUNTY_TOKEN_ADDRESS`, `NEXT_PUBLIC_REAL_V4_HOOK_ADDRESS`

If fee/tick/hook/token don’t match the deployed `PoolKey`, the v4 quoter returns nothing—same symptom as “no route” on the main Uniswap page.

## Investor-facing Uniswap

On **Sepolia**, the production Uniswap web app may not list every v4 pool. Investors may need **your official pool link**, embedded **pool id / pool key**, or a **mainnet** deployment for full discoverability. Document the exact **chain id**, **token address**, and **pool parameters** you support.
