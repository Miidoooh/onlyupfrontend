import { BountyEventProcessor, type ApiSink } from "./indexer.js";
import { DryRunNotifier } from "./notifiers.js";

const events: unknown[] = [
  {
    type: "BountyOpened",
    windowId: "smoke-1",
    poolId: "0x1111111111111111111111111111111111111111111111111111111111111111",
    bountyToken: "0x2222222222222222222222222222222222222222",
    quoteToken: "0x3333333333333333333333333333333333333333",
    startBlock: "100",
    endBlock: "150",
    bountyAmount: "3200000000000000000"
  }
];

const sink: ApiSink = {
  async push() {
    return undefined;
  }
};

const telegram = new DryRunNotifier();
const twitter = new DryRunNotifier();
const processor = new BountyEventProcessor(sink, telegram, twitter);

for (const event of events) {
  await processor.process(event);
}

console.log(JSON.stringify({ telegram: telegram.sent.length, twitter: twitter.sent.length }));
