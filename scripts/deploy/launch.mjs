/**
 * One-command launch (pre-liquidity).
 *
 * Wraps run-deploy.mjs --verify with:
 *   - .env validation (chain-aware: rejects Sepolia values on mainnet config etc.)
 *   - Strips stale V4_POOL_MANAGER overrides so the deploy script falls through
 *     to its hard-coded chain-aware default. (This is the bug that bricked the
 *     last hook — V4_POOL_MANAGER held a Sepolia address on a mainnet deploy.)
 *   - Prints the exact PoolKey to use on Uniswap, copy-paste ready.
 *
 * Usage:
 *   npm run launch
 *
 * After it succeeds, create the Uniswap pool + add liquidity manually, then:
 *   npm run launch:wire-pool -- 0x<POOL_ID>
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncVercelEnv } from "./sync-vercel-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const envPath = path.join(repoRoot, ".env");

const COLOR = process.stdout.isTTY ? {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m"
} : Object.fromEntries(["reset", "bold", "cyan", "yellow", "green", "red", "dim"].map((k) => [k, ""]));

const c = (s, code) => `${COLOR[code]}${s}${COLOR.reset}`;

// Mainnet v4 deployment (Uniswap docs).
const MAINNET = {
  poolManager:      "0x000000000004444c5dc75cB358380D2e3dE08A90",
  positionManager:  "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e",
  permit2:          "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  universalRouter:  "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af"
};

// Sepolia v4 deployment.
const SEPOLIA = {
  poolManager:      "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  positionManager:  "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
  permit2:          "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  universalRouter:  "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b"
};

function readEnvFile() {
  const map = {};
  if (!fs.existsSync(envPath)) return map;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) map[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return map;
}

/** Rewrite .env, removing any keys in `removeKeys` and overwriting `updates`. */
function patchEnv({ removeKeys = new Set(), updates = {} }) {
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const written = new Set();
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && removeKeys.has(m[1])) continue;
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
}

function preflight() {
  const env = readEnvFile();

  const required = ["CHAIN_ID", "RPC_HTTP_URL", "PRIVATE_KEY", "ETHERSCAN_API_KEY"];
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(c(`✗ .env missing required keys: ${missing.join(", ")}`, "red"));
    process.exit(1);
  }

  const chainId = env.CHAIN_ID;
  if (chainId !== "1" && chainId !== "11155111") {
    console.error(c(`✗ unsupported CHAIN_ID=${chainId} (expected 1 or 11155111)`, "red"));
    process.exit(1);
  }

  const rpc = env.RPC_HTTP_URL;
  const isMainnet = chainId === "1";
  const rpcLooksMainnet = /mainnet|eth-rpc|ethereum-rpc/i.test(rpc) && !/sepolia|goerli|holesky/i.test(rpc);
  const rpcLooksSepolia = /sepolia/i.test(rpc);
  if (isMainnet && rpcLooksSepolia) {
    console.error(c(`✗ CHAIN_ID=1 but RPC_HTTP_URL looks like Sepolia: ${rpc}`, "red"));
    process.exit(1);
  }
  if (!isMainnet && rpcLooksMainnet) {
    console.error(c(`⚠ CHAIN_ID=${chainId} but RPC_HTTP_URL looks like mainnet: ${rpc}`, "yellow"));
  }
  if (/127\.0\.0\.1|localhost/i.test(rpc)) {
    console.error(c(`✗ RPC_HTTP_URL points at localhost — set a real ${isMainnet ? "mainnet" : "sepolia"} RPC.`, "red"));
    process.exit(1);
  }

  // Strip overrides that would shadow the chain-aware defaults inside the deploy
  // script. The .sol now reverts on mismatch, but we'd rather not even let it get
  // that far if a stale override is sitting there.
  const expected = isMainnet ? MAINNET : SEPOLIA;
  const overrideKeys = ["V4_POOL_MANAGER", "V4_POSITION_MANAGER", "PERMIT2_ADDRESS", "UNIVERSAL_ROUTER"];
  const wrong = overrideKeys.filter((k) => env[k] && env[k].toLowerCase() !== expected[overrideKey(k)].toLowerCase());
  if (wrong.length > 0) {
    console.log(c(`▲ removing stale V4 overrides from .env (will use chain-${chainId} defaults):`, "yellow"));
    for (const k of wrong) console.log(`    ${k}  was=${env[k]}  expected=${expected[overrideKey(k)]}`);
    patchEnv({ removeKeys: new Set(wrong) });
  }

  return { env: readEnvFile(), chainId, isMainnet };
}

function overrideKey(envKey) {
  return ({
    V4_POOL_MANAGER: "poolManager",
    V4_POSITION_MANAGER: "positionManager",
    PERMIT2_ADDRESS: "permit2",
    UNIVERSAL_ROUTER: "universalRouter"
  })[envKey];
}

function runStep(label, cmd, args) {
  console.log(c(`\n▲ ${label}`, "cyan"));
  console.log(c(`  $ ${cmd} ${args.join(" ")}`, "dim"));
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, cwd: repoRoot, env: process.env });
  if (r.status !== 0) {
    console.error(c(`✗ step failed: ${label} (exit ${r.status})`, "red"));
    process.exit(r.status ?? 1);
  }
}

function main() {
  console.log(c("\n╔══════════════════════════════════════════════════════╗", "cyan"));
  console.log(c("║          BOUNTY HOOK — ONE-SHOT LAUNCH               ║", "cyan"));
  console.log(c("╚══════════════════════════════════════════════════════╝", "cyan"));

  const { env, chainId, isMainnet } = preflight();
  console.log(c(`\n▲ pre-flight ok`, "green"));
  console.log(`    chain        ${chainId} (${isMainnet ? "mainnet" : "sepolia"})`);
  console.log(`    rpc          ${env.RPC_HTTP_URL}`);
  console.log(`    deployer     forge will derive from PRIVATE_KEY`);
  console.log(`    verify       yes (Etherscan)`);

  // forge build + test + broadcast + sync-env + verify in one shot
  runStep(
    "deploy + verify",
    process.execPath,
    [path.join("scripts", "deploy", "run-deploy.mjs"), "--verify"]
  );

  const post = readEnvFile();
  const fee = post.V4_FEE || "3000";
  const tick = post.V4_TICK_SPACING || "60";

  // Mirror NEXT_PUBLIC_* into apps/web/.env.production and push so Vercel rebuilds.
  const noPush = process.argv.includes("--no-push");
  console.log(c("\n▲ syncing apps/web/.env.production for Vercel", "cyan"));
  const sync = syncVercelEnv({
    push: !noPush,
    commitMessage: `chore(web): sync mainnet addresses post-launch (token=${(post.BOUNTY_TOKEN_ADDRESS || "").slice(0, 10)}…)`
  });
  if (!sync.changed) {
    console.log(c("  · already up to date", "dim"));
  } else {
    console.log(c(`  ✓ wrote ${path.relative(repoRoot, sync.file)}`, "green"));
    if (noPush) {
      console.log(c("  · git push skipped (--no-push)", "dim"));
    } else if (sync.pushed) {
      console.log(c(`  ✓ pushed ${sync.sha} → Vercel auto-redeploy triggered`, "green"));
    } else {
      console.log(c(`  ⚠ git push skipped: ${sync.reason}`, "yellow"));
    }
  }

  console.log(c("\n╔══════════════════════════════════════════════════════╗", "green"));
  console.log(c("║            DEPLOY OK — NEXT: CREATE POOL             ║", "green"));
  console.log(c("╚══════════════════════════════════════════════════════╝", "green"));

  console.log(`\n${c("Open Uniswap → Create v4 pool with this exact PoolKey:", "bold")}\n`);
  console.log(`    currency0     ETH (${c("0x0000000000000000000000000000000000000000", "dim")})`);
  console.log(`    currency1     ${c(post.BOUNTY_TOKEN_ADDRESS, "yellow")}   (UP)`);
  console.log(`    fee           ${c(fee, "yellow")}`);
  console.log(`    tickSpacing   ${c(tick, "yellow")}`);
  console.log(`    hooks         ${c(post.REAL_V4_HOOK_ADDRESS, "yellow")}`);
  console.log("\n  → Initialize price, add ETH + UP liquidity, copy the resulting PoolId.\n");
  console.log(`${c("Then run:", "bold")}\n`);
  console.log(`    ${c("npm run launch:wire-pool -- 0x<POOL_ID>", "cyan")}\n`);
  console.log(c("Etherscan links:", "dim"));
  console.log(`    Token   https://etherscan.io/address/${post.BOUNTY_TOKEN_ADDRESS}`);
  console.log(`    Core    https://etherscan.io/address/${post.BOUNTY_HOOK_ADDRESS}`);
  console.log(`    Hook    https://etherscan.io/address/${post.REAL_V4_HOOK_ADDRESS}`);
  console.log(`    Policy  https://etherscan.io/address/${post.POLICY_ADDRESS}\n`);
}

main();
