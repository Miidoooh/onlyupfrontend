/**
 * One-command load test that drives the website dashboard live.
 *
 * What it does (in order):
 *   1. Spawns `anvil` forked from Sepolia (background)
 *   2. Re-points worker/API at the fork RPC and resets WORKER_START_BLOCK
 *   3. Restarts API + worker (kills any old ones first)
 *   4. Runs scripts/loadtest/run.ts: 100 wallets, 200 rounds of buys+sells,
 *      mines past windows, claims rewards.
 *   5. Restores original .env when done (Ctrl-C is safe — it still restores).
 *
 * Run:    npx tsx scripts/loadtest-wired.ts
 *         OR  npm run loadtest:wired
 *
 * Open:   http://localhost:3000  (dashboard updates as events stream in)
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { homedir, platform } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const envPath = resolve(repoRoot, ".env");
const envBackupPath = resolve(repoRoot, ".env.before-loadtest");
const checkpointPath = resolve(repoRoot, "apps/worker/.checkpoint");

const ANVIL_RPC = "http://127.0.0.1:8545";
const ANVIL_PORT = 8545;

const c = (s: string, color: keyof typeof colors) => `${colors[color]}${s}${colors.reset}`;
const colors = {
  reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", gray: "\x1b[90m"
};

function log(label: string, msg = "") { console.log(`${c("▲", "green")} ${c(label.padEnd(28), "cyan")} ${msg}`); }
function warn(label: string, msg = "") { console.log(`${c("⚠", "yellow")} ${c(label.padEnd(28), "cyan")} ${msg}`); }
function fail(label: string, msg = "") { console.log(`${c("✗", "red")} ${c(label.padEnd(28), "cyan")} ${msg}`); }

function readDotenv() {
  return readFileSync(envPath, "utf8");
}
function writeDotenv(content: string) {
  writeFileSync(envPath, content);
}

function patchEnv(content: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, `${key}=${value}`);
  return `${content.replace(/\s*$/, "")}\n${key}=${value}\n`;
}

function findAnvil(): string {
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;
  const candidates = [
    resolve(homedir(), ".foundry", "bin", platform() === "win32" ? "anvil.exe" : "anvil"),
    "anvil"
  ];
  for (const x of candidates) {
    const probe = spawnSync(x, ["--version"], { stdio: "ignore", shell: false });
    if (probe.status === 0) return x;
  }
  throw new Error("anvil not found. Set ANVIL_BIN or install Foundry.");
}

async function killByCmd(matcher: RegExp) {
  if (platform() !== "win32") return;
  const list = spawnSync("powershell", [
    "-NoProfile", "-Command",
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match '${matcher.source}' -and $_.CommandLine -notmatch 'cursor.resources.app' } | Select-Object -ExpandProperty ProcessId`
  ], { encoding: "utf8" });
  if (!list.stdout) return;
  for (const pid of list.stdout.split(/\r?\n/).filter(Boolean)) {
    spawnSync("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]);
  }
}

async function freePort(port: number) {
  if (platform() !== "win32") return;
  spawnSync("powershell", [
    "-NoProfile", "-Command",
    `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
  ]);
}

async function waitForRpc(rpc: string, timeoutMs = 30_000) {
  const client = createPublicClient({ transport: http(rpc) });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const block = await client.getBlockNumber();
      return Number(block);
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`rpc ${rpc} not responding within ${timeoutMs}ms`);
}

let anvil: ChildProcess | undefined;
let worker: ChildProcess | undefined;
let api: ChildProcess | undefined;

function cleanup() {
  console.log(`\n${c("▲", "green")} cleanup...`);
  for (const p of [anvil, worker, api]) {
    try { p?.kill("SIGTERM"); } catch { /* ignore */ }
  }
  // restore .env
  if (existsSync(envBackupPath)) {
    copyFileSync(envBackupPath, envPath);
    unlinkSync(envBackupPath);
    console.log(`  ✓ .env restored to ${envPath}`);
  }
  if (existsSync(checkpointPath)) {
    try { unlinkSync(checkpointPath); console.log("  ✓ worker checkpoint cleared"); } catch { /* ignore */ }
  }
}

process.on("SIGINT",  () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

async function main() {
  console.log(c("\n  ▲▲▲ Only Up — wired load test ▲▲▲\n", "green"));

  // 1. Backup .env, then patch it for fork RPC
  const original = readDotenv();
  copyFileSync(envPath, envBackupPath);
  log(".env backup", envBackupPath);

  // 2. Stop any existing api/worker; free port 8545 (in case prior anvil left over)
  await killByCmd(/programming.Up.*apps.(api|worker)/);
  await killByCmd(/anvil/);
  await freePort(8545);
  await freePort(4311);

  if (existsSync(checkpointPath)) { unlinkSync(checkpointPath); log("checkpoint cleared"); }

  // 3. Spawn anvil
  const anvilBin = findAnvil();
  const upstreamRpc = process.env.RPC_HTTP_URL || (original.match(/^RPC_HTTP_URL=(.*)$/m)?.[1] ?? "");
  if (!upstreamRpc) throw new Error("RPC_HTTP_URL not in .env");

  log("starting anvil", `${anvilBin} --fork-url <sepolia> --chain-id 11155111 --port ${ANVIL_PORT}`);
  const anvilLog = resolve(repoRoot, "anvil.log");
  const anvilLogStream = (await import("node:fs")).createWriteStream(anvilLog, { flags: "w" });
  anvil = spawn(anvilBin, [
    "--fork-url",  upstreamRpc.replace(/^wss:\/\//, "https://"),
    "--chain-id",  "11155111",
    "--port",      String(ANVIL_PORT),
    "--accounts",  "20",
    "--balance",   "10000",
    "--block-time", "0"
  ], { stdio: ["ignore", "pipe", "pipe"], detached: false });
  anvil.stdout?.pipe(anvilLogStream);
  anvil.stderr?.pipe(anvilLogStream);
  anvil.on("error", (err) => fail("anvil error", err.message));
  log("anvil log", anvilLog);

  const forkBlock = await waitForRpc(ANVIL_RPC, 60_000);
  log("anvil ready", `block ${forkBlock}`);

  // 4. Patch .env: point RPC at fork, set WORKER_START_BLOCK, ensure no stale POOL_ID issue
  let patched = original;
  patched = patchEnv(patched, "RPC_HTTP_URL", ANVIL_RPC);
  patched = patchEnv(patched, "RPC_WS_URL",   "");
  patched = patchEnv(patched, "WORKER_START_BLOCK", String(Math.max(0, forkBlock - 5)));
  // worker poll interval shorter so dashboard updates fast
  patched = patchEnv(patched, "WORKER_POLL_INTERVAL_MS", "2000");
  writeDotenv(patched);
  log(".env patched", `RPC_HTTP_URL=${ANVIL_RPC}  startBlock=${forkBlock - 5}  poll=2000ms`);

  // 5. Boot API + worker against the fork
  const npmBin = platform() === "win32" ? "npm.cmd" : "npm";
  log("starting api", "npm run dev:api");
  api = spawn(npmBin, ["run", "dev:api"], { cwd: repoRoot, stdio: "ignore", shell: false });

  log("starting worker", "npm run dev:worker");
  worker = spawn(npmBin, ["run", "dev:worker"], { cwd: repoRoot, stdio: "ignore", shell: false });

  // give them time to boot + connect
  await new Promise((r) => setTimeout(r, 6000));
  log("services up", "api on :4311, worker polling " + ANVIL_RPC);

  // 6. Run the actual load test (this prints its own timeline)
  console.log(c("\n  ▲ running load test (100 wallets × 200 rounds)\n", "green"));
  console.log(c("  open http://localhost:3000 in your browser to watch live\n", "gray"));

  const loadtest = spawnSync(npmBin, ["run", "loadtest"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ANVIL_RPC_URL: ANVIL_RPC }
  });

  // 7. Keep services running for a bit so the dashboard can ingest the tail of events
  log("waiting 12s", "let worker drain remaining events");
  await new Promise((r) => setTimeout(r, 12000));

  if (loadtest.status !== 0) {
    fail("loadtest exit", String(loadtest.status));
  } else {
    log("loadtest done", "events ingested by API and visible at http://localhost:3000");
  }

  // 8. Cleanup happens via signal handlers / explicit exit
  console.log(`\n${c("▲", "green")} press Ctrl-C to stop services and restore .env`);
  console.log(`${c("  ", "gray")}or just close this terminal — the .env backup at ${envBackupPath} stays intact.`);

  // Hold the process open until user kills it
  await new Promise(() => { /* run forever */ });
}

main().catch((err) => {
  console.error(c(`\n✗ fatal: ${err instanceof Error ? err.stack : err}\n`, "red"));
  cleanup();
  process.exit(1);
});
