import type { BountyEvent } from "@bounty/shared";

export const demoEvents: BountyEvent[] = [
  {
    type: "BountyOpened",
    windowId: "demo-1",
    poolId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    bountyToken: "0x2222222222222222222222222222222222222222",
    quoteToken: "0x3333333333333333333333333333333333333333",
    startBlock: 9_001n,
    endBlock: 9_051n,
    bountyAmount: 3_200_000_000_000_000_000n,
    bountyBps: 1_000
  },
  {
    type: "BountyPressureUpdated",
    poolId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    sellVolume: 64_000_000_000_000_000_000n,
    buyVolume: 20_000_000_000_000_000_000n,
    bountyBps: 1_000
  },
  {
    type: "BountyFunded",
    windowId: "demo-1",
    seller: "0x4444444444444444444444444444444444444444",
    bountyAmount: 3_200_000_000_000_000_000n,
    sellAmount: 64_000_000_000_000_000_000n,
    bountyBps: 1_000
  },
  {
    type: "BountyBuyRecorded",
    windowId: "demo-1",
    buyer: "0x5555555555555555555555555555555555555555",
    buyAmount: 12_000_000_000_000_000_000n
  },
  {
    type: "BountyBuyRecorded",
    windowId: "demo-1",
    buyer: "0x6666666666666666666666666666666666666666",
    buyAmount: 8_000_000_000_000_000_000n
  }
];
