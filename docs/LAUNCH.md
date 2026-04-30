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

### Verification (Etherscan)

Set `ETHERSCAN_API_KEY` in `.env` (works for mainnet **and** Sepolia via Etherscan v2). Two ways:

- **`npm run deploy:verify`** — broadcasts AND verifies in the right order.
- **`npm run verify`** — verifies the **last broadcast** without redeploying.

Both call `scripts/deploy/verify-contracts.mjs`, which is intentionally narrow:

1. **Reads only** the most recent `contracts/broadcast/<script>/<chainId>/run-latest.json`.
2. **Verifies only the four real launch contracts**, in this stack order:
   1. `BountyLaunchToken` *(token first — investors see this verified before anything else)*
   2. `NetSellPressureBountyPolicy`
   3. `BountyHookCore`
   4. `BountyV4Hook`
3. **Skips** function-call transactions, libraries, the deploy script itself, and the `Vm` interface.
4. Encodes constructor args via `cast abi-encode` from the `arguments` field in the broadcast JSON, so verification matches the on-chain bytecode exactly.

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

## Mainnet launch checklist

Everything that needs to flip when going from Sepolia to mainnet. Nothing is hardcoded to Sepolia anymore — every chain-specific value reads from env / `block.chainid`.

### 1. Rotate keys

The Sepolia `PRIVATE_KEY` in `.env` was used in chat / screenshots / git diffs. **Generate a new wallet for mainnet.** Send only the gas you need, and store the key in a password manager / hardware wallet.

### 2. `.env` for mainnet

```bash
CHAIN_ID=1
RPC_HTTP_URL=https://ethereum-rpc.publicnode.com   # or your own paid RPC
RPC_WS_URL=

# Filled by `npm run deploy` automatically.
BOUNTY_HOOK_ADDRESS=
BOUNTY_TOKEN_ADDRESS=
REAL_V4_HOOK_ADDRESS=
POLICY_ADDRESS=

# Pool key — set after you create the pool through the Uniswap mainnet UI.
POOL_ID=
V4_FEE=10000
V4_TICK_SPACING=200

# v4 mainnet defaults (DeployFreshNativeEthLaunch already knows these; only
# override if Uniswap publishes new addresses).
# V4_POOL_MANAGER=0x000000000004444c5dc75cB358380D2e3dE08A90
# V4_POSITION_MANAGER=0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e
# UNIVERSAL_ROUTER=0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af

PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...

# Web — same chain, mirrored env so the swap panel matches your PoolKey.
NEXT_PUBLIC_CHAIN_ID=1
NEXT_PUBLIC_RPC_HTTP_URL=https://ethereum-rpc.publicnode.com
NEXT_PUBLIC_BOUNTY_TOKEN_ADDRESS=
NEXT_PUBLIC_REAL_V4_HOOK_ADDRESS=
NEXT_PUBLIC_BOUNTY_HOOK_ADDRESS=
NEXT_PUBLIC_V4_POOL_FEE=10000
NEXT_PUBLIC_V4_TICK_SPACING=200
NEXT_PUBLIC_API_URL=https://api.your-host  # or http://localhost:4311 if you self-host
```

### 3. Deploy

```bash
npm run deploy        # builds, tests, broadcasts, syncs .env
# OR
npm run deploy:verify # same + ordered Etherscan verify (token → policy → core → hook)
# OR (re-verify a previous broadcast, no redeploy)
npm run verify
```

`DeployFreshNativeEthLaunch` reads `block.chainid`. Chain id `1` ⇒ uses **mainnet** PoolManager / PositionManager / Permit2 / UniversalRouter constants. Chain id anything else ⇒ Sepolia constants. Per-address overrides via env still win if you deploy on an L2.

### 4. Create pool + add liquidity (manual, on Uniswap)

On the Uniswap **mainnet** UI:

- **currency0** = `0x0000000000000000000000000000000000000000` (native ETH)
- **currency1** = `BOUNTY_TOKEN_ADDRESS` from `.env`
- **fee** = whatever you want (`10000` = 1%, `3000` = 0.3%, etc.) — note the value
- **tickSpacing** = matching ticks (`200` for fee 10000, `60` for fee 3000) — note the value
- **hooks** = `REAL_V4_HOOK_ADDRESS` from `.env`

Add liquidity in-range so the v4 quoter actually returns a quote. Copy the **PoolId** that the UI shows.

### 5. Flip the bounty switch + sync everything

Run **one command** with the pool id and the fee/tick you used:

```bash
npm run post-deploy -- 0xYOUR_POOL_ID --fee 3000 --tick 60
```

This script:

1. Writes `POOL_ID`, `V4_FEE`, `V4_TICK_SPACING`, `NEXT_PUBLIC_V4_POOL_FEE`, `NEXT_PUBLIC_V4_TICK_SPACING` into root `.env`.
2. Broadcasts `ConfigureNativeEthV4Route.s.sol` — calls `core.configurePool(...)` and `hook.configureRoute(...)`. **This is the on-chain step that turns bounty events on for your pool.** Until you run it, `BountyV4Hook._afterSwap` just emits `V4HookSkipped(SKIP_ROUTE_DISABLED)` for every swap; trades succeed but the dashboard stays empty.
3. Resets `apps/worker/.checkpoint` so the indexer re-scans from your deploy block.
4. Runs `npm run doctor` for a green-light read of the whole stack.

### 6. Worker / API hosting

`apps/api` and `apps/worker` are stateless Node apps. Any Render / Fly / Railway / VPS works. Set the same `.env`, expose `apps/api` on a public URL, and update `NEXT_PUBLIC_API_URL` on Vercel. Without this, the live feed / leaderboard sections of the website show empty (the swap panel itself still works because it talks to RPC + Universal Router directly).

### 7. Vercel

Push the `NEXT_PUBLIC_*` values from `.env` into the Vercel project's environment variables UI, then redeploy. **Do NOT** push `PRIVATE_KEY`, `ETHERSCAN_API_KEY`, or `WORKER_INGEST_SECRET`.

### 8. Verify everything is green

```bash
npm run doctor        # full system check across .env, RPC, contracts, API, worker
npm run check-quote   # confirms v4 quoter accepts swaps for your PoolKey
```

If both pass, the dashboard is live, the swap panel routes, and the indexer is ingesting bounty events. People can swap on Uniswap (or your /buy panel); the website updates within ~12 s.
