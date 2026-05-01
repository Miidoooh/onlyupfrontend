import type { HexAddress } from "@bounty/shared";

const SELECTORS = {
  tradingEnabled: "0x4ada218b",
  limitsEnabled: "0x3582ad23",
  maxTxAmount: "0x8c0b5e22",
  maxWalletAmount: "0xaa4bde28",
  totalSupply: "0x18160ddd",
  name: "0x06fdde03",
  symbol: "0x95d89b41"
} as const;

interface JsonRpcResponse {
  result?: string;
  error?: { code: number; message: string };
}

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] });
  const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body });
  const j = (await r.json()) as JsonRpcResponse;
  if (j.error) throw new Error(`eth_call ${data}: ${j.error.message}`);
  if (!j.result) throw new Error(`eth_call ${data}: empty result`);
  return j.result;
}

function decodeBool(hex: string): boolean {
  return BigInt(hex) === 1n;
}

function decodeUint256(hex: string): bigint {
  return BigInt(hex);
}

function decodeString(hex: string): string {
  // ABI-encoded string: 0x[offset(32)][length(32)][bytes...]
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length < 128) return "";
  const length = Number(BigInt("0x" + data.slice(64, 128)));
  const bytesHex = data.slice(128, 128 + length * 2);
  return Buffer.from(bytesHex, "hex").toString("utf8");
}

export interface OnChainLaunchState {
  name: string;
  symbol: string;
  totalSupply: bigint;
  maxTxAmount: bigint;
  maxWalletAmount: bigint;
  tradingEnabled: boolean;
  launchLimitsEnabled: boolean;
}

interface CacheEntry {
  state: OnChainLaunchState;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 15_000;

export async function readLaunchState(
  rpcUrl: string,
  tokenAddress: HexAddress
): Promise<OnChainLaunchState | undefined> {
  const key = `${rpcUrl}|${tokenAddress.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  try {
    const [tradingHex, limitsHex, maxTxHex, maxWalletHex, supplyHex, nameHex, symbolHex] = await Promise.all([
      ethCall(rpcUrl, tokenAddress, SELECTORS.tradingEnabled),
      ethCall(rpcUrl, tokenAddress, SELECTORS.limitsEnabled),
      ethCall(rpcUrl, tokenAddress, SELECTORS.maxTxAmount),
      ethCall(rpcUrl, tokenAddress, SELECTORS.maxWalletAmount),
      ethCall(rpcUrl, tokenAddress, SELECTORS.totalSupply),
      ethCall(rpcUrl, tokenAddress, SELECTORS.name),
      ethCall(rpcUrl, tokenAddress, SELECTORS.symbol)
    ]);

    const state: OnChainLaunchState = {
      tradingEnabled: decodeBool(tradingHex),
      launchLimitsEnabled: decodeBool(limitsHex),
      maxTxAmount: decodeUint256(maxTxHex),
      maxWalletAmount: decodeUint256(maxWalletHex),
      totalSupply: decodeUint256(supplyHex),
      name: decodeString(nameHex),
      symbol: decodeString(symbolHex)
    };

    cache.set(key, { state, expiresAt: Date.now() + TTL_MS });
    return state;
  } catch (err) {
    if (cached) return cached.state;
    return undefined;
  }
}
