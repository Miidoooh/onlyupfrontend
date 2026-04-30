/**
 * Probe Sepolia state to find where the LP'd UP actually sits.
 * Reads token.balanceOf for: PoolManager, PositionManager, Permit2,
 * UniversalRouter, the deployer, and the BountyV4Hook.
 */
import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const env = fs.readFileSync(path.join(repoRoot, ".env"), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN = get("BOUNTY_TOKEN_ADDRESS");
const HOOK  = get("REAL_V4_HOOK_ADDRESS");
const CORE  = get("BOUNTY_HOOK_ADDRESS");
const PM    = get("V4_POOL_MANAGER") || "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const POSM  = "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const UR    = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
const OP    = "0xFc2B23a0024cF750E6dAFCD0b3E6F617C7172ab8";

const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

const targets = {
  "Operator (deployer)": OP,
  "PoolManager":         PM,
  "PositionManager":     POSM,
  "Permit2":             PERMIT2,
  "UniversalRouter":     UR,
  "BountyHookCore":      CORE,
  "BountyV4Hook":        HOOK,
};

console.log(`token: ${TOKEN}\n`);
for (const [label, addr] of Object.entries(targets)) {
  const bal = await client.readContract({ address: TOKEN, abi, functionName: "balanceOf", args: [addr] });
  const fmt = Number(formatUnits(bal, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  console.log(`  ${label.padEnd(22)} ${addr}  ${fmt} UP`);
}
