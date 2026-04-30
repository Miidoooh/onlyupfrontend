export type HexAddress = `0x${string}`;
export type Bytes32 = `0x${string}`;

export type BountyWindowStatus = "active" | "finalizing" | "closed";

export interface ChainConfig {
  chainId: number;
  rpcHttpUrl: string;
  rpcWsUrl?: string;
  bountyHookAddress: HexAddress;
  /** Optional. When omitted, the API/worker do not pre-filter to a single pool. */
  poolId?: Bytes32;
}

export interface BountyWindow {
  id: string;
  poolId: Bytes32;
  bountyToken: HexAddress;
  quoteToken: HexAddress;
  startBlock: bigint;
  endBlock: bigint;
  totalBounty: bigint;
  totalQualifyingBuy: bigint;
  bountyBps?: number;
  status: BountyWindowStatus;
}

export interface BountyParticipant {
  windowId: string;
  buyer: HexAddress;
  qualifyingBuyAmount: bigint;
  estimatedReward: bigint;
  claimedReward: bigint;
}

export interface BountyStats {
  activeWindows: number;
  totalBountyFunded: bigint;
  totalRewardsClaimed: bigint;
  totalHunters: number;
  largestDump: bigint;
  recoveriesTracked: number;
  currentBountyBps: number;
  sellPressureBps: number;
}

export interface LeaderboardEntry {
  rank: number;
  wallet: HexAddress;
  totalBought: bigint;
  totalRewards: bigint;
  windowsWon: number;
}

export interface BountyPressure {
  poolId: Bytes32;
  sellVolume: bigint;
  buyVolume: bigint;
  bountyBps: number;
  sellPressureBps: number;
}

export interface MissionEvent {
  id: string;
  type: string;
  title: string;
  description: string;
  blockNumber?: bigint;
  createdAt: string;
}

export interface TokenLaunchInfo {
  name: string;
  symbol: string;
  totalSupply: bigint;
  maxTxAmount: bigint;
  maxWalletAmount: bigint;
  tradingEnabled: boolean;
  launchLimitsEnabled: boolean;
  hookAddress: HexAddress;
  tokenAddress?: HexAddress;
  /** Optional until the pool is created; web/api fall back to a zero placeholder for display. */
  poolId?: Bytes32;
}

export interface BotHealth {
  apiIngestProtected: boolean;
  telegramMode: "dry-run" | "live";
  twitterMode: "dry-run" | "live";
  lastEventAt?: string;
}
