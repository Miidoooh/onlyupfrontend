/**
 * Scans Uniswap v4 PoolManager logs on Sepolia for `Initialize` events whose
 * currency0/currency1 matches BOUNTY_TOKEN_ADDRESS. Prints the resulting
 * PoolId so you can paste it into .env.
 *
 *   node scripts/find-pool.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbiItem
} from "viem";
import { sepolia } from "viem/chains";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

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
loadDotenv(path.join(repoRoot, ".env"));

const RPC = process.env.RPC_HTTP_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN = (process.env.BOUNTY_TOKEN_ADDRESS ?? "").toLowerCase();
const POOL_MANAGER = (process.env.V4_POOL_MANAGER ?? "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543").toLowerCase();
const OUR_HOOK = (process.env.REAL_V4_HOOK_ADDRESS ?? "").toLowerCase();
const ZERO = "0x0000000000000000000000000000000000000000";

if (!TOKEN || TOKEN === ZERO) {
  console.error("✗ BOUNTY_TOKEN_ADDRESS missing in .env");
  process.exit(1);
}

const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

const initializeAbi = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)"
);

const POOL_KEY_TYPES = [
  {
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" }
    ]
  }
];

function computePoolId(currency0, currency1, fee, tickSpacing, hooks) {
  const encoded = encodeAbiParameters(POOL_KEY_TYPES, [{ currency0, currency1, fee, tickSpacing, hooks }]);
  return keccak256(encoded);
}

const latest = await client.getBlockNumber();
const lookback = 100_000n;
const from = latest > lookback ? latest - lookback : 0n;
const CHUNK = 5_000n;

console.log(`▲ scanning PoolManager ${POOL_MANAGER}`);
console.log(`  from block ${from} → ${latest} (last ~${lookback})`);
console.log(`  filter currency0/1 = ${TOKEN}\n`);

const matches = [];
for (let cursor = from; cursor <= latest; cursor += CHUNK + 1n) {
  const to = cursor + CHUNK > latest ? latest : cursor + CHUNK;
  let logs = [];
  try {
    logs = await client.getLogs({
      address: POOL_MANAGER,
      event: initializeAbi,
      fromBlock: cursor,
      toBlock: to
    });
  } catch (err) {
    console.error(`  · skipped ${cursor}-${to}: ${err.shortMessage ?? err.message}`);
    continue;
  }
  for (const log of logs) {
    const decoded = decodeEventLog({ abi: [initializeAbi], data: log.data, topics: log.topics });
    const a = String(decoded.args.currency0).toLowerCase();
    const b = String(decoded.args.currency1).toLowerCase();
    if (a === TOKEN || b === TOKEN) {
      matches.push({
        block: log.blockNumber,
        txHash: log.transactionHash,
        poolId: String(decoded.args.id),
        currency0: decoded.args.currency0,
        currency1: decoded.args.currency1,
        fee: Number(decoded.args.fee),
        tickSpacing: Number(decoded.args.tickSpacing),
        hooks: String(decoded.args.hooks),
        sqrtPriceX96: String(decoded.args.sqrtPriceX96),
        tick: Number(decoded.args.tick)
      });
    }
  }
}

if (matches.length === 0) {
  console.log("✗ no v4 pool was initialized for this token in the last 100k blocks.");
  console.log("  • If you added liquidity but didn't 'Create Pool' first, the pool may not exist on-chain.");
  console.log("  • If you created the pool more than ~100k blocks ago, increase the lookback.");
  process.exit(0);
}

console.log(`✓ found ${matches.length} pool(s) for token ${TOKEN}:\n`);
for (const m of matches) {
  const recomputed = computePoolId(m.currency0, m.currency1, m.fee, m.tickSpacing, m.hooks);
  const isOurHook = OUR_HOOK && m.hooks.toLowerCase() === OUR_HOOK;
  const isNoHook = m.hooks.toLowerCase() === ZERO;
  const tag = isOurHook ? "← OUR HOOK" : isNoHook ? "← NO HOOK (vanilla v4)" : "← unknown hook";
  console.log(`  poolId          ${m.poolId}  ${tag}`);
  console.log(`  recomputed      ${recomputed}  ${recomputed === m.poolId ? "match ✓" : "MISMATCH"}`);
  console.log(`  currency0       ${m.currency0}`);
  console.log(`  currency1       ${m.currency1}`);
  console.log(`  fee             ${m.fee}    tickSpacing ${m.tickSpacing}`);
  console.log(`  hooks           ${m.hooks}`);
  console.log(`  sqrtPriceX96    ${m.sqrtPriceX96}    tick ${m.tick}`);
  console.log(`  init at block   ${m.block}    tx ${m.txHash}`);
  console.log("");
}

if (matches.length === 1) {
  const m = matches[0];
  console.log("Suggested .env update:");
  console.log(`  POOL_ID=${m.poolId}`);
  console.log(`  V4_FEE=${m.fee}`);
  console.log(`  V4_TICK_SPACING=${m.tickSpacing}`);
  console.log(`  NEXT_PUBLIC_V4_POOL_FEE=${m.fee}`);
  console.log(`  NEXT_PUBLIC_V4_TICK_SPACING=${m.tickSpacing}`);
  if (OUR_HOOK && m.hooks.toLowerCase() === OUR_HOOK) {
    console.log("\nNext: turn the bounty mechanism on for this pool:");
    console.log("  forge script script/ConfigureNativeEthV4Route.s.sol:ConfigureNativeEthV4Route --broadcast --rpc-url $env:RPC_HTTP_URL  (run from contracts/)");
  } else if (m.hooks.toLowerCase() === ZERO) {
    console.log(
      "\nNote: this pool has NO hook → swaps will work in stock Uniswap UI, but no bounty events will fire."
    );
  }
}
