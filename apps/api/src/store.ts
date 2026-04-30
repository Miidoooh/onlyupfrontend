import type {
  BotHealth,
  BountyEvent,
  BountyParticipant,
  BountyPressure,
  BountyStats,
  BountyWindow,
  Bytes32,
  HexAddress,
  LeaderboardEntry,
  MissionEvent,
  TokenLaunchInfo
} from "@bounty/shared";

export class BountyReadStore {
  private readonly windows = new Map<string, BountyWindow>();
  private readonly participants = new Map<string, Map<HexAddress, BountyParticipant>>();
  private readonly pressureByPool = new Map<Bytes32, BountyPressure>();
  private readonly events: MissionEvent[] = [];
  private readonly claimedByBuyer = new Map<HexAddress, bigint>();
  private readonly boughtByBuyer = new Map<HexAddress, bigint>();
  private readonly windowsWonByBuyer = new Map<HexAddress, Set<string>>();
  private largestDump = 0n;
  private lastEventAt: string | undefined;

  apply(event: BountyEvent): void {
    this.lastEventAt = new Date().toISOString();
    this.events.unshift(this.toMissionEvent(event));
    if (this.events.length > 100) this.events.pop();

    if (event.type === "BountyOpened") {
      this.windows.set(event.windowId, {
        id: event.windowId,
        poolId: event.poolId,
        bountyToken: event.bountyToken,
        quoteToken: event.quoteToken,
        startBlock: event.startBlock,
        endBlock: event.endBlock,
        totalBounty: event.bountyAmount,
        totalQualifyingBuy: 0n,
        bountyBps: event.bountyBps,
        status: "active"
      });
      return;
    }

    if (event.type === "BountyFunded") {
      const window = this.requireWindow(event.windowId);
      window.totalBounty += event.bountyAmount;
      window.bountyBps = event.bountyBps ?? window.bountyBps;
      this.largestDump = event.sellAmount > this.largestDump ? event.sellAmount : this.largestDump;
      return;
    }

    if (event.type === "BountyBuyRecorded") {
      const window = this.requireWindow(event.windowId);
      window.totalQualifyingBuy += event.buyAmount;
      const participant = this.getOrCreateParticipant(event.windowId, event.buyer);
      participant.qualifyingBuyAmount += event.buyAmount;
      this.bumpMap(this.boughtByBuyer, event.buyer, event.buyAmount);
      const windowsWon = this.windowsWonByBuyer.get(event.buyer) ?? new Set<string>();
      windowsWon.add(event.windowId);
      this.windowsWonByBuyer.set(event.buyer, windowsWon);
      return;
    }

    if (event.type === "BountyPressureUpdated") {
      const sellPressureBps =
        event.sellVolume > event.buyVolume && event.sellVolume > 0n
          ? Number(((event.sellVolume - event.buyVolume) * 10_000n) / event.sellVolume)
          : 0;
      this.pressureByPool.set(event.poolId, {
        poolId: event.poolId,
        sellVolume: event.sellVolume,
        buyVolume: event.buyVolume,
        bountyBps: event.bountyBps,
        sellPressureBps
      });
      return;
    }

    if (event.type === "BountyWindowClosed") {
      const window = this.requireWindow(event.windowId);
      window.totalBounty = event.totalBounty;
      window.totalQualifyingBuy = event.totalQualifyingBuy;
      window.status = "closed";
      return;
    }

    if (event.type === "BountyClaimed") {
      this.bumpMap(this.claimedByBuyer, event.buyer, event.rewardAmount);
      const participant = this.getOrCreateParticipant(event.windowId, event.buyer);
      participant.claimedReward += event.rewardAmount;
    }
  }

  getActiveWindows(): BountyWindow[] {
    return [...this.windows.values()].filter((window) => window.status === "active");
  }

  getWindows(): BountyWindow[] {
    return [...this.windows.values()].sort((left, right) => Number(right.startBlock - left.startBlock));
  }

  getWindow(windowId: string): BountyWindow | undefined {
    return this.windows.get(windowId);
  }

  getParticipants(windowId: string): BountyParticipant[] {
    const participants = [...(this.participants.get(windowId)?.values() ?? [])];
    const window = this.windows.get(windowId);
    return participants
      .map((participant) => ({
        ...participant,
        estimatedReward: this.estimatedReward(window, participant.qualifyingBuyAmount)
      }))
      .sort((left, right) => Number(right.qualifyingBuyAmount - left.qualifyingBuyAmount));
  }

  getEvents(limit = 30): MissionEvent[] {
    return this.events.slice(0, limit);
  }

  getPressure(poolId?: Bytes32): BountyPressure[] {
    if (poolId) {
      const pressure = this.pressureByPool.get(poolId);
      return pressure ? [pressure] : [];
    }
    return [...this.pressureByPool.values()];
  }

  getStats(): BountyStats {
    const windows = this.getWindows();
    const latestPressure = this.getPressure()[0];
    return {
      activeWindows: windows.filter((window) => window.status === "active").length,
      totalBountyFunded: windows.reduce((sum, window) => sum + window.totalBounty, 0n),
      totalRewardsClaimed: [...this.claimedByBuyer.values()].reduce((sum, value) => sum + value, 0n),
      totalHunters: this.boughtByBuyer.size,
      largestDump: this.largestDump,
      recoveriesTracked: windows.filter((window) => window.status === "closed").length,
      currentBountyBps: latestPressure?.bountyBps ?? windows[0]?.bountyBps ?? 500,
      sellPressureBps: latestPressure?.sellPressureBps ?? 0
    };
  }

  getLeaderboard(): LeaderboardEntry[] {
    return [...this.boughtByBuyer.entries()]
      .map(([wallet, totalBought]) => ({
        rank: 0,
        wallet,
        totalBought,
        totalRewards: this.claimedByBuyer.get(wallet) ?? 0n,
        windowsWon: this.windowsWonByBuyer.get(wallet)?.size ?? 0
      }))
      .sort((left, right) => Number(right.totalRewards - left.totalRewards || right.totalBought - left.totalBought))
      .map((entry, index) => ({ ...entry, rank: index + 1 }));
  }

  getLaunchInfo(input: Omit<TokenLaunchInfo, "tradingEnabled" | "launchLimitsEnabled">): TokenLaunchInfo {
    return {
      ...input,
      tradingEnabled: false,
      launchLimitsEnabled: true
    };
  }

  getBotHealth(input: Omit<BotHealth, "lastEventAt">): BotHealth {
    return {
      ...input,
      lastEventAt: this.lastEventAt
    };
  }

  private requireWindow(windowId: string): BountyWindow {
    const window = this.windows.get(windowId);
    if (!window) {
      throw new Error(`Unknown bounty window: ${windowId}`);
    }
    return window;
  }

  private bumpMap(map: Map<HexAddress, bigint>, key: HexAddress, amount: bigint): void {
    map.set(key, (map.get(key) ?? 0n) + amount);
  }

  private getOrCreateParticipant(windowId: string, buyer: HexAddress): BountyParticipant {
    const windowParticipants = this.participants.get(windowId) ?? new Map<HexAddress, BountyParticipant>();
    this.participants.set(windowId, windowParticipants);
    const existing = windowParticipants.get(buyer);
    if (existing) return existing;

    const participant: BountyParticipant = {
      windowId,
      buyer,
      qualifyingBuyAmount: 0n,
      estimatedReward: 0n,
      claimedReward: 0n
    };
    windowParticipants.set(buyer, participant);
    return participant;
  }

  private estimatedReward(window: BountyWindow | undefined, qualifyingBuyAmount: bigint): bigint {
    if (!window || window.totalQualifyingBuy === 0n) return 0n;
    return (window.totalBounty * qualifyingBuyAmount) / window.totalQualifyingBuy;
  }

  private toMissionEvent(event: BountyEvent): MissionEvent {
    const createdAt = new Date().toISOString();
    if (event.type === "BountyOpened") {
      return {
        id: `${event.type}:${event.windowId}`,
        type: event.type,
        title: "Bounty window armed",
        description: `${event.bountyBps ?? 500} bps bounty opened for ${event.endBlock - event.startBlock} blocks.`,
        createdAt
      };
    }
    if (event.type === "BountyFunded") {
      return {
        id: `${event.type}:${event.windowId}:${event.seller}`,
        type: event.type,
        title: "Whale funded the hunt",
        description: `${event.bountyBps ?? 500} bps skim added ${event.bountyAmount.toString()} reward units.`,
        createdAt
      };
    }
    if (event.type === "BountyPressureUpdated") {
      return {
        id: `${event.type}:${event.poolId}:${createdAt}`,
        type: event.type,
        title: "Sell pressure shifted",
        description: `Dynamic bounty is now ${event.bountyBps} bps.`,
        createdAt
      };
    }
    if (event.type === "BountyBuyRecorded") {
      return {
        id: `${event.type}:${event.windowId}:${event.buyer}:${createdAt}`,
        type: event.type,
        title: "Hunter joined the wall",
        description: `${event.buyer} added qualifying buy volume.`,
        createdAt
      };
    }
    if (event.type === "BountyClaimed") {
      return {
        id: `${event.type}:${event.windowId}:${event.buyer}`,
        type: event.type,
        title: "Bounty claimed",
        description: `${event.buyer} claimed ${event.rewardAmount.toString()} reward units.`,
        createdAt
      };
    }
    return {
      id: `${event.type}:${event.windowId}`,
      type: event.type,
      title: "Window closed",
      description: "The bounty window settled and rewards are claimable.",
      createdAt
    };
  }
}
