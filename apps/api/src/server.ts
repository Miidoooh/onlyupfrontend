import cors from "@fastify/cors";
import Fastify from "fastify";
import { bountyEventSchema, type ChainConfig, type HexAddress } from "@bounty/shared";
import { poolIdOrZero } from "@bounty/shared/env";
import { demoEvents } from "./fixtures.js";
import { jsonBigInt } from "./serialization.js";
import { BountyReadStore } from "./store.js";

export interface ServerOptions {
  chainConfig: ChainConfig;
  seedDemoData?: boolean;
  workerSecret?: string;
  tokenAddress?: HexAddress;
  telegramMode?: "dry-run" | "live";
  twitterMode?: "dry-run" | "live";
}

export async function buildServer(options: ServerOptions) {
  const app = Fastify({ logger: true });
  const store = new BountyReadStore();

  if (options.seedDemoData) {
    demoEvents.forEach((event) => store.apply(event));
  }

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "bounty-api" }));

  app.get("/config", async () =>
    jsonBigInt({
      chain: options.chainConfig,
      contract: {
        bountyHook: options.chainConfig.bountyHookAddress,
        poolId: poolIdOrZero(options.chainConfig.poolId)
      }
    })
  );

  app.get("/bounties/active", async () => jsonBigInt(store.getActiveWindows()));
  app.get("/bounties", async () => jsonBigInt(store.getWindows()));
  app.get<{ Params: { id: string } }>("/bounties/:id", async (request, reply) => {
    const window = store.getWindow(request.params.id);
    if (!window) return reply.code(404).send({ error: "bounty window not found" });
    return jsonBigInt(window);
  });
  app.get<{ Params: { id: string } }>("/bounties/:id/participants", async (request) =>
    jsonBigInt(store.getParticipants(request.params.id))
  );
  app.get("/stats", async () => jsonBigInt(store.getStats()));
  app.get("/leaderboard", async () => jsonBigInt(store.getLeaderboard()));
  app.get<{ Querystring: { limit?: string } }>("/events", async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : 30;
    return jsonBigInt(store.getEvents(Number.isFinite(limit) ? limit : 30));
  });
  app.get("/pressure", async () => jsonBigInt(store.getPressure()));
  app.get<{ Params: { poolId: `0x${string}` } }>("/pressure/:poolId", async (request) =>
    jsonBigInt(store.getPressure(request.params.poolId))
  );
  app.get("/launch", async () =>
    jsonBigInt(
      store.getLaunchInfo({
        name: "Only Up",
        symbol: "UP",
        totalSupply: 1_000_000_000_000_000_000_000_000_000n,
        maxTxAmount: 10_000_000_000_000_000_000_000_000n,
        maxWalletAmount: 10_000_000_000_000_000_000_000_000n,
        hookAddress: options.chainConfig.bountyHookAddress,
        tokenAddress: options.tokenAddress,
        poolId: poolIdOrZero(options.chainConfig.poolId)
      })
    )
  );
  app.get("/bot/health", async () =>
    store.getBotHealth({
      apiIngestProtected: Boolean(options.workerSecret),
      telegramMode: options.telegramMode ?? "dry-run",
      twitterMode: options.twitterMode ?? "dry-run"
    })
  );

  app.post<{ Body: unknown }>("/events", async (request, reply) => {
    if (options.workerSecret && request.headers["x-worker-secret"] !== options.workerSecret) {
      return reply.code(401).send({ error: "invalid worker secret" });
    }

    const event = bountyEventSchema.parse(request.body);
    store.apply(event);
    return reply.code(202).send({ accepted: true });
  });

  return app;
}
