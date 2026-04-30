import type { HexAddress } from "@bounty/shared";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4311";

export interface ApiBountyWindow {
  id: string;
  poolId: `0x${string}`;
  bountyToken: HexAddress;
  quoteToken: HexAddress;
  startBlock: string;
  endBlock: string;
  totalBounty: string;
  totalQualifyingBuy: string;
  bountyBps?: number;
  status: "active" | "finalizing" | "closed";
}

export interface ApiStats {
  activeWindows: number;
  totalBountyFunded: string;
  totalRewardsClaimed: string;
  totalHunters: number;
  largestDump: string;
  recoveriesTracked: number;
  currentBountyBps: number;
  sellPressureBps: number;
}

export interface ApiLeaderboardEntry {
  rank: number;
  wallet: HexAddress;
  totalBought: string;
  totalRewards: string;
  windowsWon: number;
}

export interface ApiPressure {
  poolId: `0x${string}`;
  sellVolume: string;
  buyVolume: string;
  bountyBps: number;
  sellPressureBps: number;
}

export interface ApiMissionEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  createdAt: string;
}

export interface ApiLaunchInfo {
  name: string;
  symbol: string;
  totalSupply: string;
  maxTxAmount: string;
  maxWalletAmount: string;
  tradingEnabled: boolean;
  launchLimitsEnabled: boolean;
  hookAddress: HexAddress;
  tokenAddress?: HexAddress;
  poolId: `0x${string}`;
}

export interface ApiBotHealth {
  apiIngestProtected: boolean;
  telegramMode: "dry-run" | "live";
  twitterMode: "dry-run" | "live";
  lastEventAt?: string;
}

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${apiUrl}${path}`, { next: { revalidate: 5 } });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function getDashboardData() {
  const [activeWindows, stats, leaderboard, events, launch, botHealth, pressure] = await Promise.all([
    fetchJson<ApiBountyWindow[]>("/bounties/active", []),
    fetchJson<ApiStats>("/stats", {
      activeWindows: 0,
      totalBountyFunded: "0",
      totalRewardsClaimed: "0",
      totalHunters: 0,
      largestDump: "0",
      recoveriesTracked: 0,
      currentBountyBps: 500,
      sellPressureBps: 0
    }),
    fetchJson<ApiLeaderboardEntry[]>("/leaderboard", []),
    fetchJson<ApiMissionEvent[]>("/events?limit=12", []),
    fetchJson<ApiLaunchInfo>("/launch", {
      name: "Only Up",
      symbol: "UP",
      totalSupply: "1000000000000000000000000000",
      maxTxAmount: "10000000000000000000000000",
      maxWalletAmount: "10000000000000000000000000",
      tradingEnabled: false,
      launchLimitsEnabled: true,
      hookAddress: "0x0000000000000000000000000000000000000000",
      poolId: "0x0000000000000000000000000000000000000000000000000000000000000000"
    }),
    fetchJson<ApiBotHealth>("/bot/health", {
      apiIngestProtected: false,
      telegramMode: "dry-run",
      twitterMode: "dry-run"
    }),
    fetchJson<ApiPressure[]>("/pressure", [])
  ]);

  return { activeWindows, stats, leaderboard, events, launch, botHealth, pressure };
}
