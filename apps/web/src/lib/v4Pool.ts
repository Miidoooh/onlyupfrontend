import type { Hex } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_HEX = "0xaa36a7";

/** Must match `RPC_HTTP_URL` / repo `.env` — same RPC the worker uses. */
export const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_HTTP_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

/**
 * Native ETH pool only (currency0 = address(0)). Fee/tick MUST match the deployed PoolKey
 * (DeployNativeEthRealV4Launch uses fee=10000, tickSpacing=200).
 */
const ZERO = "0x0000000000000000000000000000000000000000" as const;

function addrEnv(key: string, fallback: `0x${string}`): `0x${string}` {
  const v = process.env[key]?.trim();
  if (v && /^0x[a-fA-F0-9]{40}$/i.test(v)) return v as `0x${string}`;
  return fallback;
}

function uintEnv(key: string, fallback: number): number {
  const v = process.env[key]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** UP / BHOOK token — sync with root `.env` BOUNTY_TOKEN_ADDRESS */
export const BHOOK_TOKEN = addrEnv(
  "NEXT_PUBLIC_BOUNTY_TOKEN_ADDRESS",
  "0x7026FA995927e9B9A52B5F558E4E4952A1901D70"
);

/** Real v4 hook — sync with REAL_V4_HOOK_ADDRESS */
export const ACTIVE_V4_HOOK = addrEnv(
  "NEXT_PUBLIC_REAL_V4_HOOK_ADDRESS",
  "0x523AEA8bE80b51Bf69AFFcB13dB0c140ba344040"
);

export const V4_QUOTER = addrEnv("NEXT_PUBLIC_V4_QUOTER_ADDRESS", "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227");
export const UNIVERSAL_ROUTER = addrEnv(
  "NEXT_PUBLIC_UNIVERSAL_ROUTER_ADDRESS",
  "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b"
);
export const NATIVE_ETH = ZERO;

const V4_FEE = uintEnv("NEXT_PUBLIC_V4_POOL_FEE", 10_000);
const V4_TICK = uintEnv("NEXT_PUBLIC_V4_TICK_SPACING", 200);

export const ACTIVE_POOL_KEY = {
  currency0: NATIVE_ETH,
  currency1: BHOOK_TOKEN,
  fee: V4_FEE,
  tickSpacing: V4_TICK,
  hooks: ACTIVE_V4_HOOK
} as const;

export const QUOTER_ABI = [
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

export const UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" }
    ],
    outputs: []
  }
] as const;

export type PoolKey = typeof ACTIVE_POOL_KEY;

export function applySlippage(amount: bigint, bps: bigint): bigint {
  return (amount * (10_000n - bps)) / 10_000n;
}

export function asHex(value: string): Hex {
  return value as Hex;
}
