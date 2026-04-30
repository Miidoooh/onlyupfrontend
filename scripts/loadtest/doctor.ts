/**
 * Only Up — wire doctor.
 *
 * Verifies the full pipeline against real Sepolia (not a fork):
 *
 *    chain  →  BountyHookCore  →  worker  →  API  →  website
 *
 * Tells you exactly what's broken and what to put in .env. No state changes.
 *
 *   Run:  npm run doctor
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  http,
  type Address,
  type PublicClient
} from "viem";
import { sepolia } from "viem/chains";
import {
  ADDR,
  CONFIG,
  KNOWN_POOLS,
  SEPOLIA_CHAIN_ID,
  coreAbi,
  tokenAbi
} from "./config.js";

const colors = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m"
};
const c = (s: string, color: keyof typeof colors) => `${colors[color]}${s}${colors.reset}`;

let issues: string[] = [];
let warnings: string[] = [];

function ok(label: string, value?: string) {
  console.log(`  ${c("✓", "green")} ${label.padEnd(28)} ${value ?? ""}`);
}
function warn(label: string, value?: string) {
  console.log(`  ${c("⚠", "yellow")} ${label.padEnd(28)} ${value ?? ""}`);
  warnings.push(label);
}
function fail(label: string, value?: string) {
  console.log(`  ${c("✗", "red")} ${label.padEnd(28)} ${value ?? ""}`);
  issues.push(label);
}
function divider(title: string) {
  const line = "─".repeat(Math.max(2, 60 - title.length));
  console.log(`\n${c(`▲ ${title} `, "green")}${c(line, "gray")}`);
}

/* ============================================================ *
 *  1.  ENV
 * ============================================================ */
function checkEnv(): { rpcHttp: string; apiUrl: string } {
  divider("ENV");

  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    fail(".env file", "missing at repo root");
    return { rpcHttp: "", apiUrl: "" };
  }
  ok(".env file", envPath);

  const rpcRaw = process.env.RPC_HTTP_URL ?? "";
  let rpcHttp = rpcRaw;
  if (!rpcRaw) {
    fail("RPC_HTTP_URL", "missing");
  } else if (rpcRaw.startsWith("wss://")) {
    rpcHttp = rpcRaw.replace("wss://", "https://");
    warn("RPC_HTTP_URL", `${rpcRaw}  ← should be https://, will auto-convert for this run`);
  } else {
    ok("RPC_HTTP_URL", rpcRaw);
  }

  const coreAddr = process.env.BOUNTY_HOOK_ADDRESS ?? "";
  if (!coreAddr || /^0x0{40}$/i.test(coreAddr)) {
    fail("BOUNTY_HOOK_ADDRESS", `missing — must be ${c("BountyHookCore", "cyan")} (event emitter), not the v4 hook`);
  } else {
    ok("BOUNTY_HOOK_ADDRESS", coreAddr);
  }

  const v4HookEnv = process.env.REAL_V4_HOOK_ADDRESS ?? "";
  if (v4HookEnv && coreAddr && v4HookEnv.toLowerCase() === coreAddr.toLowerCase()) {
    fail(
      "REAL_V4_HOOK_ADDRESS",
      "same as BOUNTY_HOOK_ADDRESS — v4 hook address must differ from BountyHookCore"
    );
  } else if (v4HookEnv && /^0x[a-fA-F0-9]{40}$/i.test(v4HookEnv)) {
    ok("REAL_V4_HOOK_ADDRESS", v4HookEnv);
  } else {
    warn("REAL_V4_HOOK_ADDRESS", "unset — doctor cannot cross-check core.reporter vs hook");
  }

  const token = process.env.BOUNTY_TOKEN_ADDRESS ?? "";
  if (!token || /^0x0{40}$/i.test(token)) {
    fail("BOUNTY_TOKEN_ADDRESS", "missing — ERC-20 CA required for API `/launch` + website CA box");
  } else {
    ok("BOUNTY_TOKEN_ADDRESS", token);
  }

  const poolId = process.env.POOL_ID ?? "";
  if (!poolId || !/^0x[a-fA-F0-9]{64}$/i.test(poolId)) {
    fail("POOL_ID", "missing or not a 32-byte hex — must match PoolKey.toId() for your native ETH pool");
  } else {
    ok("POOL_ID", `${poolId.slice(0, 18)}…`);
  }

  const fee = process.env.V4_FEE ?? process.env.NEXT_PUBLIC_V4_POOL_FEE ?? "";
  const tick = process.env.V4_TICK_SPACING ?? process.env.NEXT_PUBLIC_V4_TICK_SPACING ?? "";
  if (!fee || !tick) {
    warn(
      "fee/tick vs web",
      "set V4_FEE + V4_TICK_SPACING (and mirror NEXT_PUBLIC_* for Next.js) so swap panel matches forge deploy"
    );
  } else {
    ok("v4 fee/tick (.env)", `${fee} / ${tick} — native ETH launch is typically 10000 / 200`);
  }

  const startBlock = process.env.WORKER_START_BLOCK ?? "0";
  const startBn = BigInt(startBlock);
  if (startBn === 0n) {
    fail("WORKER_START_BLOCK", "0  ← querying from genesis will be rejected by most RPCs. Set this to a recent block (e.g., a few thousand before the deploy).");
  } else {
    ok("WORKER_START_BLOCK", startBlock);
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? "4311"}`;
  ok("API URL (web reads)", apiUrl);

  return { rpcHttp, apiUrl };
}

/* ============================================================ *
 *  2.  CHAIN
 * ============================================================ */
async function checkChain(rpcHttp: string): Promise<PublicClient | undefined> {
  divider("CHAIN");
  if (!rpcHttp) {
    fail("rpc", "skipped (no RPC_HTTP_URL)");
    return undefined;
  }
  try {
    const client = createPublicClient({ chain: sepolia, transport: http(rpcHttp) }) as PublicClient;
    const chainId = await client.getChainId();
    if (chainId === SEPOLIA_CHAIN_ID) ok("chainId", chainId.toString());
    else fail("chainId", `${chainId} (expected ${SEPOLIA_CHAIN_ID})`);
    const block = await client.getBlockNumber();
    ok("latest block", block.toString());
    return client;
  } catch (err) {
    fail("rpc", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

/* ============================================================ *
 *  3.  CONTRACTS
 * ============================================================ */
async function checkContracts(client: PublicClient) {
  divider("CONTRACTS (deployed)");

  const hasCode = async (label: string, addr: Address) => {
    const code = await client.getBytecode({ address: addr });
    if (!code || code === "0x") {
      fail(label, `${addr}  ← no code at this address on Sepolia`);
      return false;
    }
    ok(label, addr);
    return true;
  };

  const tokenOk = await hasCode("token (UP)", ADDR.TOKEN);
  const coreOk = await hasCode("core",      ADDR.CORE);
  const v4Ok   = await hasCode("v4 hook",   ADDR.V4_HOOK);
  if (!tokenOk || !coreOk) return;

  /* core wiring */
  try {
    const [owner, reporter, windowBlocks, minDump, activeWindow] = await Promise.all([
      client.readContract({ address: ADDR.CORE, abi: coreAbi, functionName: "owner" }),
      client.readContract({ address: ADDR.CORE, abi: coreAbi, functionName: "reporter" }),
      client.readContract({ address: ADDR.CORE, abi: coreAbi, functionName: "bountyWindowBlocks" }),
      client.readContract({ address: ADDR.CORE, abi: coreAbi, functionName: "minDumpAmount" }),
      client.readContract({ address: ADDR.CORE, abi: coreAbi, functionName: "activeWindowByPool", args: [ADDR.POOL_ID] })
    ]);
    ok("core.owner",          owner);
    if (reporter.toLowerCase() === ADDR.V4_HOOK.toLowerCase()) {
      ok("core.reporter",     `${reporter} ${c("(v4 hook ✓)", "gray")}`);
    } else {
      fail("core.reporter",   `${reporter}  ← expected ${ADDR.V4_HOOK}`);
    }
    ok("core.bountyWindow",   `${windowBlocks} blocks`);
    ok("core.minDump",        `${(Number(minDump) / 1e18).toString()} UP`);

    if (activeWindow !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
      ok("active window", String(activeWindow));
    } else {
      console.log(`  ${c("·", "gray")} active window               ${c("none", "gray")}`);
    }
  } catch (err) {
    fail("core.read", err instanceof Error ? err.message : String(err));
  }

  /* token wiring */
  try {
    const tokenOwner = await client.readContract({
      address: ADDR.TOKEN,
      abi: tokenAbi,
      functionName: "owner"
    });
    const [trading, ownerBalance] = await Promise.all([
      client.readContract({ address: ADDR.TOKEN, abi: tokenAbi, functionName: "tradingEnabled" }),
      client.readContract({ address: ADDR.TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [tokenOwner] })
    ]);
    ok("token.owner", tokenOwner);
    if (trading) ok("token.tradingEnabled", "yes");
    else warn("token.tradingEnabled", "false  ← buyers can't transfer until owner calls enableTrading()");
    ok("token.owner UP balance", `${(Number(ownerBalance) / 1e18).toLocaleString()} UP`);
  } catch (err) {
    fail("token.read", err instanceof Error ? err.message : String(err));
  }

  /* v4 adapter wiring (best-effort) */
  if (v4Ok) {
    const v4Abi = [{
      type: "function", name: "routes", stateMutability: "view",
      inputs: [{ name: "p", type: "bytes32" }],
      outputs: [
        { name: "bountyCurrency", type: "address" },
        { name: "quoteCurrency",  type: "address" },
        { name: "enabled",        type: "bool" }
      ]
    }] as const;
    try {
      const route = (await client.readContract({
        address: ADDR.V4_HOOK, abi: v4Abi, functionName: "routes", args: [ADDR.POOL_ID]
      })) as readonly [Address, Address, boolean];
      const [bountyCur, quoteCur, enabled] = route;
      if (enabled && bountyCur.toLowerCase() === ADDR.TOKEN.toLowerCase()) {
        ok("v4 hook route", `enabled, bounty=UP, quote=${quoteCur === ADDR.NATIVE_ETH ? "ETH" : quoteCur}`);
      } else {
        fail("v4 hook route", `enabled=${enabled} bounty=${bountyCur}  ← pool isn't routed through the hook`);
      }
    } catch {
      warn("v4 hook route", "unreadable");
    }
  }
}

/* ============================================================ *
 *  4.  ON-CHAIN EVENTS — has the hook ever fired?
 * ============================================================ */
async function checkEvents(client: PublicClient) {
  divider("ON-CHAIN EVENTS (last 50k blocks)");
  const latest = await client.getBlockNumber();
  const lookback = 50_000n;
  const from = latest > lookback ? latest - lookback : 0n;

  const eventNames = ["BountyOpened","BountyFunded","BountyBuyRecorded","BountyPressureUpdated","BountyWindowClosed","BountyClaimed"] as const;
  const counts: Record<string, number> = {};
  let total = 0;

  /* chunk the range so a single huge query doesn't get rejected */
  const CHUNK = 5000n;
  for (let cursor = from; cursor <= latest; cursor += CHUNK + 1n) {
    const to = (cursor + CHUNK) > latest ? latest : (cursor + CHUNK);
    try {
      const logs = await client.getContractEvents({
        address: ADDR.CORE,
        abi: coreAbi,
        fromBlock: cursor,
        toBlock: to
      });
      for (const log of logs) {
        const name = log.eventName ?? "unknown";
        counts[name] = (counts[name] ?? 0) + 1;
        total += 1;
      }
    } catch (err) {
      warn("getContractEvents", `${cursor}-${to}: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    }
  }

  for (const name of eventNames) {
    const n = counts[name] ?? 0;
    if (n > 0) ok(name, n.toString());
    else        console.log(`  ${c("·", "gray")} ${name.padEnd(28)} 0`);
  }
  if (total === 0) {
    warn("activity", "the core has emitted ZERO events in the last 50k blocks");
    console.log(`    ${c("→ either nobody has swapped through the v4 hook for that pool yet,", "gray")}`);
    console.log(`    ${c("→ or the buy you did didn't actually route through this hook.", "gray")}`);
    console.log(`    ${c("→ confirm in a block explorer that your tx hash logs an event from", "gray")}`);
    console.log(`    ${c(`      ${ADDR.CORE}`, "gray")}`);
  } else {
    ok("activity", `${total} events on the core in window`);
  }
}

/* ============================================================ *
 *  4b.  PER-POOL ACTIVITY — which pool actually saw the swap?
 * ============================================================ */
async function checkPools(client: PublicClient) {
  divider("PER-POOL ACTIVITY (last 50k blocks)");
  const latest = await client.getBlockNumber();
  const lookback = 50_000n;
  const from = latest > lookback ? latest - lookback : 0n;
  const CHUNK = 5_000n;

  const envPoolId = (process.env.POOL_ID ?? "").toLowerCase();

  for (const pool of KNOWN_POOLS) {
    const isEnv = pool.poolId.toLowerCase() === envPoolId;
    const tag = isEnv ? c(" ← .env POOL_ID", "cyan") : "";
    console.log(`\n  ${c(pool.name, "bold")}  ${pool.poolId}${tag}`);

    /* on-core config for this pool */
    try {
      const config = (await client.readContract({
        address: ADDR.CORE,
        abi: [{
          type: "function", name: "poolConfigs", stateMutability: "view",
          inputs: [{ name: "p", type: "bytes32" }],
          outputs: [
            { name: "bountyToken", type: "address" },
            { name: "quoteToken",  type: "address" },
            { name: "enabled",     type: "bool" }
          ]
        }] as const,
        functionName: "poolConfigs",
        args: [pool.poolId]
      })) as readonly [Address, Address, boolean];
      const [bountyToken, quoteToken, enabled] = config;
      if (enabled) ok("    core.poolConfig", `enabled, bounty=${bountyToken === ADDR.TOKEN ? "UP" : bountyToken}, quote=${quoteToken === ADDR.NATIVE_ETH ? "ETH" : quoteToken}`);
      else         warn("    core.poolConfig", `disabled or unconfigured (bounty=${bountyToken}, enabled=${enabled})`);
    } catch (err) {
      warn("    core.poolConfig", err instanceof Error ? err.message.split("\n")[0] : String(err));
    }

    /* events filtered by indexed poolId topic */
    const counts: Record<string, number> = {};
    let total = 0;
    for (let cursor = from; cursor <= latest; cursor += CHUNK + 1n) {
      const to = (cursor + CHUNK) > latest ? latest : (cursor + CHUNK);
      try {
        // BountyOpened: poolId is topic[2]; BountyPressureUpdated: poolId is topic[1]
        const opened = await client.getContractEvents({
          address: ADDR.CORE, abi: coreAbi, eventName: "BountyOpened",
          args: { poolId: pool.poolId }, fromBlock: cursor, toBlock: to
        });
        const pressure = await client.getContractEvents({
          address: ADDR.CORE, abi: coreAbi, eventName: "BountyPressureUpdated",
          args: { poolId: pool.poolId }, fromBlock: cursor, toBlock: to
        });
        counts.BountyOpened = (counts.BountyOpened ?? 0) + opened.length;
        counts.BountyPressureUpdated = (counts.BountyPressureUpdated ?? 0) + pressure.length;
        total += opened.length + pressure.length;
      } catch { /* ignore single chunk failure */ }
    }
    const opened = counts.BountyOpened ?? 0;
    const pressure = counts.BountyPressureUpdated ?? 0;
    if (total === 0) {
      console.log(`    ${c("·", "gray")} no swaps observed for this pool`);
    } else {
      ok("    swaps observed", `BountyOpened=${opened}, BountyPressureUpdated=${pressure}`);
    }
  }

  /* hint if env points at a quiet pool while another saw activity */
  if (KNOWN_POOLS.length > 1) {
    console.log("");
    console.log(c("    → if the pool you swapped on doesn't match POOL_ID in .env,", "gray"));
    console.log(c("      update POOL_ID and restart the worker + web.", "gray"));
  }
}

/* ============================================================ *
 *  5.  API
 * ============================================================ */
async function checkApi(apiUrl: string) {
  divider("API");
  try {
    const r = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const data = (await r.json()) as { service?: string };
      ok("/health", `200 ${data.service ?? ""}`);
    } else {
      fail("/health", `${r.status} ${r.statusText}`);
    }
  } catch (err) {
    fail("/health", `${err instanceof Error ? err.message : err}  ← API not running. start with:  npm run dev:api`);
    return;
  }

  try {
    const stats = (await (await fetch(`${apiUrl}/stats`)).json()) as {
      totalBountyFunded: string;
      totalRewardsClaimed: string;
      totalHunters: number;
      activeWindows: number;
    };
    ok("/stats", `funded=${stats.totalBountyFunded} claimed=${stats.totalRewardsClaimed} hunters=${stats.totalHunters} active=${stats.activeWindows}`);
  } catch (err) {
    warn("/stats", err instanceof Error ? err.message : String(err));
  }

  try {
    const events = (await (await fetch(`${apiUrl}/events?limit=5`)).json()) as Array<{ id: string; type: string }>;
    if (events.length === 0) warn("/events", "store is empty (no events ingested yet)");
    else ok("/events", `${events.length} recent events: ${events.map((e) => e.type).join(", ")}`);
  } catch (err) {
    warn("/events", err instanceof Error ? err.message : String(err));
  }
}

/* ============================================================ *
 *  6.  WORKER CHECKPOINT
 * ============================================================ */
function checkWorker() {
  divider("WORKER");
  const cpFile = process.env.WORKER_CHECKPOINT_FILE ?? "apps/worker/.checkpoint";
  const path = resolve(process.cwd(), cpFile);
  if (!existsSync(path)) {
    warn("checkpoint file", `${path}  ← worker has never run (or was reset)`);
    console.log(`    ${c("→ start the worker:  npm run dev:worker", "gray")}`);
    return;
  }
  const value = readFileSync(path, "utf8").trim();
  ok("checkpoint", `${path}  block=${value}`);
}

/* ============================================================ *
 *  7.  SUMMARY
 * ============================================================ */
function summary() {
  divider("SUMMARY");
  if (issues.length === 0 && warnings.length === 0) {
    console.log(c("  ✓ all wired up. if something still doesn't show, hard-refresh the website (5s revalidate cache) or restart the worker.", "green"));
    console.log();
    return;
  }
  if (issues.length > 0) {
    console.log(c(`  ${issues.length} issue(s):`, "red"));
    for (const i of issues) console.log(`    ${c("✗", "red")} ${i}`);
  }
  if (warnings.length > 0) {
    console.log(c(`  ${warnings.length} warning(s):`, "yellow"));
    for (const w of warnings) console.log(`    ${c("⚠", "yellow")} ${w}`);
  }

  /* tailored fix-it block */
  divider("WHAT TO DO");
  console.log(`  Edit ${c(".env", "cyan")} to contain:\n`);
  console.log(c("    RPC_HTTP_URL=https://ethereum-sepolia-rpc.publicnode.com", "gray"));
  console.log(c("    RPC_WS_URL=wss://ethereum-sepolia-rpc.publicnode.com", "gray"));
  console.log(c(`    BOUNTY_HOOK_ADDRESS=<BountyHookCore — must match worker ingest>`, "gray"));
  console.log(c(`    REAL_V4_HOOK_ADDRESS=<BountyV4Hook deployed with your pool>`, "gray"));
  console.log(c(`    BOUNTY_TOKEN_ADDRESS=<ERC-20 CA>`, "gray"));
  console.log(c(`    POOL_ID=<bytes32 PoolId for native ETH pool>`, "gray"));
  console.log(c("    V4_FEE=10000", "gray"));
  console.log(c("    V4_TICK_SPACING=200", "gray"));
  console.log(c("    NEXT_PUBLIC_V4_POOL_FEE=10000", "gray"));
  console.log(c("    NEXT_PUBLIC_V4_TICK_SPACING=200", "gray"));
  console.log(c("    NEXT_PUBLIC_BOUNTY_TOKEN_ADDRESS=<same as BOUNTY_TOKEN_ADDRESS>", "gray"));
  console.log(c("    NEXT_PUBLIC_REAL_V4_HOOK_ADDRESS=<same as REAL_V4_HOOK_ADDRESS>", "gray"));
  console.log(c("    WORKER_START_BLOCK=10780000", "gray"));
  console.log(c("    NEXT_PUBLIC_API_URL=http://localhost:4311", "gray"));
  console.log();
  console.log(`  Then in ${c("three terminals", "cyan")}:\n`);
  console.log(c("    npm run dev:api      # http://localhost:4311", "gray"));
  console.log(c("    npm run dev:worker   # poller, ingests events into the API", "gray"));
  console.log(c("    npm run dev:web      # http://localhost:3000", "gray"));
  console.log();
  console.log(`  Re-run ${c("npm run doctor", "cyan")} after each fix to confirm.\n`);
}

/* ============================================================ *
 *  main
 * ============================================================ */
async function main() {
  console.log(c(`\n  ▲▲▲ Only Up — wire doctor ▲▲▲\n`, "green"));
  const { rpcHttp, apiUrl } = checkEnv();
  const client = await checkChain(rpcHttp);
  if (client) {
    await checkContracts(client);
    await checkEvents(client);
    console.log("");
    console.log(
      c(
        "  ℹ Feed + leaderboard count hook events from BountyHookCore — not your ERC20 Transfer log.",
        "gray"
      )
    );
    console.log(
      c(
        '    `BountyBuyRecorded` only fires for qualifying buys during an armed window; balance buys may not appear.',
        "gray"
      )
    );
    await checkPools(client);
  }
  await checkApi(apiUrl);
  checkWorker();
  summary();

  /* exit non-zero only on hard failures so this is CI-friendly */
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c(`\n✗ doctor crashed: ${err instanceof Error ? err.stack : err}\n`, "red"));
  process.exit(2);
});
