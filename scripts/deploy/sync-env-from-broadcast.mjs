/**
 * Reads the latest Foundry broadcast JSON and rewrites repo-root .env with
 * the freshly-deployed contract addresses. Also clears the worker checkpoint
 * so the indexer re-scans from the new WORKER_START_BLOCK.
 *
 * Usage:
 *   CHAIN_ID=11155111 node scripts/deploy/sync-env-from-broadcast.mjs [ScriptName.s.sol]
 *
 * Default script: DeployFreshNativeEthLaunch.s.sol.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const chainId = process.env.CHAIN_ID ?? "11155111";
const scriptFile = process.argv[2] ?? "DeployFreshNativeEthLaunch.s.sol";

const broadcastPath = path.join(
  repoRoot,
  "contracts",
  "broadcast",
  scriptFile,
  chainId,
  "run-latest.json"
);

if (!fs.existsSync(broadcastPath)) {
  console.error(`✗ no broadcast file at:\n  ${broadcastPath}\n  Deploy first, then re-run.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(broadcastPath, "utf8"));

/** Map contractName → first deployed address in this broadcast. */
const deployed = {};
for (const tx of data.transactions ?? []) {
  if (!tx.contractAddress) continue;
  const isCreate = tx.transactionType === "CREATE" || tx.transactionType === "CREATE2";
  if (!isCreate) continue;
  const name = tx.contractName ?? "";
  if (!name) continue;
  if (!deployed[name]) deployed[name] = tx.contractAddress;
}

const required = ["BountyLaunchToken", "BountyHookCore", "BountyV4Hook", "NetSellPressureBountyPolicy"];
const missing = required.filter((k) => !deployed[k]);
if (missing.length > 0) {
  console.error(`✗ contract(s) not found in broadcast: ${missing.join(", ")}`);
  console.error("  detected:", deployed);
  process.exit(1);
}

/** Earliest block in this broadcast — what worker should resume from (minus a small buffer). */
let firstBlock = 0;
if (Array.isArray(data.receipts)) {
  for (const r of data.receipts) {
    if (!r.blockNumber) continue;
    const b = parseInt(String(r.blockNumber), 16);
    if (Number.isFinite(b) && b > 0 && (firstBlock === 0 || b < firstBlock)) firstBlock = b;
  }
}

const updates = {
  BOUNTY_TOKEN_ADDRESS: deployed.BountyLaunchToken,
  BOUNTY_HOOK_ADDRESS: deployed.BountyHookCore,
  REAL_V4_HOOK_ADDRESS: deployed.BountyV4Hook,
  POLICY_ADDRESS: deployed.NetSellPressureBountyPolicy,
  NEXT_PUBLIC_BOUNTY_TOKEN_ADDRESS: deployed.BountyLaunchToken,
  NEXT_PUBLIC_REAL_V4_HOOK_ADDRESS: deployed.BountyV4Hook,
  NEXT_PUBLIC_BOUNTY_HOOK_ADDRESS: deployed.BountyHookCore,
  POOL_ID: "",
  LEGACY_POOL_ID: ""
};

if (firstBlock > 0) {
  updates.WORKER_START_BLOCK = String(Math.max(0, firstBlock - 5));
}

const envPath = path.join(repoRoot, ".env");
let lines = [];
if (fs.existsSync(envPath)) {
  lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
}

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

console.log("✓ updated .env:");
for (const [k, v] of Object.entries(updates)) {
  console.log(`  ${k}=${v}`);
}

const checkpoint = path.join(repoRoot, "apps", "worker", ".checkpoint");
if (fs.existsSync(checkpoint)) {
  fs.unlinkSync(checkpoint);
  console.log("✓ removed worker checkpoint (apps/worker/.checkpoint)");
}

console.log(`
Next:
  1. (optional) Add liquidity to a Uniswap v4 pool with currency0=ETH (0x0), currency1=${deployed.BountyLaunchToken}.
     - With our hook:    fee=10000, tickSpacing=200, hooks=${deployed.BountyV4Hook}
     - Without our hook: fee=any,   tickSpacing=any,  hooks=0x0  (works in stock Uniswap UI)
  2. Once the pool exists and you know its PoolId, set POOL_ID in .env, then:
       npm run dev:api
       npm run dev:worker
       npm run dev:web
       npm run doctor
`);
