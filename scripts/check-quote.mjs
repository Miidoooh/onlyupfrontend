/**
 * Hits the v4 Quoter on Sepolia directly with your exact PoolKey to confirm
 * the pool is routable on-chain. If the quoter returns amountOut > 0, the
 * pool works — Uniswap's UI is just not surfacing it.
 *
 *   node scripts/check-quote.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatEther, formatUnits, http, parseEther, parseUnits } from "viem";
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
const TOKEN = process.env.BOUNTY_TOKEN_ADDRESS;
const HOOK = process.env.REAL_V4_HOOK_ADDRESS;
const FEE = Number(process.env.V4_FEE ?? "3000");
const TICK = Number(process.env.V4_TICK_SPACING ?? "60");
const NATIVE = "0x0000000000000000000000000000000000000000";
const QUOTER = "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227";
const STATE_VIEW = "0xE1Dd9c3fA50EDB962E442f60DfBc432e24537E4C"; // v4 StateView (Sepolia)

if (!TOKEN || !HOOK) {
  console.error("✗ BOUNTY_TOKEN_ADDRESS / REAL_V4_HOOK_ADDRESS missing in .env");
  process.exit(1);
}

const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

const QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" }
            ]
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" }
        ]
      }
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" }
    ]
  }
];

const STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" }
    ]
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }]
  }
];

const POOL_ID = process.env.POOL_ID;
const poolKey = {
  currency0: NATIVE,
  currency1: TOKEN,
  fee: FEE,
  tickSpacing: TICK,
  hooks: HOOK
};

console.log("PoolKey:");
console.log(`  currency0 (ETH)  ${poolKey.currency0}`);
console.log(`  currency1 (UP)   ${poolKey.currency1}`);
console.log(`  fee              ${poolKey.fee}`);
console.log(`  tickSpacing      ${poolKey.tickSpacing}`);
console.log(`  hooks            ${poolKey.hooks}`);
console.log(`  POOL_ID (.env)   ${POOL_ID}\n`);

if (POOL_ID) {
  console.log(`▲ on-chain liquidity check (StateView ${STATE_VIEW})`);
  try {
    const slot0 = await client.readContract({
      address: STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: "getSlot0",
      args: [POOL_ID]
    });
    const liquidity = await client.readContract({
      address: STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: "getLiquidity",
      args: [POOL_ID]
    });
    console.log(`  sqrtPriceX96     ${slot0[0].toString()}`);
    console.log(`  tick             ${slot0[1]}`);
    console.log(`  in-range liquidity (L) ${liquidity.toString()}`);
    if (liquidity === 0n) {
      console.log(`  ⚠ in-range liquidity is ZERO. Quoter will revert "no route".`);
    } else {
      console.log(`  ✓ pool has in-range liquidity → quotes should succeed.`);
    }
  } catch (err) {
    console.log(`  ✗ StateView read failed: ${err.shortMessage ?? err.message}`);
  }
}

async function quote(zeroForOne, amountInDecimal) {
  const exactAmount =
    zeroForOne ? parseEther(amountInDecimal) : parseUnits(amountInDecimal, 18);
  try {
    const r = await client.simulateContract({
      address: QUOTER,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey, zeroForOne, exactAmount, hookData: "0x" }]
    });
    const [amountOut, gasEstimate] = r.result;
    const inLabel = zeroForOne ? "ETH" : "UP";
    const outLabel = zeroForOne ? "UP" : "ETH";
    const formattedOut = zeroForOne
      ? Number(formatUnits(amountOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })
      : formatEther(amountOut);
    console.log(
      `  ✓ ${amountInDecimal} ${inLabel} → ${formattedOut} ${outLabel}  (gas ~ ${gasEstimate.toString()})`
    );
  } catch (err) {
    console.log(`  ✗ quote (${zeroForOne ? "buy" : "sell"} ${amountInDecimal}) reverted:`);
    console.log(`     ${err.shortMessage ?? err.message}`);
    if (err.cause?.data) console.log(`     data: ${err.cause.data}`);
  }
}

console.log(`\n▲ quoting on v4 Quoter ${QUOTER}`);
await quote(true,  "0.001");      // buy 0.001 ETH worth of UP
await quote(true,  "0.01");
await quote(false, "1000");        // sell 1000 UP for ETH
await quote(false, "100000");      // sell 100k UP for ETH

console.log(`\nIf any quote above succeeded, the pool IS routable on-chain.`);
console.log(`If all reverted with "no route" / "PoolNotInitialized" / similar, fee/tick/hook in .env doesn't match the deployed PoolKey.`);
