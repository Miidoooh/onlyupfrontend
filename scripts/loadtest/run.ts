/**
 * Only Up — Anvil load test
 *
 *   1. Forks of Sepolia required.   Run in a separate terminal:
 *        anvil --fork-url $env:RPC_HTTP_URL --chain-id 11155111
 *      (Anvil's default port is 8545, override with ANVIL_RPC_URL)
 *
 *   2. From the repo root:
 *        npm run loadtest
 *
 *   What it does:
 *     - Derives WALLETS (default 100) deterministic wallets from a mnemonic
 *     - anvil_setBalance funds each with START_BALANCE_ETH ETH
 *     - Impersonates the deployed operator EOA, exempts every wallet from
 *       the 1% anti-whale limits, enables trading if needed, and transfers
 *       START_BALANCE_UP $UP to each wallet
 *     - Each wallet approves the BountyHookCore for $UP (so dump-side
 *       transferFrom works inside the hook)
 *     - Impersonates the v4 hook contract address (the current `reporter`
 *       on the core) and drives ROUNDS random buys + sells through
 *       core.reportSwap, exactly like the real v4 afterSwap path would
 *     - Decodes hook events from each receipt and prints a live timeline
 *     - Mines blocks past every active window and has buyers claim
 *     - Prints a final summary
 *
 *   No funds spent. No real Sepolia tx. Repeatable. Stop with Ctrl-C.
 */

import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
  type TransactionReceipt
} from "viem";
import {
  ADDR,
  CONFIG,
  MAX_UINT256,
  SEPOLIA_CHAIN_ID,
  anvilSepolia,
  coreAbi,
  tokenAbi
} from "./config.js";
import { deriveWallets, type TestWallet } from "./wallets.js";

/* ===================================================================== *
 *  pretty-printing helpers
 * ===================================================================== */
const colors = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  magenta:"\x1b[35m",
  gray:   "\x1b[90m"
};
const c = (s: string, color: keyof typeof colors) => `${colors[color]}${s}${colors.reset}`;

function divider(title: string) {
  const line = "─".repeat(Math.max(2, 70 - title.length));
  console.log(`\n${c(`▲ ${title} `, "green")}${c(line, "gray")}`);
}

function shortAddr(a: Address): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function fmtUp(value: bigint): string {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtEth(value: bigint): string {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/* ===================================================================== *
 *  preflight
 * ===================================================================== */
async function preflight(publicClient: PublicClient): Promise<void> {
  divider("PREFLIGHT");

  const chainId = await publicClient.getChainId();
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Anvil is running with chainId=${chainId}, expected Sepolia (${SEPOLIA_CHAIN_ID}). ` +
      `Start anvil with --fork-url <sepolia rpc> --chain-id 11155111`
    );
  }
  console.log(`  rpc        ${c(CONFIG.anvilRpc, "cyan")}  chainId=${chainId}`);

  const block = await publicClient.getBlockNumber();
  console.log(`  fork block ${c(block.toString(), "cyan")}`);

  // Sanity: contracts must exist
  const [coreOwner, coreReporter, windowBlocks, minDump, tokenOwner, tradingEnabled] = await Promise.all([
    publicClient.readContract({ address: ADDR.CORE,  abi: coreAbi,  functionName: "owner" }),
    publicClient.readContract({ address: ADDR.CORE,  abi: coreAbi,  functionName: "reporter" }),
    publicClient.readContract({ address: ADDR.CORE,  abi: coreAbi,  functionName: "bountyWindowBlocks" }),
    publicClient.readContract({ address: ADDR.CORE,  abi: coreAbi,  functionName: "minDumpAmount" }),
    publicClient.readContract({ address: ADDR.TOKEN, abi: tokenAbi, functionName: "owner" }),
    publicClient.readContract({ address: ADDR.TOKEN, abi: tokenAbi, functionName: "tradingEnabled" })
  ]);

  console.log(`  core       ${ADDR.CORE}`);
  console.log(`    owner    ${coreOwner}`);
  console.log(`    reporter ${coreReporter}  ${coreReporter.toLowerCase() === ADDR.V4_HOOK.toLowerCase() ? c("(v4 hook)", "gray") : c("(unexpected!)", "red")}`);
  console.log(`    window   ${windowBlocks} blocks`);
  console.log(`    minDump  ${fmtUp(minDump)} UP`);
  console.log(`  token      ${ADDR.TOKEN}  trading=${tradingEnabled ? c("on", "green") : c("off", "yellow")}`);
  console.log(`  operator   ${tokenOwner}  ${tokenOwner.toLowerCase() === ADDR.OPERATOR.toLowerCase() ? c("(matches)", "gray") : c("(unexpected!)", "red")}`);
}

/* ===================================================================== *
 *  setup phase: balances, exemptions, $UP transfer, approvals
 * ===================================================================== */
async function setup(
  publicClient: PublicClient,
  testClient: TestClient,
  wallets: TestWallet[]
): Promise<void> {
  divider(`SETUP (${wallets.length} wallets)`);

  /* ---- ETH ---- */
  process.stdout.write(`  funding ETH      `);
  const ethValue = parseEther(CONFIG.startBalanceEth);
  for (const w of wallets) {
    await testClient.setBalance({ address: w.address, value: ethValue });
  }
  console.log(c(`✓ ${CONFIG.startBalanceEth} ETH × ${wallets.length}`, "green"));

  /* ---- impersonate operator + give it gas ---- */
  await testClient.impersonateAccount({ address: ADDR.OPERATOR });
  await testClient.setBalance({ address: ADDR.OPERATOR, value: parseEther("100") });

  const operatorClient = createWalletClient({
    account: ADDR.OPERATOR,
    chain: anvilSepolia,
    transport: http(CONFIG.anvilRpc)
  });

  /* ---- enable trading if needed ---- */
  const tradingEnabled = await publicClient.readContract({
    address: ADDR.TOKEN, abi: tokenAbi, functionName: "tradingEnabled"
  });
  if (!tradingEnabled) {
    process.stdout.write(`  enableTrading()  `);
    const hash = await operatorClient.writeContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "enableTrading"
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(c("✓", "green"));
  } else {
    console.log(`  enableTrading()  ${c("(already enabled)", "gray")}`);
  }

  /* ---- exempt every test wallet from the 1% anti-whale limits ---- */
  process.stdout.write(`  setLimitExempt   `);
  for (const w of wallets) {
    const already = await publicClient.readContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "isLimitExempt", args: [w.address]
    });
    if (already) continue;
    const hash = await operatorClient.writeContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "setLimitExempt", args: [w.address, true]
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  console.log(c(`✓ ${wallets.length} wallets exempt`, "green"));

  /* ---- transfer $UP to each wallet ---- */
  const upAmount = parseUnits(CONFIG.startBalanceUp, 18);
  let operatorBalance = await publicClient.readContract({
    address: ADDR.TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [ADDR.OPERATOR]
  });
  console.log(`  operator $UP     ${fmtUp(operatorBalance)} UP`);

  // If operator has < (wallets * upAmount), bootstrap by impersonating the v4
  // PoolManager (which holds all LP'd UP) and pulling tokens to operator.
  // PoolManager is in isLimitExempt → token transfer bypasses anti-whale limits.
  const needTotal = upAmount * BigInt(wallets.length);
  if (operatorBalance < needTotal) {
    process.stdout.write(`  bootstrap $UP    `);
    const pmBalance = await publicClient.readContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [ADDR.POOL_MANAGER]
    });
    if (pmBalance === 0n) {
      throw new Error(`PoolManager ${ADDR.POOL_MANAGER} has 0 UP. Add liquidity first or run after a real LP add.`);
    }
    const pull = pmBalance < needTotal ? pmBalance : needTotal * 2n;
    await testClient.impersonateAccount({ address: ADDR.POOL_MANAGER });
    await testClient.setBalance({ address: ADDR.POOL_MANAGER, value: parseEther("1") });
    const pmClient = createWalletClient({
      account: ADDR.POOL_MANAGER, chain: anvilSepolia, transport: http(CONFIG.anvilRpc)
    });
    const hash = await pmClient.writeContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "transfer", args: [ADDR.OPERATOR, pull]
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await testClient.stopImpersonatingAccount({ address: ADDR.POOL_MANAGER });
    operatorBalance = await publicClient.readContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [ADDR.OPERATOR]
    });
    console.log(c(`✓ ${fmtUp(operatorBalance)} UP (impersonated PoolManager)`, "green"));
  }

  process.stdout.write(`  transfer $UP     `);
  for (const w of wallets) {
    const balance = await publicClient.readContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [w.address]
    });
    if (balance >= upAmount) continue;
    const need = upAmount - balance;
    const hash = await operatorClient.writeContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "transfer", args: [w.address, need]
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  console.log(c(`✓ ${CONFIG.startBalanceUp} UP × ${wallets.length}`, "green"));

  await testClient.stopImpersonatingAccount({ address: ADDR.OPERATOR });

  /* ---- each wallet approves the core for $UP ---- */
  process.stdout.write(`  approve(core)    `);
  let approved = 0;
  for (const w of wallets) {
    const allow = await publicClient.readContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "allowance", args: [w.address, ADDR.CORE]
    });
    if (allow >= upAmount) continue;
    await testClient.impersonateAccount({ address: w.address });
    const wc = createWalletClient({ account: w.address, chain: anvilSepolia, transport: http(CONFIG.anvilRpc) });
    const hash = await wc.writeContract({
      address: ADDR.TOKEN, abi: tokenAbi, functionName: "approve", args: [ADDR.CORE, MAX_UINT256]
    });
    await publicClient.waitForTransactionReceipt({ hash });
    await testClient.stopImpersonatingAccount({ address: w.address });
    approved += 1;
  }
  console.log(c(`✓ ${approved}/${wallets.length} new approvals`, "green"));
}

/* ===================================================================== *
 *  event decoding + pretty timeline
 * ===================================================================== */
interface Stats {
  rounds: number;
  buys: number;
  sells: number;
  reverts: number;
  windowsOpened: Set<Hex>;
  windowsClosed: Set<Hex>;
  totalBountyFunded: bigint;
  totalQualifyingBuy: bigint;
  totalClaimed: bigint;
  largestDump: bigint;
}

function newStats(): Stats {
  return {
    rounds: 0, buys: 0, sells: 0, reverts: 0,
    windowsOpened: new Set(), windowsClosed: new Set(),
    totalBountyFunded: 0n, totalQualifyingBuy: 0n, totalClaimed: 0n, largestDump: 0n
  };
}

function decodeAndPrint(receipt: TransactionReceipt, stats: Stats, label: string) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ADDR.CORE.toLowerCase()) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: coreAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    switch (decoded.eventName) {
      case "BountyOpened": {
        const args = decoded.args as { windowId: Hex; bountyAmount: bigint; endBlock: bigint };
        stats.windowsOpened.add(args.windowId);
        console.log(`  ${c("◆ OPENED   ", "magenta")} ${label}  bag=${c(`${fmtUp(args.bountyAmount)} UP`, "yellow")}  ends @${args.endBlock}  ${c(args.windowId.slice(0, 10), "gray")}`);
        break;
      }
      case "BountyFunded": {
        const args = decoded.args as { bountyAmount: bigint; sellAmount: bigint; bountyBps: number; seller: Address };
        stats.totalBountyFunded += args.bountyAmount;
        if (args.sellAmount > stats.largestDump) stats.largestDump = args.sellAmount;
        console.log(`  ${c("● FUNDED   ", "yellow")} ${label}  ${shortAddr(args.seller)} dumped ${c(`${fmtUp(args.sellAmount)} UP`, "red")}  +${fmtUp(args.bountyAmount)} bag  ${(args.bountyBps / 100).toFixed(2)}%`);
        break;
      }
      case "BountyBuyRecorded": {
        const args = decoded.args as { buyAmount: bigint; buyer: Address };
        stats.totalQualifyingBuy += args.buyAmount;
        console.log(`  ${c("▲ BUY      ", "green")} ${label}  ${shortAddr(args.buyer)}  ${c(`${fmtEth(args.buyAmount)} ETH`, "green")} qualifying`);
        break;
      }
      case "BountyPressureUpdated": {
        const args = decoded.args as { sellVolume: bigint; buyVolume: bigint; bountyBps: number };
        const arrow = args.sellVolume > args.buyVolume ? c("↗", "yellow") : c("↘", "gray");
        console.log(`  ${c(`${arrow} PRESSURE `, "gray")} ${label}  bps=${(args.bountyBps / 100).toFixed(2)}%  sells=${fmtUp(args.sellVolume)} buys=${fmtUp(args.buyVolume)}`);
        break;
      }
      case "BountyWindowClosed": {
        const args = decoded.args as { windowId: Hex; totalBounty: bigint; totalQualifyingBuy: bigint };
        stats.windowsClosed.add(args.windowId);
        console.log(`  ${c("■ CLOSED   ", "cyan")} ${label}  ${c(args.windowId.slice(0, 10), "gray")}  bag=${fmtUp(args.totalBounty)} buy=${fmtEth(args.totalQualifyingBuy)} ETH`);
        break;
      }
      case "BountyClaimed": {
        const args = decoded.args as { rewardAmount: bigint; buyer: Address };
        stats.totalClaimed += args.rewardAmount;
        console.log(`  ${c("✓ CLAIMED  ", "green")} ${label}  ${shortAddr(args.buyer)} → ${c(`${fmtUp(args.rewardAmount)} UP`, "green")}`);
        break;
      }
    }
  }
}

/* ===================================================================== *
 *  load test loop
 * ===================================================================== */
async function runLoad(
  publicClient: PublicClient,
  testClient: TestClient,
  wallets: TestWallet[]
): Promise<Stats> {
  divider(`LOAD TEST (${CONFIG.rounds} rounds, buy_prob=${CONFIG.buyProb})`);

  await testClient.impersonateAccount({ address: ADDR.V4_HOOK });
  await testClient.setBalance({ address: ADDR.V4_HOOK, value: parseEther("100") });

  const reporterClient = createWalletClient({
    account: ADDR.V4_HOOK,
    chain: anvilSepolia,
    transport: http(CONFIG.anvilRpc)
  });

  const stats = newStats();
  const minSell = parseUnits(CONFIG.minSellUp, 18);
  const maxSell = parseUnits(CONFIG.maxSellUp, 18);
  const minBuy = parseEther(CONFIG.minBuyEth);
  const maxBuy = parseEther(CONFIG.maxBuyEth);

  function pickAmount(min: bigint, max: bigint): bigint {
    const span = max - min;
    if (span <= 0n) return min;
    const r = BigInt(Math.floor(Math.random() * Number(span > 1_000_000n ? 1_000_000n : span)));
    return min + (span * r) / (span > 1_000_000n ? 1_000_000n : span);
  }

  for (let round = 1; round <= CONFIG.rounds; round++) {
    const w = wallets[Math.floor(Math.random() * wallets.length)]!;
    const isBuy = Math.random() < CONFIG.buyProb;
    const side = isBuy ? 0 : 1; // 0 = Buy, 1 = Sell
    const amount = isBuy ? pickAmount(minBuy, maxBuy) : pickAmount(minSell, maxSell);
    const label = c(`#${round.toString().padStart(3, "0")}`, "dim");

    try {
      const hash = await reporterClient.writeContract({
        address: ADDR.CORE,
        abi: coreAbi,
        functionName: "reportSwap",
        args: [ADDR.POOL_ID, w.address, ADDR.TOKEN, ADDR.NATIVE_ETH, side, amount]
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "success") {
        if (isBuy) stats.buys += 1; else stats.sells += 1;
        decodeAndPrint(receipt, stats, label);
      } else {
        stats.reverts += 1;
        console.log(`  ${c("✗ REVERT   ", "red")} ${label}  ${isBuy ? "buy" : "sell"} ${shortAddr(w.address)} reverted`);
      }
    } catch (err) {
      stats.reverts += 1;
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.log(`  ${c("✗ ERROR    ", "red")} ${label}  ${msg}`);
    }

    stats.rounds += 1;

    if (CONFIG.blocksPerRound > 0) {
      await testClient.mine({ blocks: CONFIG.blocksPerRound });
    }
  }

  await testClient.stopImpersonatingAccount({ address: ADDR.V4_HOOK });
  return stats;
}

/* ===================================================================== *
 *  claim sweep — mine past every active window and claim from each buyer
 * ===================================================================== */
async function claimSweep(
  publicClient: PublicClient,
  testClient: TestClient,
  wallets: TestWallet[],
  stats: Stats
): Promise<void> {
  divider("CLAIM SWEEP");

  if (CONFIG.finalMine > 0) {
    process.stdout.write(`  mining ${CONFIG.finalMine} blocks  `);
    await testClient.mine({ blocks: CONFIG.finalMine });
    console.log(c("✓", "green"));
  }

  const allWindows = [...stats.windowsOpened];
  if (allWindows.length === 0) {
    console.log(`  ${c("(no windows opened — nothing to claim)", "gray")}`);
    return;
  }
  console.log(`  windows  ${allWindows.length}`);

  let claims = 0;
  for (const windowId of allWindows) {
    for (const w of wallets) {
      const claimable = await publicClient.readContract({
        address: ADDR.CORE, abi: coreAbi, functionName: "claimable", args: [windowId, w.address]
      });
      if (claimable === 0n) continue;
      try {
        await testClient.impersonateAccount({ address: w.address });
        const wc = createWalletClient({ account: w.address, chain: anvilSepolia, transport: http(CONFIG.anvilRpc) });
        const hash = await wc.writeContract({
          address: ADDR.CORE, abi: coreAbi, functionName: "claim", args: [windowId]
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "success") {
          claims += 1;
          decodeAndPrint(receipt, stats, c(`#${claims.toString().padStart(3, "0")}`, "dim"));
        }
        await testClient.stopImpersonatingAccount({ address: w.address });
      } catch (err) {
        const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
        console.log(`  ${c("✗ CLAIM    ", "red")} ${shortAddr(w.address)} ${msg}`);
      }
    }
  }
}

/* ===================================================================== *
 *  summary
 * ===================================================================== */
function summary(stats: Stats) {
  divider("SUMMARY");
  const lines: Array<[string, string]> = [
    ["rounds          ", stats.rounds.toLocaleString()],
    ["buys / sells    ", `${c(stats.buys.toString(), "green")} / ${c(stats.sells.toString(), "red")}`],
    ["reverts         ", stats.reverts > 0 ? c(stats.reverts.toString(), "red") : "0"],
    ["windows opened  ", stats.windowsOpened.size.toString()],
    ["windows closed  ", stats.windowsClosed.size.toString()],
    ["total bounty    ", `${c(fmtUp(stats.totalBountyFunded), "yellow")} UP`],
    ["total claimed   ", `${c(fmtUp(stats.totalClaimed), "green")} UP`],
    ["total qual buy  ", `${fmtEth(stats.totalQualifyingBuy)} ETH`],
    ["largest dump    ", `${fmtUp(stats.largestDump)} UP`]
  ];
  for (const [k, v] of lines) console.log(`  ${c(k, "gray")}  ${v}`);

  const reconcile = stats.totalBountyFunded - stats.totalClaimed;
  if (reconcile > 0n) {
    console.log(`  ${c("unclaimed bag   ", "gray")}  ${fmtUp(reconcile)} UP ${c("(window may still be open or has zero qualifying buyers)", "gray")}`);
  } else if (reconcile < 0n) {
    console.log(c(`  WARN: claimed exceeds funded by ${fmtUp(-reconcile)} UP — bug?`, "red"));
  } else if (stats.totalBountyFunded > 0n) {
    console.log(c("  fully reconciled — every UP funded was claimed.", "green"));
  }
  console.log();
}

/* ===================================================================== *
 *  main
 * ===================================================================== */
async function main() {
  console.log(c(`\n  ▲▲▲ Only Up — Anvil load test ▲▲▲\n`, "green"));
  console.log(`  ${c("config", "gray")}  rpc=${CONFIG.anvilRpc}  wallets=${CONFIG.walletCount}  rounds=${CONFIG.rounds}  buy_prob=${CONFIG.buyProb}`);

  const publicClient = createPublicClient({ chain: anvilSepolia, transport: http(CONFIG.anvilRpc) }) as PublicClient;
  const testClient = createTestClient({ chain: anvilSepolia, transport: http(CONFIG.anvilRpc), mode: "anvil" }) as TestClient;

  try {
    await preflight(publicClient);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(c(`\n  ✗ preflight failed: ${msg}`, "red"));
    console.error(c(`\n  Hint: start anvil in another terminal with:`, "gray"));
    console.error(c(`    anvil --fork-url $env:RPC_HTTP_URL --chain-id 11155111\n`, "cyan"));
    process.exit(1);
  }

  const wallets = deriveWallets();
  console.log(`  derived ${wallets.length} wallets from mnemonic. first=${shortAddr(wallets[0]!.address)} last=${shortAddr(wallets[wallets.length - 1]!.address)}`);

  await setup(publicClient, testClient, wallets);
  const stats = await runLoad(publicClient, testClient, wallets);
  await claimSweep(publicClient, testClient, wallets, stats);
  summary(stats);
}

main().catch((err) => {
  console.error(c(`\n✗ fatal: ${err instanceof Error ? err.stack : err}\n`, "red"));
  process.exit(1);
});
