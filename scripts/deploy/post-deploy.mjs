/**
 * One-shot post-launch wiring after you've created a Uniswap v4 pool +
 * added liquidity manually.
 *
 * Usage:
 *   node scripts/deploy/post-deploy.mjs <POOL_ID> [--fee 3000] [--tick 60]
 *   # OR via npm:
 *   npm run post-deploy -- 0xd4a010c0…  --fee 3000 --tick 60
 *
 * What it does, in order:
 *   1. Validates POOL_ID is a 32-byte hex.
 *   2. Writes POOL_ID, V4_FEE, V4_TICK_SPACING, and the matching NEXT_PUBLIC_*
 *      mirrors into repo-root .env (preserving every other line).
 *   3. Runs ConfigureNativeEthV4Route on chain — flips the bounty mechanism
 *      ON for the new pool. Until this runs, the v4 hook just emits
 *      `V4HookSkipped(SKIP_ROUTE_DISABLED)` for every swap; swaps still work
 *      but no BountyOpened/Funded/BuyRecorded events fire and the dashboard
 *      stays empty.
 *   4. Resets the worker checkpoint so the indexer re-scans from the deploy
 *      block + sees the new ConfigureNativeEthV4Route txs.
 *   5. Runs `npm run doctor` so you get a green-light read of the whole
 *      pipeline before you go live.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncVercelEnv } from "./sync-vercel-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(repoRoot, ".env");
const checkpointPath = path.join(repoRoot, "apps", "worker", ".checkpoint");

function loadDotenv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") {
      process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}
loadDotenv(envPath);

// ---- parse args ----
const argv = process.argv.slice(2);
let poolId = "";
let feeArg;
let tickArg;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--fee" && argv[i + 1]) { feeArg = argv[++i]; continue; }
  if (a === "--tick" && argv[i + 1]) { tickArg = argv[++i]; continue; }
  if (a.startsWith("0x")) { poolId = a; continue; }
}

if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
  console.error("✗ first arg must be a 32-byte PoolId (0x… 64 hex chars)");
  console.error("  Usage: npm run post-deploy -- 0xPOOL_ID [--fee 3000] [--tick 60]");
  process.exit(1);
}

const fee = String(feeArg ?? process.env.V4_FEE ?? "10000");
const tick = String(tickArg ?? process.env.V4_TICK_SPACING ?? "200");

if (!/^\d+$/.test(fee) || !/^\d+$/.test(tick)) {
  console.error(`✗ invalid fee/tick: fee=${fee} tick=${tick}`);
  process.exit(1);
}

if (!process.env.RPC_HTTP_URL) { console.error("✗ RPC_HTTP_URL missing in .env"); process.exit(1); }
if (!process.env.PRIVATE_KEY)  { console.error("✗ PRIVATE_KEY missing in .env");  process.exit(1); }
if (!process.env.BOUNTY_TOKEN_ADDRESS) { console.error("✗ BOUNTY_TOKEN_ADDRESS missing — run npm run deploy first"); process.exit(1); }
if (!process.env.BOUNTY_HOOK_ADDRESS)  { console.error("✗ BOUNTY_HOOK_ADDRESS missing  — run npm run deploy first"); process.exit(1); }
if (!process.env.REAL_V4_HOOK_ADDRESS) { console.error("✗ REAL_V4_HOOK_ADDRESS missing — run npm run deploy first"); process.exit(1); }

// forge cheatcode envUint requires 0x-prefixed hex private keys.
{
  const k = process.env.PRIVATE_KEY.trim();
  if (/^[0-9a-fA-F]{64}$/.test(k)) process.env.PRIVATE_KEY = `0x${k}`;
}

// ---- 1. patch .env ----
console.log(`\n▲ writing .env`);
const updates = {
  POOL_ID: poolId,
  V4_FEE: fee,
  V4_TICK_SPACING: tick,
  NEXT_PUBLIC_V4_POOL_FEE: fee,
  NEXT_PUBLIC_V4_TICK_SPACING: tick,
};
let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/) : [];
const written = new Set();
const out = [];
for (const line of lines) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
    out.push(`${m[1]}=${updates[m[1]]}`);
    written.add(m[1]);
  } else {
    out.push(line);
  }
}
for (const [k, v] of Object.entries(updates)) {
  if (!written.has(k)) out.push(`${k}=${v}`);
}
fs.writeFileSync(envPath, out.join("\n"));
for (const [k, v] of Object.entries(updates)) console.log(`  ${k}=${v}`);

// Reload so child processes inherit the new values.
for (const [k, v] of Object.entries(updates)) process.env[k] = v;

// ---- 2. run ConfigureNativeEthV4Route ----
function resolveForge() {
  const home = os.homedir();
  const candidates = process.platform === "win32"
    ? [path.join(home, ".foundry", "bin", "forge.exe"), "forge.exe", "forge"]
    : [path.join(home, ".foundry", "bin", "forge"), "forge"];
  for (const c of candidates) {
    const probe = spawnSync(c, ["--version"], { stdio: "ignore", shell: false });
    if (probe.status === 0) return c;
  }
  console.error("✗ forge not found. Install Foundry: https://book.getfoundry.sh/getting-started/installation");
  process.exit(127);
}
const forge = resolveForge();

console.log(`\n▲ ConfigureNativeEthV4Route → flips bounty ON for pool`);
const cfg = spawnSync(
  forge,
  [
    "script",
    "script/ConfigureNativeEthV4Route.s.sol:ConfigureNativeEthV4Route",
    "--rpc-url", process.env.RPC_HTTP_URL,
    "--broadcast",
    "--slow",       // public RPCs throttle back-to-back broadcasts; --slow waits between txs
    "-vv"
  ],
  { cwd: path.join(repoRoot, "contracts"), stdio: "inherit", shell: false, env: process.env }
);
if (cfg.status !== 0) {
  console.error(`\n✗ ConfigureNativeEthV4Route failed (exit ${cfg.status}).`);
  console.error("  Common causes: pool doesn't exist yet, fee/tick mismatch, RPC throttle.");
  process.exit(cfg.status ?? 1);
}

// ---- 3. reset worker checkpoint so it re-ingests from deploy block ----
if (fs.existsSync(checkpointPath)) {
  fs.unlinkSync(checkpointPath);
  console.log(`\n▲ worker checkpoint cleared`);
}

// ---- 4. doctor ----
console.log(`\n▲ npm run doctor`);
const isWin = process.platform === "win32";
const npmBin = isWin ? "npm.cmd" : "npm";
spawnSync(npmBin, ["run", "doctor"], { cwd: repoRoot, stdio: "inherit", shell: isWin });

// ---- 5. Auto-sync apps/web/.env.production + push so Vercel redeploys ----
const noPush = process.argv.includes("--no-push");
console.log(`\n▲ syncing apps/web/.env.production for Vercel`);
const sync = syncVercelEnv({
  push: !noPush,
  commitMessage: `chore(web): wire pool ${poolId.slice(0, 10)}… into NEXT_PUBLIC_*`
});
if (!sync.changed) {
  console.log("  · already up to date");
} else {
  console.log(`  ✓ wrote ${path.relative(repoRoot, sync.file)}`);
  if (noPush) {
    console.log("  · git push skipped (--no-push)");
  } else if (sync.pushed) {
    console.log(`  ✓ pushed ${sync.sha} → Vercel will auto-redeploy`);
  } else {
    console.log(`  ⚠ git push skipped: ${sync.reason}`);
    console.log("    Run manually:  git add apps/web/.env.production && git commit -m \"sync\" && git push");
  }
}

console.log(`
══════════════════════════════════════════════════════════════
  IF YOUR WORKER IS RUNNING — restart it so it picks up the
  cleared checkpoint and re-scans from WORKER_START_BLOCK:

    Ctrl+C the dev:worker terminal, then:
      npm run dev:worker

══════════════════════════════════════════════════════════════

✓ Post-deploy complete.

  Make a sell of ≥ 10 UP on the pool. Within ~12s you should see
  BountyOpened + BountyFunded in /events and the dashboard.
  Buys made during the next 50 blocks split that bounty.
`);
