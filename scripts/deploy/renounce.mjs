/**
 * Wrapper for the RenounceOwnership forge script.
 *
 *   npm run renounce                    # interactive confirmation
 *   npm run renounce -- --yes           # skip confirmation (CI / scripted)
 *   npm run renounce -- --no-token      # skip the token leg
 *   npm run renounce -- --no-core       # skip BountyHookCore
 *   npm run renounce -- --no-hook       # skip BountyV4Hook
 *   npm run renounce -- --no-policy     # skip NetSellPressureBountyPolicy
 *   npm run renounce -- --dry-run       # forge --dry-run only (no broadcast)
 *
 * What this does:
 *   - Single-step contracts (BountyHookCore, BountyV4Hook,
 *     NetSellPressureBountyPolicy) → transferOwnership(0x…dEaD).
 *   - BountyLaunchToken (2-step Ownable, no renounceOwnership) → deploys a
 *     single-purpose `TokenOwnershipSink` and walks the 2-step handoff so
 *     the token's `owner` slot ends up at a contract with zero admin
 *     surface. Operationally equivalent to renouncement.
 *
 * IRREVERSIBLE. Once broadcast, you cannot:
 *   - tighten/relax launch limits
 *   - whitelist a new router or bridge
 *   - flag a new AMM pair
 *   - swap out the v4 hook
 *   - configure a second pool route
 *
 * Holder funds are NOT at risk — none of those owner powers can move
 * balances, mint, burn, or pull liquidity. See the script's NatSpec for
 * the full audit. Renouncing only locks in current configuration.
 */

import { spawnSync } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const contractsDir = path.join(repoRoot, "contracts");
const envFile = path.join(repoRoot, ".env");

const COLOR = process.stdout.isTTY ? {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", bold: "\x1b[1m", dim: "\x1b[2m"
} : { reset: "", red: "", green: "", yellow: "", cyan: "", bold: "", dim: "" };
const c = (s, ...keys) => `${keys.map((k) => COLOR[k]).join("")}${s}${COLOR.reset}`;

function resolveForge() {
  const candidates = [];
  const home = os.homedir();
  if (process.platform === "win32") {
    candidates.push(path.join(home, ".foundry", "bin", "forge.exe"));
    candidates.push("forge.exe");
  } else {
    candidates.push(path.join(home, ".foundry", "bin", "forge"));
  }
  candidates.push("forge");
  for (const cand of candidates) {
    const probe = spawnSync(cand, ["--version"], { stdio: "ignore", shell: false });
    if (probe.status === 0) return cand;
  }
  console.error(c("✗ forge not found. Install Foundry: https://book.getfoundry.sh/getting-started/installation", "red"));
  process.exit(127);
}

function loadDotenv() {
  if (!fs.existsSync(envFile)) return {};
  const map = {};
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) map[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return map;
}

function parseArgs(argv) {
  const out = { yes: false, dryRun: false, skip: { token: false, core: false, hook: false, policy: false } };
  for (const a of argv.slice(2)) {
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-token") out.skip.token = true;
    else if (a === "--no-core") out.skip.core = true;
    else if (a === "--no-hook") out.skip.hook = true;
    else if (a === "--no-policy") out.skip.policy = true;
  }
  return out;
}

function isAddress(s) {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s.trim());
}

function pick(key, fileEnv) {
  for (const v of [process.env[key], fileEnv[key]]) {
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

const cli = parseArgs(process.argv);
const fileEnv = loadDotenv();

const resolved = {
  PRIVATE_KEY:          pick("PRIVATE_KEY", fileEnv),
  RPC_HTTP_URL:         pick("RPC_HTTP_URL", fileEnv),
  CHAIN_ID:             pick("CHAIN_ID", fileEnv),
  BOUNTY_TOKEN_ADDRESS: pick("BOUNTY_TOKEN_ADDRESS", fileEnv),
  BOUNTY_HOOK_ADDRESS:  pick("BOUNTY_HOOK_ADDRESS", fileEnv),
  REAL_V4_HOOK_ADDRESS: pick("REAL_V4_HOOK_ADDRESS", fileEnv),
  POLICY_ADDRESS:       pick("POLICY_ADDRESS", fileEnv)
};

const required = ["PRIVATE_KEY", "RPC_HTTP_URL", "BOUNTY_TOKEN_ADDRESS", "BOUNTY_HOOK_ADDRESS", "REAL_V4_HOOK_ADDRESS", "POLICY_ADDRESS"];
const missing = required.filter((k) => !resolved[k]);
if (missing.length > 0) {
  console.error(c(`✗ missing required values: ${missing.join(", ")}`, "red"));
  console.error(c("  set them in .env or your shell.", "dim"));
  process.exit(1);
}

const addressKeys = ["BOUNTY_TOKEN_ADDRESS", "BOUNTY_HOOK_ADDRESS", "REAL_V4_HOOK_ADDRESS", "POLICY_ADDRESS"];
const badAddrs = addressKeys.filter((k) => !isAddress(resolved[k]));
if (badAddrs.length > 0) {
  console.error(c(`✗ not valid 0x-prefixed 20-byte addresses: ${badAddrs.join(", ")}`, "red"));
  process.exit(1);
}

const rpcLooksLocal = /127\.0\.0\.1|localhost|anvil/i.test(resolved.RPC_HTTP_URL);

console.log("");
console.log(c("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "bold"));
console.log(c("  RENOUNCE OWNERSHIP — IRREVERSIBLE", "bold", "yellow"));
console.log(c("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "bold"));
console.log("");
console.log(`  ${c("RPC", "dim")}             ${resolved.RPC_HTTP_URL}${rpcLooksLocal ? c("   ⚠ LOCAL — anvil/fork", "yellow") : ""}`);
console.log(`  ${c("Chain ID", "dim")}        ${resolved.CHAIN_ID || "(unset)"}`);
console.log(`  ${c("Mode", "dim")}            ${cli.dryRun ? c("dry-run (no broadcast)", "cyan") : c("BROADCAST", "red", "bold")}`);
console.log("");
console.log(c("  Targets:", "bold"));
const legs = [
  { key: "policy", label: "NetSellPressureBountyPolicy", addr: resolved.POLICY_ADDRESS,       method: "transferOwnership(0x…dEaD)" },
  { key: "hook",   label: "BountyV4Hook              ", addr: resolved.REAL_V4_HOOK_ADDRESS, method: "transferOwnership(0x…dEaD)" },
  { key: "core",   label: "BountyHookCore            ", addr: resolved.BOUNTY_HOOK_ADDRESS,  method: "transferOwnership(0x…dEaD)" },
  { key: "token",  label: "BountyLaunchToken         ", addr: resolved.BOUNTY_TOKEN_ADDRESS, method: "deploy TokenOwnershipSink → transfer + accept" }
];
for (const leg of legs) {
  const skipped = cli.skip[leg.key];
  const tag = skipped ? c("[SKIP]", "dim") : c("[RENOUNCE]", "red", "bold");
  console.log(`    ${tag} ${leg.label}  ${c(leg.addr, "cyan")}`);
  if (!skipped) console.log(`               ${c("→ " + leg.method, "dim")}`);
}
console.log("");
console.log(c("  After this runs, you can NEVER:", "yellow"));
console.log(c("    • change anti-bot limits or exempt new addresses", "dim"));
console.log(c("    • flag a new AMM pair on the token", "dim"));
console.log(c("    • swap out the v4 hook (core.setReporter / policy.setHook)", "dim"));
console.log(c("    • configure a new pool route", "dim"));
console.log("");
console.log(c("  Holder funds remain safe — none of those powers move balances,", "green"));
console.log(c("  mint/burn, change supply, or pull liquidity.", "green"));
console.log("");

if (!cli.yes && !cli.dryRun) {
  const ans = await ask(c("  type EXACTLY \"renounce\" to proceed, anything else aborts: ", "bold"));
  if (ans.trim() !== "renounce") {
    console.log(c("\n✗ aborted. nothing broadcast.", "red"));
    process.exit(1);
  }
}

const childEnv = { ...process.env };
for (const [k, v] of Object.entries(resolved)) {
  if (v) childEnv[k] = v;
}
if (childEnv.PRIVATE_KEY && /^[0-9a-fA-F]{64}$/.test(childEnv.PRIVATE_KEY)) {
  childEnv.PRIVATE_KEY = "0x" + childEnv.PRIVATE_KEY;
}
if (cli.skip.token)  childEnv.RENOUNCE_TOKEN  = "false";
if (cli.skip.core)   childEnv.RENOUNCE_CORE   = "false";
if (cli.skip.hook)   childEnv.RENOUNCE_HOOK   = "false";
if (cli.skip.policy) childEnv.RENOUNCE_POLICY = "false";

const forge = resolveForge();
const args = [
  "script",
  "script/RenounceOwnership.s.sol:RenounceOwnership",
  "--rpc-url", childEnv.RPC_HTTP_URL,
  "-vvvv"
];
if (!cli.dryRun) args.push("--broadcast");

console.log(c(`\n▲ forge ${args.join(" ")}\n`, "cyan"));
const r = spawnSync(forge, args, { stdio: "inherit", cwd: contractsDir, env: childEnv, shell: false });
if (r.status === 0) {
  console.log("");
  if (cli.dryRun) {
    console.log(c("✓ dry run complete. re-run without --dry-run to broadcast.", "green"));
  } else {
    console.log(c("✓ renounce broadcast.", "green"));
    console.log(c("  verify on a block explorer that owner() is now 0x…dEaD (or the sink contract for the token).", "dim"));
  }
}
process.exit(r.status ?? 1);
