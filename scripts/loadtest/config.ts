/**
 * Shared config + ABIs for the Only Up Anvil load test.
 * Reads .env from the repo root if present.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineChain, type Address, type Hex } from "viem";

const ENV_PATH = resolve(process.cwd(), ".env");

export function loadEnv(): void {
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

/* ---- Sepolia defaults (only used when .env omits an address) ---- */
const DEFAULT_OPERATOR = "0xFc2B23a0024cF750E6dAFCD0b3E6F617C7172ab8" as Address;
const DEFAULT_POLICY = "0xe841Df9512f55BBA065E87e44fceccB1D8FDc149" as Address;
const DEFAULT_CORE = "0x50353c58366e5B5E693B48875EDA62390B04Eb5D" as Address;
const DEFAULT_V4_HOOK = "0x523AEA8bE80b51Bf69AFFcB13dB0c140ba344040" as Address;
const DEFAULT_TOKEN = "0x7026FA995927e9B9A52B5F558E4E4952A1901D70" as Address;
const DEFAULT_POOL_ID =
  "0x090d15173733f4ba3f2b691c0d3f5cebf85d38cb6f5c65630bff81cea6084e12" as Hex;

function pickAddr(envKey: string, fallback: Address): Address {
  const v = process.env[envKey]?.trim();
  if (v && /^0x[a-fA-F0-9]{40}$/i.test(v)) return v as Address;
  return fallback;
}

function pickPoolId(envKey: string, fallback: Hex): Hex {
  const v = process.env[envKey]?.trim();
  if (v && /^0x[a-fA-F0-9]{64}$/i.test(v)) return v as Hex;
  return fallback;
}

export const SEPOLIA_CHAIN_ID = 11155111;

/** Prefer repo-root `.env`: matches worker/API ingests and doctor chain reads */
export const ADDR = {
  OPERATOR: pickAddr("DEPLOY_OPERATOR_ADDRESS", DEFAULT_OPERATOR),
  POLICY: pickAddr("POLICY_ADDRESS", DEFAULT_POLICY),
  CORE: pickAddr("BOUNTY_HOOK_ADDRESS", DEFAULT_CORE),
  V4_HOOK: pickAddr("REAL_V4_HOOK_ADDRESS", DEFAULT_V4_HOOK),
  TOKEN: pickAddr("BOUNTY_TOKEN_ADDRESS", DEFAULT_TOKEN),
  POOL_MANAGER: pickAddr("V4_POOL_MANAGER", "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543" as Address),
  POOL_ID: pickPoolId("POOL_ID", DEFAULT_POOL_ID),
  NATIVE_ETH: "0x0000000000000000000000000000000000000000" as Address
} as const;

/**
 * Doctor probes each pool for activity. Primary row comes from `.env` POOL_ID + fee/tick;
 * optional second pool via LEGACY_POOL_ID for older deployments.
 */
function buildKnownPools(): readonly { name: string; poolId: Hex; fee: number; tickSpacing: number }[] {
  const primaryId = ADDR.POOL_ID;
  const fee = Number(process.env.V4_FEE ?? process.env.NEXT_PUBLIC_V4_POOL_FEE ?? "10000");
  const tick = Number(process.env.V4_TICK_SPACING ?? process.env.NEXT_PUBLIC_V4_TICK_SPACING ?? "200");
  const rows: { name: string; poolId: Hex; fee: number; tickSpacing: number }[] = [
    { name: "primary (native ETH · .env POOL_ID)", poolId: primaryId, fee, tickSpacing: tick }
  ];
  const legacyRaw = process.env.LEGACY_POOL_ID?.trim();
  if (legacyRaw && /^0x[a-fA-F0-9]{64}$/i.test(legacyRaw) && legacyRaw.toLowerCase() !== primaryId.toLowerCase()) {
    rows.push({
      name: "LEGACY_POOL_ID (optional)",
      poolId: legacyRaw as Hex,
      fee: Number(process.env.LEGACY_V4_FEE ?? "3000"),
      tickSpacing: Number(process.env.LEGACY_V4_TICK_SPACING ?? "60")
    });
  }
  return rows;
}

export const KNOWN_POOLS = buildKnownPools();

/* ---- runtime config (env-overridable) ---- */
export const CONFIG = {
  anvilRpc: process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545",
  upstreamRpc: pickUpstreamRpc(),
  mnemonic: process.env.LOADTEST_MNEMONIC || "test test test test test test test test test test test junk",
  walletCount: Math.max(1, Number(process.env.WALLETS ?? "100")),
  startBalanceEth: process.env.START_BALANCE_ETH ?? "10",
  startBalanceUp: process.env.START_BALANCE_UP ?? "5000000",
  rounds: Math.max(1, Number(process.env.ROUNDS ?? "200")),
  buyProb: Number(process.env.BUY_PROB ?? "0.7"),
  minSellUp: process.env.MIN_SELL_UP ?? "20",
  maxSellUp: process.env.MAX_SELL_UP ?? "200000",
  minBuyEth: process.env.MIN_BUY_ETH ?? "0.001",
  maxBuyEth: process.env.MAX_BUY_ETH ?? "0.5",
  /** how many anvil blocks to mine between rounds (advances window state) */
  blocksPerRound: Math.max(0, Number(process.env.BLOCKS_PER_ROUND ?? "1")),
  /** mine this many extra blocks at the end so we can claim */
  finalMine: Math.max(0, Number(process.env.FINAL_MINE ?? "55"))
} as const;

function pickUpstreamRpc(): string | undefined {
  const raw = process.env.SEPOLIA_RPC_URL || process.env.RPC_HTTP_URL;
  if (!raw) return undefined;
  return raw.startsWith("wss://") ? raw.replace("wss://", "https://") : raw;
}

/* ---- chain definition for Anvil-forked Sepolia ---- */
export const anvilSepolia = defineChain({
  id: SEPOLIA_CHAIN_ID,
  name: "Anvil Sepolia Fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [CONFIG.anvilRpc] }
  }
});

/* ---- minimal ABIs ---- */
export const tokenAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "owner",          stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tradingEnabled", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "limitsEnabled",  stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "isLimitExempt",  stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance",      stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "enableTrading",  stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "setLimitExempt", stateMutability: "nonpayable", inputs: [{ name: "a", type: "address" }, { name: "x", type: "bool" }], outputs: [] },
  { type: "function", name: "setLimitsEnabled", stateMutability: "nonpayable", inputs: [{ name: "x", type: "bool" }], outputs: [] },
  { type: "function", name: "transfer",       stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "approve",        stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }
] as const;

export const coreAbi = [
  { type: "function", name: "owner",              stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "reporter",           stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "bountyWindowBlocks", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "minDumpAmount",      stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "activeWindowByPool", stateMutability: "view", inputs: [{ name: "p", type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  {
    type: "function",
    name: "reportSwap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "trader", type: "address" },
      { name: "bountyToken", type: "address" },
      { name: "quoteToken", type: "address" },
      { name: "side", type: "uint8" },
      { name: "amountIn", type: "uint256" }
    ],
    outputs: [{ type: "bytes32" }]
  },
  { type: "function", name: "claim",     stateMutability: "nonpayable", inputs: [{ name: "windowId", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimable", stateMutability: "view",       inputs: [{ name: "windowId", type: "bytes32" }, { name: "buyer", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "buyers",    stateMutability: "view",       inputs: [{ name: "windowId", type: "bytes32" }], outputs: [{ type: "address[]" }] },

  /* ---- events ---- */
  {
    type: "event",
    name: "BountyOpened",
    inputs: [
      { name: "windowId", type: "bytes32", indexed: true },
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "bountyToken", type: "address", indexed: true },
      { name: "quoteToken", type: "address" },
      { name: "startBlock", type: "uint64" },
      { name: "endBlock", type: "uint64" },
      { name: "bountyAmount", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "BountyFunded",
    inputs: [
      { name: "windowId", type: "bytes32", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "bountyAmount", type: "uint256" },
      { name: "sellAmount", type: "uint256" },
      { name: "bountyBps", type: "uint16" }
    ]
  },
  {
    type: "event",
    name: "BountyBuyRecorded",
    inputs: [
      { name: "windowId", type: "bytes32", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "buyAmount", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "BountyPressureUpdated",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "sellVolume", type: "uint256" },
      { name: "buyVolume", type: "uint256" },
      { name: "bountyBps", type: "uint16" }
    ]
  },
  {
    type: "event",
    name: "BountyWindowClosed",
    inputs: [
      { name: "windowId", type: "bytes32", indexed: true },
      { name: "totalBounty", type: "uint256" },
      { name: "totalQualifyingBuy", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "BountyClaimed",
    inputs: [
      { name: "windowId", type: "bytes32", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "rewardAmount", type: "uint256" }
    ]
  }
] as const;

export const MAX_UINT256 = (1n << 256n) - 1n;
