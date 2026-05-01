import { createPublicClient, http, getAddress, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { mainnet } from "viem/chains";
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs.readFileSync(path.resolve("./.env"), "utf8")
    .split(/\r?\n/)
    .map(l => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(m => [m[1], m[2].replace(/^["']|["']$/g, "")])
);

const tokenId = BigInt(process.argv[2] ?? "0");
if (tokenId === 0n) { console.error("usage: node scripts/check-position.mjs <tokenId>"); process.exit(1); }

const client = createPublicClient({ chain: mainnet, transport: http(env.RPC_HTTP_URL) });
const POSM = getAddress(env.V4_POSITION_MANAGER);

const posmAbi = [
  { type: "function", name: "getPoolAndPositionInfo", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "poolKey", type: "tuple", components: [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" }
      ]},
      { name: "info", type: "uint256" }
    ]},
  { type: "function", name: "getPositionLiquidity", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "liquidity", type: "uint128" }] },
  { type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }] }
];

const [[poolKey], liquidity, owner] = await Promise.all([
  client.readContract({ address: POSM, abi: posmAbi, functionName: "getPoolAndPositionInfo", args: [tokenId] }),
  client.readContract({ address: POSM, abi: posmAbi, functionName: "getPositionLiquidity", args: [tokenId] }),
  client.readContract({ address: POSM, abi: posmAbi, functionName: "ownerOf", args: [tokenId] }).catch(() => null)
]);

// PoolId = keccak256(abi.encode(PoolKey))
const encoded = encodeAbiParameters(
  parseAbiParameters("(address,address,uint24,int24,address)"),
  [[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]]
);
const poolId = keccak256(encoded);

const expHook = (env.REAL_V4_HOOK_ADDRESS || "").toLowerCase();
const expToken = (env.BOUNTY_TOKEN_ADDRESS || "").toLowerCase();
const expFee = Number(env.V4_FEE || 3000);
const expTick = Number(env.V4_TICK_SPACING || 60);
const expPoolId = (env.POOL_ID || "").toLowerCase();

function check(label, actual, expected, fmt = (x) => x) {
  const ok = String(actual).toLowerCase() === String(expected).toLowerCase();
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(14)} ${fmt(actual)}${ok ? "" : "  (expected " + fmt(expected) + ")"}`);
  return ok;
}

console.log(`\nPosition NFT #${tokenId}`);
console.log(`  owner          ${owner ?? "(burned/unknown)"}`);
console.log(`  liquidity      ${liquidity.toString()}`);
console.log("");
console.log("PoolKey on-chain:");
const okC0 = check("currency0",   poolKey.currency0, "0x0000000000000000000000000000000000000000");
const okC1 = check("currency1",   poolKey.currency1, expToken);
const okFee = check("fee",        poolKey.fee, expFee);
const okTick = check("tickSpacing", poolKey.tickSpacing, expTick);
const okHook = check("hooks",     poolKey.hooks, expHook);
console.log("");
console.log("Derived PoolId:");
const okPid = check("poolId", poolId, expPoolId);
console.log("");
const allOk = okC0 && okC1 && okFee && okTick && okHook && okPid;
console.log(allOk
  ? "✓ Position is wired to your launch (matches .env REAL_V4_HOOK_ADDRESS, BOUNTY_TOKEN_ADDRESS, fee, tick, POOL_ID)."
  : "✗ Position is NOT for your launch's pool. Inspect mismatches above.");
