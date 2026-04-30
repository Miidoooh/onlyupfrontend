import { Telegraf } from "telegraf";
import { TwitterApi } from "twitter-api-v2";

export interface Notifier {
  send(message: string, dedupeKey: string): Promise<void>;
}

export class DryRunNotifier implements Notifier {
  public readonly sent: Array<{ message: string; dedupeKey: string }> = [];

  async send(message: string, dedupeKey: string): Promise<void> {
    this.sent.push({ message, dedupeKey });
  }
}

export class TelegramNotifier implements Notifier {
  private readonly bot: Telegraf;
  private readonly chatId: string;
  private readonly sent = new Set<string>();

  constructor(token: string, chatId: string) {
    this.bot = new Telegraf(token);
    this.chatId = chatId;
  }

  async send(message: string, dedupeKey: string): Promise<void> {
    if (this.sent.has(dedupeKey)) return;
    await this.bot.telegram.sendMessage(this.chatId, message);
    this.sent.add(dedupeKey);
  }
}

export class XNotifier implements Notifier {
  private readonly client: TwitterApi;
  private readonly sent = new Set<string>();

  constructor(appKey: string, appSecret: string, accessToken: string, accessSecret: string) {
    this.client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  }

  async send(message: string, dedupeKey: string): Promise<void> {
    if (this.sent.has(dedupeKey)) return;
    await this.client.v2.tweet(message);
    this.sent.add(dedupeKey);
  }
}
