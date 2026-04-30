import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { bytes32Schema, hexAddressSchema } from "./events.js";
import type { ChainConfig } from "./types.js";

/**
 * Find the monorepo root by walking up looking for a package.json that
 * declares a "workspaces" field. Used to resolve env / checkpoint paths
 * against a stable anchor regardless of npm-workspace cwd.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    const pkg = resolve(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const data = JSON.parse(readFileSync(pkg, "utf8")) as { workspaces?: unknown };
        if (data.workspaces) return dir;
      } catch {
        // ignore unreadable package.json
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

/**
 * Read a `.env` file (default: at the repo root) and merge missing keys into
 * `process.env`. Existing process env wins, so this is safe to call after
 * shell-level overrides. Lightweight, no dependency on `dotenv`.
 */
export function loadDotenv(envPath?: string): void {
  const file = envPath ?? resolve(findRepoRoot(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    const raw = match[2] ?? "";
    const value = raw.replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

const booleanEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}, z.boolean());

export const runtimeEnvSchema = z.object({
  CHAIN_ID: z.coerce.number().int().positive(),
  RPC_HTTP_URL: z.string().url(),
  RPC_WS_URL: z.string().url().optional().or(z.literal("")),
  BOUNTY_HOOK_ADDRESS: hexAddressSchema,
  /** ERC-20 token — required so API/web never confuse core hook address with token CA */
  BOUNTY_TOKEN_ADDRESS: hexAddressSchema,
  /** Optional: set after the v4 pool is created. Empty string is treated as "not configured". */
  POOL_ID: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), bytes32Schema.optional()),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4311),
  API_SEED_DEMO_DATA: booleanEnv.default(true),
  WORKER_INGEST_SECRET: z.string().optional().or(z.literal("")),
  WORKER_START_BLOCK: z.coerce.bigint().default(0n),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(12_000),
  WORKER_CHECKPOINT_FILE: z.string().default("apps/worker/.checkpoint"),
  TELEGRAM_BOT_TOKEN: z.string().optional().or(z.literal("")),
  TELEGRAM_CHAT_ID: z.string().optional().or(z.literal("")),
  X_APP_KEY: z.string().optional().or(z.literal("")),
  X_APP_SECRET: z.string().optional().or(z.literal("")),
  X_ACCESS_TOKEN: z.string().optional().or(z.literal("")),
  X_ACCESS_SECRET: z.string().optional().or(z.literal(""))
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

export function parseRuntimeEnv(input: NodeJS.ProcessEnv): RuntimeEnv {
  return runtimeEnvSchema.parse(input);
}

export function toChainConfig(env: RuntimeEnv): ChainConfig {
  return {
    chainId: env.CHAIN_ID,
    rpcHttpUrl: env.RPC_HTTP_URL,
    rpcWsUrl: env.RPC_WS_URL || undefined,
    bountyHookAddress: env.BOUNTY_HOOK_ADDRESS,
    poolId: env.POOL_ID
  };
}

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

/** Convenience for places that always want a 32-byte hex (e.g. JSON `/launch`). */
export function poolIdOrZero(value: string | undefined): `0x${string}` {
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as `0x${string}`) : ZERO_BYTES32;
}
