/**
 * Spawn `anvil` with the upstream Sepolia RPC from .env as the fork URL.
 * Run from another terminal:    npm run loadtest:anvil
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve } from "node:path";
import { CONFIG, SEPOLIA_CHAIN_ID } from "./config.js";

function findAnvil(): string {
  // 1. Honor an explicit override
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;

  // 2. Try the standard Foundry install location first, since this user has
  //    historically needed to add it to PATH manually.
  const candidates = [
    resolve(homedir(), ".foundry", "bin", platform() === "win32" ? "anvil.exe" : "anvil")
  ];
  for (const c of candidates) if (existsSync(c)) return c;

  // 3. Fall back to PATH
  return "anvil";
}

function main() {
  if (!CONFIG.upstreamRpc) {
    console.error("✗ Missing SEPOLIA_RPC_URL or RPC_HTTP_URL in .env. Cannot fork.");
    process.exit(1);
  }

  const port = new URL(CONFIG.anvilRpc).port || "8545";
  const args = [
    "--fork-url", CONFIG.upstreamRpc,
    "--chain-id", String(SEPOLIA_CHAIN_ID),
    "--port", port,
    "--accounts", "20",
    "--balance", "10000",
    "--block-time", "0"
  ];

  const bin = findAnvil();
  console.log(`▲ ${bin} ${args.map((a) => (a.startsWith("http") ? "<rpc>" : a)).join(" ")}\n`);

  const child = spawn(bin, args, { stdio: "inherit" });
  child.on("error", (err) => {
    console.error(`✗ failed to start anvil: ${err.message}`);
    console.error(`  Install Foundry from https://book.getfoundry.sh/getting-started/installation`);
    console.error(`  or set ANVIL_BIN=<path-to-anvil>`);
    process.exit(1);
  });
  child.on("exit", (code) => process.exit(code ?? 0));

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

main();
