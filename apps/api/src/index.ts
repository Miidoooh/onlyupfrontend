import { loadDotenv, parseRuntimeEnv, toChainConfig } from "@bounty/shared/env";
import { buildServer } from "./server.js";

loadDotenv();
const env = parseRuntimeEnv(process.env);
const app = await buildServer({
  chainConfig: toChainConfig(env),
  seedDemoData: env.API_SEED_DEMO_DATA,
  workerSecret: env.WORKER_INGEST_SECRET || undefined,
  tokenAddress: env.BOUNTY_TOKEN_ADDRESS,
  telegramMode: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID ? "live" : "dry-run",
  twitterMode: env.X_APP_KEY && env.X_APP_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET ? "live" : "dry-run"
});

await app.listen({ host: env.API_HOST, port: env.API_PORT });
