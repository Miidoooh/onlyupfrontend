/**
 * Wrapper for the RemoveLiquidityFast forge script.
 *
 *   npm run remove                       # auto-detects token id + 5x gas
 *   npm run remove -- 12345              # positional tokenId override
 *   npm run remove -- --tokenId 12345 \
 *                     --multiplier 5 \   # liquidity scaling (RemoveLiquidityFast)
 *                     --gasMultiplier 8  # gas-fee multiplier (this wrapper)
 *
 * Two distinct multipliers, don't confuse them:
 *   --multiplier      / REMOVE_MULTIPLIER       liquidity scaling inside the
 *                                               .sol script (how aggressively
 *                                               to drain the position).
 *   --gasMultiplier   / REMOVE_GAS_MULTIPLIER   priority-fee multiplier this
 *                                               wrapper applies so the tx
 *                                               actually ships fast. Default 5.
 *                                               Range 1..50. Clamped.
 *
 * Auto-detect: if REMOVE_TOKEN_ID isn't set anywhere, scans V4 PositionManager
 * for ERC-721 Transfer events `from=0x0 to=<deployer>` since the launch block
 * and uses the most recent tokenId.
 *
 * Resolves the `forge` binary even when it's not on PATH and never lets an
 * empty .env value clobber a real shell value.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const contractsDir = path.join(repoRoot, "contracts");
const envFile = path.join(repoRoot, ".env");

const COLOR = process.stdout.isTTY ? {
  reset: "\x1b[0m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m"
} : { reset: "", red: "", yellow: "", cyan: "", dim: "" };
const c = (s, k) => `${COLOR[k]}${s}${COLOR.reset}`;

function resolveForge() {
  const candidates = [];
  const home = os.homedir();
  if (process.platform === "win32") {
    candidates.push(path.join(home, ".foundry", "bin", "forge.exe"));
    candidates.push("forge.exe");
  } else {
    candidates.push(path.join(home, ".foundry", "bin", "forge"));
  }
  candidates.push("forge");
  for (const cand of candidates) {
    const probe = spawnSync(cand, ["--version"], { stdio: "ignore", shell: false });
    if (probe.status === 0) return cand;
  }
  console.error(c("✗ forge not found. Install Foundry: https://book.getfoundry.sh/getting-started/installation", "red"));
  process.exit(127);
}

function loadDotenv() {
  if (!fs.existsSync(envFile)) return {};
  const map = {};
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) map[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return map;
}

function parseArgs(argv) {
  const out = {};
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--tokenId" || a === "--token-id") out.tokenId = rest[++i];
    else if (a === "--multiplier") out.multiplier = rest[++i];
    else if (a === "--gasMultiplier" || a === "--gas-multiplier") out.gasMultiplier = rest[++i];
    else if (a === "--amount0Min") out.amount0Min = rest[++i];
    else if (a === "--amount1Min") out.amount1Min = rest[++i];
    else if (a === "--baseLiquidity") out.baseLiquidity = rest[++i];
    else if (!a.startsWith("--") && !out.tokenId) out.tokenId = a;
  }
  return out;
}

function isValidUint(s) {
  if (s == null) return false;
  const v = String(s).trim();
  if (v === "") return false;
  if (/^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v) >= 0n;
  if (/^\d+$/.test(v)) return true;
  return false;
}

const ERC721_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function padTopic(addr) {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function viemClient(rpcUrl) {
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ transport: http(rpcUrl) });
}

async function deployerAddress(privateKey) {
  const { privateKeyToAccount } = await import("viem/accounts");
  const pk = privateKey.startsWith("0x") ? privateKey : "0x" + privateKey;
  return privateKeyToAccount(pk).address;
}

/**
 * Compute aggressive EIP-1559 gas params so the tx confirms quickly.
 * Returns wei values as bigint, plus the multiplier actually used.
 *
 * Strategy:
 *   1. Read pending block.baseFeePerGas (or fall back to gasPrice).
 *   2. Read suggested priority fee (eth_maxPriorityFeePerGas if available,
 *      else default to 1.5 gwei).
 *   3. priorityFee = suggested * gasMultiplier
 *   4. maxFee = baseFee * 2 + priorityFee  (covers a basefee doubling next block)
 */
async function computeFastGas(rpcUrl, gasMultiplier) {
  const client = await viemClient(rpcUrl);

  let baseFee;
  try {
    const block = await client.getBlock({ blockTag: "pending" });
    baseFee = block.baseFeePerGas ?? null;
  } catch { baseFee = null; }
  if (baseFee == null) {
    // Pre-1559 chains or RPCs that don't return baseFeePerGas — fall back.
    baseFee = await client.getGasPrice();
  }

  let suggestedTip = 1_500_000_000n; // 1.5 gwei default if RPC doesn't expose it
  try {
    const tip = await client.estimateMaxPriorityFeePerGas();
    if (tip > 0n) suggestedTip = tip;
  } catch {}

  const m = BigInt(Math.max(1, Math.min(50, Math.round(Number(gasMultiplier)))));
  const priorityFee = suggestedTip * m;
  // 2x baseFee headroom + boosted tip → tx still lands if basefee jumps next block.
  const maxFee = (baseFee * 2n) + priorityFee;

  return { baseFee, suggestedTip, priorityFee, maxFee, multiplier: Number(m) };
}

function fmtGwei(wei) {
  // Crude but readable: round to 3 decimals.
  const n = Number(wei) / 1e9;
  return `${n.toFixed(3)} gwei`;
}

async function autoDiscoverTokenId({ rpcUrl, positionManager, privateKey, fromBlock }) {
  const deployer = await deployerAddress(privateKey);
  const client = await viemClient(rpcUrl);
  const latest = await client.getBlockNumber();
  const start = fromBlock && /^\d+$/.test(fromBlock)
    ? BigInt(fromBlock)
    : (latest > 50_000n ? latest - 50_000n : 0n);

  // Many public RPCs cap getLogs ranges. Walk in chunks.
  const MAX_RANGE = 4_500n;
  let bestBlock = -1n;
  let bestLogIndex = -1;
  let bestTokenId = "";

  for (let from = start; from <= latest; from += MAX_RANGE + 1n) {
    const to = from + MAX_RANGE > latest ? latest : from + MAX_RANGE;
    const logs = await client.getLogs({
      address: positionManager,
      fromBlock: from,
      toBlock: to,
      topics: [
        ERC721_TRANSFER_TOPIC,
        padTopic("0x0000000000000000000000000000000000000000"),
        padTopic(deployer)
      ]
    });
    for (const log of logs) {
      const blk = log.blockNumber;
      const idx = log.logIndex;
      if (blk > bestBlock || (blk === bestBlock && idx > bestLogIndex)) {
        bestBlock = blk;
        bestLogIndex = idx;
        // Transfer's tokenId is the 3rd indexed topic.
        bestTokenId = BigInt(log.topics[3]).toString(10);
      }
    }
  }
  return bestTokenId || undefined;
}

const cli = parseArgs(process.argv);
const fileEnv = loadDotenv();

// Resolve final value: CLI > shell > .env (and treat empty as unset everywhere).
function pick(key, cliVal) {
  const candidates = [cliVal, process.env[key], fileEnv[key]];
  for (const v of candidates) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

const resolved = {
  PRIVATE_KEY:           pick("PRIVATE_KEY"),
  RPC_HTTP_URL:          pick("RPC_HTTP_URL"),
  V4_POSITION_MANAGER:   pick("V4_POSITION_MANAGER"),
  REMOVE_TOKEN_ID:       pick("REMOVE_TOKEN_ID", cli.tokenId),
  REMOVE_MULTIPLIER:     pick("REMOVE_MULTIPLIER", cli.multiplier),
  REMOVE_GAS_MULTIPLIER: pick("REMOVE_GAS_MULTIPLIER", cli.gasMultiplier),
  REMOVE_BASE_LIQUIDITY: pick("REMOVE_BASE_LIQUIDITY", cli.baseLiquidity),
  REMOVE_AMOUNT0_MIN:    pick("REMOVE_AMOUNT0_MIN", cli.amount0Min),
  REMOVE_AMOUNT1_MIN:    pick("REMOVE_AMOUNT1_MIN", cli.amount1Min),
  WORKER_START_BLOCK:    pick("WORKER_START_BLOCK")
};

const requiredBase = ["PRIVATE_KEY", "RPC_HTTP_URL", "V4_POSITION_MANAGER"];
const missingBase = requiredBase.filter((k) => !resolved[k]);
if (missingBase.length > 0) {
  console.error(c(`✗ missing required values: ${missingBase.join(", ")}`, "red"));
  console.error(c("  set them in .env or your shell. PositionManager comes from the launch.", "dim"));
  process.exit(1);
}

// If no token id was supplied anywhere, autodiscover by scanning Transfer
// events from PositionManager filtered to our deployer. The most recent one
// is our position (LP NFT mints are always from=0x0).
if (!resolved.REMOVE_TOKEN_ID) {
  console.log(c("▲ REMOVE_TOKEN_ID not set — auto-detecting from on-chain…", "yellow"));
  try {
    const tokenId = await autoDiscoverTokenId({
      rpcUrl: resolved.RPC_HTTP_URL,
      positionManager: resolved.V4_POSITION_MANAGER,
      privateKey: resolved.PRIVATE_KEY,
      fromBlock: resolved.WORKER_START_BLOCK
    });
    if (tokenId) {
      resolved.REMOVE_TOKEN_ID = tokenId;
      console.log(c(`  ✓ found tokenId ${tokenId} (most recent position minted to deployer)`, "cyan"));
    }
  } catch (err) {
    console.error(c(`  ⚠ auto-detect failed: ${err.message}`, "yellow"));
  }
}

if (!resolved.REMOVE_TOKEN_ID) {
  console.error(c("✗ REMOVE_TOKEN_ID is not set and could not be auto-detected", "red"));
  console.error(c("  set it in .env, your shell, or pass --tokenId <id> on the CLI", "dim"));
  console.error(c("  example: npm run remove -- 1234     (positional)", "dim"));
  console.error(c("           npm run remove -- --tokenId 1234 --multiplier 10", "dim"));
  process.exit(1);
}

if (!isValidUint(resolved.REMOVE_TOKEN_ID)) {
  console.error(c(`✗ REMOVE_TOKEN_ID is not a valid uint256: "${resolved.REMOVE_TOKEN_ID}"`, "red"));
  console.error(c("  pass it as decimal (1234) or 0x-prefixed hex (0x4d2)", "dim"));
  process.exit(1);
}
if (resolved.REMOVE_TOKEN_ID === "0") {
  console.error(c("✗ refusing to broadcast against tokenId 0 — that's not a real position", "red"));
  process.exit(1);
}

// `forge script` reads vm.envUint("PRIVATE_KEY") which expects 0x-prefixed hex.
const childEnv = { ...process.env };
for (const [k, v] of Object.entries(resolved)) {
  if (v) childEnv[k] = v; // never overwrite shell values with empty strings
}
if (childEnv.PRIVATE_KEY && /^[0-9a-fA-F]{64}$/.test(childEnv.PRIVATE_KEY)) {
  childEnv.PRIVATE_KEY = "0x" + childEnv.PRIVATE_KEY;
}

// Aggressive gas pricing so the tx confirms in 1-2 blocks even on a busy
// mempool. Default 10x current suggested tip; clamped 1..50.
const gasMultiplierIn = childEnv.REMOVE_GAS_MULTIPLIER || "10";
let gas;
try {
  gas = await computeFastGas(childEnv.RPC_HTTP_URL, gasMultiplierIn);
} catch (err) {
  console.error(c(`✗ failed to read gas params from RPC: ${err.message}`, "red"));
  console.error(c("  pass --gasMultiplier 1 to skip the boost (uses Foundry defaults).", "dim"));
  process.exit(1);
}

const forge = resolveForge();
const args = [
  "script",
  "script/RemoveLiquidityFast.s.sol:RemoveLiquidityFast",
  "--rpc-url", childEnv.RPC_HTTP_URL,
  "--broadcast",
  // EIP-1559 fast-confirm pair: tip × N + 2× current basefee headroom.
  "--priority-gas-price", gas.priorityFee.toString(),
  "--with-gas-price",     gas.maxFee.toString(),
  // Pad gas-limit estimate too in case forge under-estimates.
  "--gas-estimate-multiplier", "150",
  "-vvvv"
];

console.log(c(`▲ forge ${args.join(" ")}`, "cyan"));
console.log(c(`  REMOVE_TOKEN_ID        ${childEnv.REMOVE_TOKEN_ID}`, "dim"));
console.log(c(`  REMOVE_MULTIPLIER      ${childEnv.REMOVE_MULTIPLIER || "10 (default)"}`, "dim"));
console.log(c(`  V4_POSITION_MANAGER    ${childEnv.V4_POSITION_MANAGER}`, "dim"));
console.log(c(`  gas multiplier         ${gas.multiplier}x  (suggested tip ${fmtGwei(gas.suggestedTip)} → ${fmtGwei(gas.priorityFee)})`, "dim"));
console.log(c(`  baseFee (pending)      ${fmtGwei(gas.baseFee)}`, "dim"));
console.log(c(`  maxFeePerGas           ${fmtGwei(gas.maxFee)}      (2 × baseFee + priorityFee)`, "dim"));

const r = spawnSync(forge, args, { stdio: "inherit", cwd: contractsDir, env: childEnv, shell: false });
process.exit(r.status ?? 1);
