import pino from "pino";
import { loadDotenv, parseRuntimeEnv, toChainConfig } from "@bounty/shared/env";
import { BountyEventProcessor, HttpApiSink } from "./indexer.js";
import { DryRunNotifier, TelegramNotifier, XNotifier } from "./notifiers.js";
import { BountyLogPoller } from "./poller.js";

loadDotenv();
const logger = pino();
const env = parseRuntimeEnv(process.env);
const apiUrl = process.env.API_URL ?? `http://localhost:${env.API_PORT}`;

const telegram =
  env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
    ? new TelegramNotifier(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID)
    : new DryRunNotifier();

const twitter =
  env.X_APP_KEY && env.X_APP_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET
    ? new XNotifier(env.X_APP_KEY, env.X_APP_SECRET, env.X_ACCESS_TOKEN, env.X_ACCESS_SECRET)
    : new DryRunNotifier();

const processor = new BountyEventProcessor(new HttpApiSink(apiUrl, env.WORKER_INGEST_SECRET || undefined), telegram, twitter);
const poller = new BountyLogPoller({
  chainConfig: toChainConfig(env),
  processor,
  startBlock: env.WORKER_START_BLOCK,
  intervalMs: env.WORKER_POLL_INTERVAL_MS,
  checkpointFile: env.WORKER_CHECKPOINT_FILE
});

logger.info(
  {
    apiUrl,
    startBlock: env.WORKER_START_BLOCK.toString(),
    telegramMode: telegram instanceof DryRunNotifier ? "dry-run" : "live",
    twitterMode: twitter instanceof DryRunNotifier ? "dry-run" : "live"
  },
  "bounty worker ready"
);

poller.start();

export { poller, processor };
