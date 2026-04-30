/**
 * One-command fresh launch: load .env, build + test contracts, broadcast the
 * fresh deploy script, then rewrite .env with the new addresses.
 *
 * Usage: node scripts/deploy/run-deploy.mjs [ScriptName.s.sol]
 *
 * Defaults to DeployFreshNativeEthLaunch.s.sol.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

/** Locate `forge` even when not on PATH inside this shell. */
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
  for (const c of candidates) {
    const probe = spawnSync(c, ["--version"], { stdio: "ignore", shell: false });
    if (probe.status === 0) return c;
  }
  console.error("✗ forge not found. Install Foundry: https://book.getfoundry.sh/getting-started/installation");
  process.exit(127);
}

function loadDotenv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const k = m[1];
    const v = (m[2] ?? "").replace(/^["']|["']$/g, "");
    if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
  }
}

loadDotenv(path.join(repoRoot, ".env"));

const required = ["RPC_HTTP_URL", "PRIVATE_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`✗ missing in .env: ${missing.join(", ")}`);
  process.exit(1);
}

// forge's vm.envUint requires `0x...`. If the key is bare 64-char hex, prepend `0x`.
{
  const k = process.env.PRIVATE_KEY.trim();
  if (/^[0-9a-fA-F]{64}$/.test(k)) process.env.PRIVATE_KEY = `0x${k}`;
}

const scriptName = process.argv[2] ?? "DeployFreshNativeEthLaunch.s.sol";
const contractName = scriptName.replace(/\.s\.sol$/, "");

function step(label, cmd, args, opts = {}) {
  console.log(`\n▲ ${label}\n  $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, env: process.env, ...opts });
  if (r.status !== 0) {
    console.error(`✗ step failed: ${label} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}

const forge = resolveForge();
const contractsDir = path.join(repoRoot, "contracts");

step("forge build", forge, ["build"], { cwd: contractsDir });
step("forge test",  forge, ["test"],  { cwd: contractsDir });

const verify = process.argv.includes("--verify");
const forgeArgs = [
  "script",
  `script/${scriptName}:${contractName}`,
  "--rpc-url",
  process.env.RPC_HTTP_URL,
  "--broadcast",
  "-vvvv"
];

// Note: we deliberately do NOT pass --verify to `forge script`. Foundry verifies
// every contract in the broadcast in deployment order, but it can also drag in
// dependencies and gives us no control if one fails mid-stack. Instead we run
// our own ordered verifier below — token first, hook last, real contracts only.
step(`forge script (broadcast)`, forge, forgeArgs, { cwd: contractsDir });

step(
  "sync .env from broadcast",
  process.execPath,
  [path.join("scripts", "deploy", "sync-env-from-broadcast.mjs"), scriptName],
  { cwd: repoRoot }
);

if (verify) {
  if (!process.env.ETHERSCAN_API_KEY) {
    console.error("\n✗ --verify requested but ETHERSCAN_API_KEY missing in .env");
    process.exit(1);
  }
  step(
    "verify contracts (token → policy → core → hook)",
    process.execPath,
    [path.join("scripts", "deploy", "verify-contracts.mjs"), scriptName],
    { cwd: repoRoot }
  );
}

console.log("\n✓ deploy complete.");
