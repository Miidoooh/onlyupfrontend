import { mainnet, sepolia } from "viem/chains";
import type { Chain, Hex } from "viem";

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

/**
 * Default v4 + Universal Router addresses per chain. These come from the
 * Uniswap docs (https://docs.uniswap.org/contracts/v4/deployments). Override
 * any of them with NEXT_PUBLIC_* if Uniswap publishes new deployments later.
 */
const CHAIN_DEFAULTS: Record<number, {
  rpcUrl: string;
  chain: Chain;
  v4Quoter:        `0x${string}`;
  universalRouter: `0x${string}`;
  poolManager:     `0x${string}`;
}> = {
  // Sepolia
  11155111: {
    rpcUrl:          "https://ethereum-sepolia-rpc.publicnode.com",
    chain:           sepolia,
    v4Quoter:        "0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227",
    universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
    poolManager:     "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  },
  // Mainnet (Uniswap v4 mainnet deployment, public)
  1: {
    rpcUrl:          "https://ethereum-rpc.publicnode.com",
    chain:           mainnet,
    v4Quoter:        "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
    universalRouter: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
    poolManager:     "0x000000000004444c5dc75cB358380D2e3dE08A90",
  },
};

export const ACTIVE_CHAIN_ID = uintEnv("NEXT_PUBLIC_CHAIN_ID", 11155111);
const defaults = CHAIN_DEFAULTS[ACTIVE_CHAIN_ID] ?? CHAIN_DEFAULTS[11155111]!;
export const ACTIVE_CHAIN: Chain = defaults.chain;

// Kept for backwards compat with components/tests that import these names.
export const SEPOLIA_CHAIN_ID = ACTIVE_CHAIN_ID;
export const SEPOLIA_CHAIN_HEX = `0x${ACTIVE_CHAIN_ID.toString(16)}` as const;
export const SEPOLIA_RPC_URL = process.env.NEXT_PUBLIC_RPC_HTTP_URL ?? defaults.rpcUrl;

/** UP token — sync with root `.env` BOUNTY_TOKEN_ADDRESS */
export const BHOOK_TOKEN     = addrEnv("NEXT_PUBLIC_BOUNTY_TOKEN_ADDRESS", "0x0000000000000000000000000000000000000000");
/** Real v4 hook — sync with REAL_V4_HOOK_ADDRESS */
export const ACTIVE_V4_HOOK  = addrEnv("NEXT_PUBLIC_REAL_V4_HOOK_ADDRESS", "0x0000000000000000000000000000000000000000");
export const V4_QUOTER       = addrEnv("NEXT_PUBLIC_V4_QUOTER_ADDRESS",        defaults.v4Quoter);
export const UNIVERSAL_ROUTER = addrEnv("NEXT_PUBLIC_UNIVERSAL_ROUTER_ADDRESS", defaults.universalRouter);
export const POOL_MANAGER    = addrEnv("NEXT_PUBLIC_V4_POOL_MANAGER",          defaults.poolManager);
export const NATIVE_ETH = ZERO;

const V4_FEE  = uintEnv("NEXT_PUBLIC_V4_POOL_FEE",     10_000);
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
