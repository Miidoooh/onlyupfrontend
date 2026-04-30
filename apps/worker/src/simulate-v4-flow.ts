import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, formatEther, formatUnits, http, parseEther } from "viem";
import { sepolia } from "viem/chains";

const ENV_PATH = resolve(process.cwd(), ".env");

function loadEnv() {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2] ?? "";
    if (!key) continue;
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const configuredRpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_HTTP_URL;
const rpcUrl = configuredRpcUrl?.startsWith("wss://")
  ? configuredRpcUrl.replace("wss://", "https://")
  : configuredRpcUrl;
if (!rpcUrl) throw new Error("Missing SEPOLIA_RPC_URL or RPC_HTTP_URL");

const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

const quoter = "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227" as const;
const token = "0x7026FA995927e9B9A52B5F558E4E4952A1901D70" as const;
const hook = "0x523AEA8bE80b51Bf69AFFcB13dB0c140ba344040" as const;
const nativeEth = "0x0000000000000000000000000000000000000000" as const;

const quoteAbi = [
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
] as const;

const iterations = Number(process.env.SIM_COUNT ?? "500");
const buyAmount = parseEther(process.env.SIM_BUY_ETH ?? "0.001");
const sellAmount = parseEther(process.env.SIM_SELL_BHOOK ?? "10000");
const poolKey = { currency0: nativeEth, currency1: token, fee: 3000, tickSpacing: 60, hooks: hook };

async function quote(index: number) {
  const isBuy = index % 2 === 0;
  const result = (await client.readContract({
    address: quoter,
    abi: quoteAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey,
        zeroForOne: isBuy,
        exactAmount: isBuy ? buyAmount : sellAmount,
        hookData: "0x"
      }
    ]
  })) as readonly [bigint, bigint];
  const [amountOut, gasEstimate] = result;

  return { isBuy, amountOut, gasEstimate };
}

let buyOut = 0n;
let sellOut = 0n;
let gas = 0n;
let failures = 0;
let firstError: string | undefined;

for (let start = 0; start < iterations; start += 25) {
  const batch = Array.from({ length: Math.min(25, iterations - start) }, (_, offset) => start + offset);
  const results = await Promise.allSettled(batch.map((index) => quote(index)));
  for (const result of results) {
    if (result.status === "rejected") {
      failures += 1;
      firstError ??= result.reason instanceof Error ? result.reason.message : String(result.reason);
      continue;
    }
    gas += result.value.gasEstimate;
    if (result.value.isBuy) buyOut += result.value.amountOut;
    else sellOut += result.value.amountOut;
  }
}

const successful = iterations - failures;
console.log(
  JSON.stringify(
    {
      mode: "dry-run-quotes",
      iterations,
      successful,
      failures,
      buyQuotes: Math.ceil(iterations / 2),
      sellQuotes: Math.floor(iterations / 2),
      avgGas: successful > 0 ? (gas / BigInt(successful)).toString() : "0",
      totalQuotedBhookFromBuys: formatUnits(buyOut, 18),
      totalQuotedEthFromSells: formatEther(sellOut),
      firstError
    },
    null,
    2
  )
);
