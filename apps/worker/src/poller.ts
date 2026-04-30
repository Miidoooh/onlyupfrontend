import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createPublicClient, http, type Address } from "viem";
import { findRepoRoot } from "@bounty/shared/env";
import type { BountyEvent, ChainConfig } from "@bounty/shared";
import { bountyHookAbi } from "./chain.js";
import type { BountyEventProcessor } from "./indexer.js";

interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
}

export interface BountyLogPollerOptions {
  chainConfig: ChainConfig;
  processor: BountyEventProcessor;
  startBlock: bigint;
  intervalMs: number;
  checkpointFile: string;
}

export class BountyLogPoller {
  private readonly client;
  private cursor: bigint;
  private timer: NodeJS.Timeout | undefined;
  private readonly seenLogs = new Set<string>();
  private readonly checkpointFile: string;

  /** Max blocks per `getContractEvents` call. Most public RPCs reject more than this. */
  private static readonly MAX_RANGE = 5_000n;

  constructor(private readonly options: BountyLogPollerOptions) {
    const httpUrl = options.chainConfig.rpcHttpUrl.startsWith("wss://")
      ? options.chainConfig.rpcHttpUrl.replace("wss://", "https://")
      : options.chainConfig.rpcHttpUrl;
    this.client = createPublicClient({ transport: http(httpUrl) });
    // Always resolve relative checkpoint paths from the monorepo root, never
    // from process.cwd() — npm workspaces set cwd to apps/worker/, which would
    // otherwise produce apps/worker/apps/worker/.checkpoint.
    this.checkpointFile = isAbsolute(options.checkpointFile)
      ? options.checkpointFile
      : resolve(findRepoRoot(), options.checkpointFile);
    mkdirSync(dirname(this.checkpointFile), { recursive: true });
    this.cursor = this.readCheckpoint() ?? options.startBlock;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    const latestBlock = await this.client.getBlockNumber();
    if (latestBlock < this.cursor) return;

    const address = this.options.chainConfig.bountyHookAddress as Address;
    let fromBlock = this.cursor;

    // Walk the range in MAX_RANGE chunks so a one-shot 0..latest query never hits the RPC.
    while (fromBlock <= latestBlock) {
      const toBlock = fromBlock + BountyLogPoller.MAX_RANGE > latestBlock
        ? latestBlock
        : fromBlock + BountyLogPoller.MAX_RANGE;

      const logs = (await this.client.getContractEvents({
        address,
        abi: bountyHookAbi,
        fromBlock,
        toBlock
      })) as unknown as DecodedLog[];

      for (const log of logs) {
        const id = `${log.transactionHash}:${log.logIndex}`;
        if (this.seenLogs.has(id)) continue;
        this.seenLogs.add(id);
        await this.options.processor.process(this.toBountyEvent(log));
      }

      this.cursor = toBlock + 1n;
      this.writeCheckpoint(this.cursor);
      fromBlock = this.cursor;
    }
  }

  private toBountyEvent(log: DecodedLog): BountyEvent {
    const args = log.args;
    if (log.eventName === "BountyOpened") {
      return {
        type: "BountyOpened",
        windowId: String(args.windowId),
        poolId: args.poolId as `0x${string}`,
        bountyToken: args.bountyToken as `0x${string}`,
        quoteToken: args.quoteToken as `0x${string}`,
        startBlock: BigInt(String(args.startBlock)),
        endBlock: BigInt(String(args.endBlock)),
        bountyAmount: BigInt(String(args.bountyAmount))
      };
    }
    if (log.eventName === "BountyFunded") {
      return {
        type: "BountyFunded",
        windowId: String(args.windowId),
        seller: args.seller as `0x${string}`,
        bountyAmount: BigInt(String(args.bountyAmount)),
        sellAmount: BigInt(String(args.sellAmount)),
        bountyBps: Number(args.bountyBps ?? 500)
      };
    }
    if (log.eventName === "BountyBuyRecorded") {
      return {
        type: "BountyBuyRecorded",
        windowId: String(args.windowId),
        buyer: args.buyer as `0x${string}`,
        buyAmount: BigInt(String(args.buyAmount))
      };
    }
    if (log.eventName === "BountyPressureUpdated") {
      return {
        type: "BountyPressureUpdated",
        poolId: args.poolId as `0x${string}`,
        sellVolume: BigInt(String(args.sellVolume)),
        buyVolume: BigInt(String(args.buyVolume)),
        bountyBps: Number(args.bountyBps)
      };
    }
    if (log.eventName === "BountyClaimed") {
      return {
        type: "BountyClaimed",
        windowId: String(args.windowId),
        buyer: args.buyer as `0x${string}`,
        rewardAmount: BigInt(String(args.rewardAmount))
      };
    }
    return {
      type: "BountyWindowClosed",
      windowId: String(args.windowId),
      totalBounty: BigInt(String(args.totalBounty)),
      totalQualifyingBuy: BigInt(String(args.totalQualifyingBuy))
    };
  }

  private readCheckpoint(): bigint | undefined {
    if (!existsSync(this.checkpointFile)) return undefined;
    const value = readFileSync(this.checkpointFile, "utf8").trim();
    return value ? BigInt(value) : undefined;
  }

  private writeCheckpoint(blockNumber: bigint): void {
    mkdirSync(dirname(this.checkpointFile), { recursive: true });
    writeFileSync(this.checkpointFile, blockNumber.toString());
  }
}
