import { createPublicClient, http, getAddress, padHex, decodeAbiParameters, decodeEventLog } from "viem";
import { mainnet } from "viem/chains";

const RPC = process.env.RPC_HTTP_URL || "https://ethereum-rpc.publicnode.com";
const CORE = "0xba82d2167ce8c1b44a66e398f75ff8b915c81eea";
const HOOK = "0xfa4baf13d9a1428ec47c51556424d211aac64040";
const TOKEN = "0x44d93da751d6ffb83dc7cb8d87649d9b6467892c";
const POOL = "0x03b70a554abd42761f372403ae61fb32249f21b4b5ab7008ac533327e7bdd147";
const FROM_BLOCK = 24995300n;

const client = createPublicClient({ chain: mainnet, transport: http(RPC) });

const coreAbi = [
  { type: "function", name: "poolConfigs", stateMutability: "view", inputs: [{ name: "poolId", type: "bytes32" }], outputs: [{ name: "bountyToken", type: "address" }, { name: "quoteToken", type: "address" }, { name: "enabled", type: "bool" }] },
  { type: "function", name: "reporter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minDumpAmount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bountyWindowBlocks", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "activeWindowByPool", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "event", name: "BountyOpened", inputs: [{ indexed: true, name: "windowId", type: "bytes32" }, { indexed: true, name: "poolId", type: "bytes32" }, { indexed: true, name: "bountyToken", type: "address" }, { name: "quoteToken", type: "address" }, { name: "startBlock", type: "uint64" }, { name: "endBlock", type: "uint64" }, { name: "bountyAmount", type: "uint256" }] },
  { type: "event", name: "BountyFunded", inputs: [{ indexed: true, name: "windowId", type: "bytes32" }, { indexed: true, name: "seller", type: "address" }, { name: "bountyAmount", type: "uint256" }, { name: "sellAmount", type: "uint256" }, { name: "bountyBps", type: "uint16" }] },
  { type: "event", name: "BountyPressureUpdated", inputs: [{ indexed: true, name: "poolId", type: "bytes32" }, { name: "sellVolume", type: "uint256" }, { name: "buyVolume", type: "uint256" }, { name: "bountyBps", type: "uint16" }] },
  { type: "event", name: "BountyBuyRecorded", inputs: [{ indexed: true, name: "windowId", type: "bytes32" }, { indexed: true, name: "buyer", type: "address" }, { name: "buyAmount", type: "uint256" }] }
];

const hookAbi = [
  { type: "event", name: "V4HookSwapObserved", inputs: [{ indexed: true, name: "poolId", type: "bytes32" }, { indexed: true, name: "trader", type: "address" }, { indexed: true, name: "isSell", type: "bool" }, { name: "amount", type: "uint256" }, { name: "reportedToCore", type: "bool" }] },
  { type: "event", name: "V4HookReportFailed", inputs: [{ indexed: true, name: "poolId", type: "bytes32" }, { indexed: true, name: "trader", type: "address" }, { indexed: true, name: "isSell", type: "bool" }, { name: "reason", type: "bytes" }] },
  { type: "event", name: "V4HookSkipped", inputs: [{ indexed: true, name: "poolId", type: "bytes32" }, { indexed: true, name: "reason", type: "bytes32" }] }
];

console.log("=== CORE STATE ===");
const [poolConf, reporter, minDump, windowBlocks, activeWin, owner] = await Promise.all([
  client.readContract({ address: getAddress(CORE), abi: coreAbi, functionName: "poolConfigs", args: [POOL] }),
  client.readContract({ address: getAddress(CORE), abi: coreAbi, functionName: "reporter" }),
  client.readContract({ address: getAddress(CORE), abi: coreAbi, functionName: "minDumpAmount" }),
  client.readContract({ address: getAddress(CORE), abi: coreAbi, functionName: "bountyWindowBlocks" }),
  client.readContract({ address: getAddress(CORE), abi: coreAbi, functionName: "activeWindowByPool", args: [POOL] }),
  client.readContract({ address: getAddress(CORE), abi: coreAbi, functionName: "owner" })
]);

console.log("Core owner:        ", owner);
console.log("Core reporter:     ", reporter, "(expected hook =", HOOK + ")");
console.log("Reporter matches?  ", reporter.toLowerCase() === HOOK.toLowerCase() ? "YES" : "NO ⚠");
console.log("minDumpAmount:     ", minDump.toString(), `(${Number(minDump) / 1e18} UP)`);
console.log("bountyWindowBlocks:", windowBlocks.toString());
console.log("Active window:     ", activeWin);
console.log("");
console.log("Pool config for", POOL.slice(0, 14) + "…");
console.log("  bountyToken:", poolConf[0], "(expected =", TOKEN + ")");
console.log("  quoteToken: ", poolConf[1]);
console.log("  enabled:    ", poolConf[2] ? "YES ✓" : "NO ⚠ — reportSwap WILL revert with PoolNotEnabled");
console.log("  matches?    ", poolConf[0].toLowerCase() === TOKEN.toLowerCase() ? "YES" : "NO ⚠");
console.log("");

const latest = await client.getBlockNumber();
console.log("=== EVENT COUNTS (blocks", FROM_BLOCK, "→", latest, "=", (latest - FROM_BLOCK).toString(), "blocks) ===");

async function getLogs(address, eventName, abi) {
  const evt = abi.find(e => e.type === "event" && e.name === eventName);
  return await client.getLogs({
    address: getAddress(address),
    event: evt,
    fromBlock: FROM_BLOCK,
    toBlock: latest
  });
}

const [opened, funded, pressure, buyRec, observed, failed, skipped] = await Promise.all([
  getLogs(CORE, "BountyOpened", coreAbi),
  getLogs(CORE, "BountyFunded", coreAbi),
  getLogs(CORE, "BountyPressureUpdated", coreAbi),
  getLogs(CORE, "BountyBuyRecorded", coreAbi),
  getLogs(HOOK, "V4HookSwapObserved", hookAbi),
  getLogs(HOOK, "V4HookReportFailed", hookAbi),
  getLogs(HOOK, "V4HookSkipped", hookAbi)
]);

console.log("CORE.BountyOpened:        ", opened.length);
console.log("CORE.BountyFunded:        ", funded.length);
console.log("CORE.BountyPressureUpdated:", pressure.length);
console.log("CORE.BountyBuyRecorded:   ", buyRec.length);
console.log("");
console.log("HOOK.V4HookSwapObserved:  ", observed.length, "(buys:", observed.filter(l => !l.args.isSell).length, "sells:", observed.filter(l => l.args.isSell).length + ")");
console.log("HOOK.V4HookReportFailed:  ", failed.length, failed.length > 0 ? "⚠ swaps where Core rejected the report" : "");
console.log("HOOK.V4HookSkipped:       ", skipped.length, skipped.length > 0 ? "⚠ wrong route/disabled" : "");

if (failed.length > 0) {
  console.log("\n=== FIRST FEW REPORT FAILURES ===");
  for (const log of failed.slice(0, 5)) {
    console.log("  block", log.blockNumber, "trader", log.args.trader, "isSell", log.args.isSell, "reason", log.args.reason);
  }
}

if (skipped.length > 0) {
  console.log("\n=== FIRST FEW SKIPPED ===");
  for (const log of skipped.slice(0, 3)) {
    console.log("  block", log.blockNumber, "reason hash", log.args.reason);
  }
}

if (observed.filter(l => l.args.isSell).length > 0) {
  console.log("\n=== ALL SELL OBSERVATIONS ===");
  for (const log of observed.filter(l => l.args.isSell)) {
    console.log("  block", log.blockNumber, "trader", log.args.trader, "amount", (Number(log.args.amount) / 1e18).toFixed(2), "UP", "reported?", log.args.reportedToCore);
  }
}
