import { formatTokenAmount, shortAddress, type BountyEvent } from "@bounty/shared";

export function telegramMessage(event: BountyEvent): string | undefined {
  if (event.type === "BountyOpened") {
    const amount = formatTokenAmount(event.bountyAmount);
    return `BOUNTY: ${amount} tokens up for grabs - ${event.endBlock - event.startBlock} blocks`;
  }

  if (event.type === "BountyFunded") {
    return `A whale just donated ${formatTokenAmount(event.bountyAmount)} to dip buyers at ${event.bountyBps ?? 500} bps. Seller: ${shortAddress(event.seller)}`;
  }

  if (event.type === "BountyPressureUpdated") {
    return `Sell pressure update: dynamic bounty is now ${event.bountyBps} bps. Greed meter is live.`;
  }

  if (event.type === "BountyClaimed") {
    return `Hunter ${shortAddress(event.buyer)} claimed ${formatTokenAmount(event.rewardAmount)} from The Bounty Hook.`;
  }

  return undefined;
}

export function tweetMessage(event: BountyEvent): string | undefined {
  if (event.type !== "BountyOpened") return undefined;
  const amount = formatTokenAmount(event.bountyAmount);
  return `Dumping this token literally pays other people to buy your dip immediately. Someone just donated ${amount} tokens to bounty hunters.`;
}
