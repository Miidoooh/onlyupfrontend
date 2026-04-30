import { describe, expect, it } from "vitest";
import { BountyEventProcessor, type ApiSink } from "./indexer.js";
import { DryRunNotifier } from "./notifiers.js";

describe("BountyEventProcessor", () => {
  it("validates events and notifies Telegram and X for bounty openings", async () => {
    const pushed: unknown[] = [];
    const sink: ApiSink = { push: async (event) => void pushed.push(event) };
    const telegram = new DryRunNotifier();
    const twitter = new DryRunNotifier();
    const processor = new BountyEventProcessor(sink, telegram, twitter);

    await processor.process({
      type: "BountyOpened",
      windowId: "test-1",
      poolId: "0x1111111111111111111111111111111111111111111111111111111111111111",
      bountyToken: "0x2222222222222222222222222222222222222222",
      quoteToken: "0x3333333333333333333333333333333333333333",
      startBlock: "1",
      endBlock: "51",
      bountyAmount: "3200000000000000000"
    });

    expect(pushed).toHaveLength(1);
    expect(telegram.sent).toHaveLength(1);
    expect(twitter.sent).toHaveLength(1);
  });
});
