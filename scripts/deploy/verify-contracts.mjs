/**
 * Explicit, ordered Etherscan verification for the four real launch contracts.
 *
 * Verifies in this exact stack order:
 *   1. BountyLaunchToken              (the ERC-20 your investors hold)
 *   2. NetSellPressureBountyPolicy    (bps policy)
 *   3. BountyHookCore                 (event-emitting bounty engine)
 *   4. BountyV4Hook                   (afterSwap reporter)
 *
 * Anything else in the broadcast (function calls, libraries, the Vm interface,
 * etc.) is ignored.
 *
 * Usage:
 *   node scripts/deploy/verify-contracts.mjs [ScriptName.s.sol]
 *
 * Defaults to DeployFreshNativeEthLaunch.s.sol. Reads PRIVATE_KEY-less from
 * .env: only ETHERSCAN_API_KEY, RPC_HTTP_URL, and CHAIN_ID are consulted.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const contractsDir = path.join(repoRoot, "contracts");

function loadDotenv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") {
      process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}
loadDotenv(path.join(repoRoot, ".env"));

const chainId = process.env.CHAIN_ID ?? "11155111";
const apiKey = process.env.ETHERSCAN_API_KEY;
const scriptFile = process.argv[2] ?? "DeployFreshNativeEthLaunch.s.sol";

if (!apiKey) {
  console.error("✗ ETHERSCAN_API_KEY missing from .env. Verification needs it.");
  process.exit(1);
}

/** Locate forge even when not on PATH inside this shell (Windows). */
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
  console.error("✗ forge not found. Install Foundry or set PATH.");
  process.exit(127);
}
const forge = resolveForge();
const cast = forge.replace(/forge(\.exe)?$/i, (m) => (m.toLowerCase().endsWith(".exe") ? "cast.exe" : "cast"));

const broadcastPath = path.join(
  contractsDir,
  "broadcast",
  scriptFile,
  chainId,
  "run-latest.json"
);
if (!fs.existsSync(broadcastPath)) {
  console.error(`✗ no broadcast file at ${broadcastPath}\n  Deploy first: npm run deploy`);
  process.exit(1);
}
const broadcast = JSON.parse(fs.readFileSync(broadcastPath, "utf8"));

/**
 * Source path inside contracts/ for each contract we care about. forge needs
 * `<srcPath>:<ContractName>` to disambiguate.
 */
const SRC_PATH = {
  BountyLaunchToken:           "src/token/BountyLaunchToken.sol",
  NetSellPressureBountyPolicy: "src/policy/NetSellPressureBountyPolicy.sol",
  BountyHookCore:              "src/hook/BountyHookCore.sol",
  BountyV4Hook:                "src/hook/BountyV4Hook.sol",
};

/** Constructor signatures, in the same arg order Solidity expects. */
const CTOR_SIG = {
  BountyLaunchToken:           "constructor(string,string,address,address)",
  NetSellPressureBountyPolicy: "constructor(address,uint16,uint16,uint16,uint8)",
  BountyHookCore:              "constructor(address,address,address,uint64,uint256)",
  BountyV4Hook:                "constructor(address,address,address)",
};

/** Verify in this order. Token first, hook last. */
const ORDER = ["BountyLaunchToken", "NetSellPressureBountyPolicy", "BountyHookCore", "BountyV4Hook"];

/** Pluck the first deploy of each target contract from the broadcast. */
const deploys = {};
for (const tx of broadcast.transactions ?? []) {
  if (tx.transactionType !== "CREATE" && tx.transactionType !== "CREATE2") continue;
  const name = tx.contractName;
  if (!name || !ORDER.includes(name)) continue;
  if (!deploys[name]) {
    deploys[name] = {
      address: tx.contractAddress,
      args: tx.arguments ?? [],
    };
  }
}

const present = ORDER.filter((n) => deploys[n]);
const missing = ORDER.filter((n) => !deploys[n]);

if (present.length === 0) {
  console.error(`✗ broadcast contains none of: ${ORDER.join(", ")}`);
  console.error(`  ${path.relative(repoRoot, broadcastPath)} appears empty or unrelated.`);
  process.exit(1);
}
if (missing.length > 0) {
  console.log(`⚠ skipping (not in this broadcast): ${missing.join(", ")}`);
}

console.log(`▲ verifying ${present.length} contract(s) on chain ${chainId}\n  broadcast: ${path.relative(repoRoot, broadcastPath)}\n`);

/** Encode constructor args via `cast abi-encode`. Returns a 0x-prefixed hex string (no leading function selector). */
function encodeCtorArgs(name, args) {
  if (args.length === 0) return "";
  const r = spawnSync(cast, ["abi-encode", CTOR_SIG[name], ...args], { encoding: "utf8", shell: false });
  if (r.status !== 0) {
    console.error(`✗ cast abi-encode failed for ${name}: ${r.stderr || r.stdout}`);
    process.exit(r.status ?? 1);
  }
  return (r.stdout || "").trim();
}

/** Run forge verify-contract for a single target. */
function verifyOne(idx, name) {
  const { address, args } = deploys[name];
  const encoded = encodeCtorArgs(name, args);
  const target = `${SRC_PATH[name]}:${name}`;
  const forgeArgs = [
    "verify-contract",
    address,
    target,
    "--chain", chainId,
    "--etherscan-api-key", apiKey,
    "--watch",
    "--num-of-optimizations", "200"
  ];
  if (encoded && encoded !== "0x") {
    forgeArgs.push("--constructor-args", encoded);
  }
  console.log(`\n[${idx + 1}/${present.length}] ${name}`);
  console.log(`  address ${address}`);
  console.log(`  source  ${target}`);
  console.log(`  args    ${args.length === 0 ? "(none)" : JSON.stringify(args)}`);

  const r = spawnSync(forge, forgeArgs, { cwd: contractsDir, stdio: "inherit", shell: false });
  if (r.status !== 0) {
    // forge prints "Contract source code already verified" as exit 1 on some versions; treat as success.
    console.log(`  ⚠ forge exit ${r.status} — check the log above. If it says "already verified", you can ignore this.`);
    return r.status;
  }
  console.log(`  ✓ verified`);
  return 0;
}

let firstFailure = 0;
for (let i = 0; i < present.length; i++) {
  const status = verifyOne(i, present[i]);
  if (status !== 0 && firstFailure === 0) firstFailure = status;
}

console.log(firstFailure === 0 ? `\n✓ ${present.length} contract(s) verified.` : "\n⚠ verification finished with at least one warning/error above.");
process.exit(firstFailure);
