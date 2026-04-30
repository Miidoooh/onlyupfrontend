import { bountyEventSchema, type BountyEvent } from "@bounty/shared";
import { telegramMessage, tweetMessage } from "./messages.js";
import type { Notifier } from "./notifiers.js";

export interface ApiSink {
  push(event: BountyEvent): Promise<void>;
}

export class HttpApiSink implements ApiSink {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly workerSecret?: string
  ) {}

  async push(event: BountyEvent): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.workerSecret ? { "x-worker-secret": this.workerSecret } : {})
      },
      body: JSON.stringify(event, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
    });

    if (!response.ok) {
      throw new Error(`API rejected event with ${response.status}`);
    }
  }
}

export class BountyEventProcessor {
  constructor(
    private readonly apiSink: ApiSink,
    private readonly telegram: Notifier,
    private readonly twitter: Notifier
  ) {}

  async process(rawEvent: unknown): Promise<void> {
    const event = bountyEventSchema.parse(rawEvent);
    await this.apiSink.push(event);

    const tg = telegramMessage(event);
    if (tg) {
      await this.telegram.send(tg, this.dedupeKey("tg", event));
    }

    const x = tweetMessage(event);
    if (x) {
      await this.twitter.send(x, this.dedupeKey("x", event));
    }
  }

  private dedupeKey(prefix: string, event: BountyEvent): string {
    if ("windowId" in event) return `${prefix}:${event.type}:${event.windowId}`;
    return `${prefix}:${event.type}:${event.poolId}:${event.bountyBps}`;
  }
}
