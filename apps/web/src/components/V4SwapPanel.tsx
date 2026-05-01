"use client";

import { useMemo, useState } from "react";
import { Actions, V4Planner } from "@uniswap/v4-sdk";
import { CommandType, RoutePlanner } from "@uniswap/universal-router-sdk";
import { useAppKit } from "@reown/appkit/react";
import { createPublicClient, formatEther, formatUnits, http, parseEther, parseUnits, type Hex } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import {
  ACTIVE_CHAIN,
  ACTIVE_CHAIN_ID,
  ACTIVE_POOL_KEY,
  applySlippage,
  asHex,
  QUOTER_ABI,
  SEPOLIA_RPC_URL,
  UNIVERSAL_ROUTER,
  UNIVERSAL_ROUTER_ABI,
  V4_QUOTER
} from "../lib/v4Pool";

type SwapSide = "buy" | "sell";

const publicClient = createPublicClient({
  chain: ACTIVE_CHAIN,
  transport: http(SEPOLIA_RPC_URL)
});

export function V4SwapPanel() {
  const { open } = useAppKit();
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const [side, setSide] = useState<SwapSide>("buy");
  const [amount, setAmount] = useState("0.001");
  const [quote, setQuote] = useState<{ amountOut: bigint; gasEstimate: bigint }>();
  const [status, setStatus] = useState<string>();
  const [busy, setBusy] = useState(false);

  const labels = useMemo(() => {
    if (side === "buy") return { input: "ETH in (native)", output: "UP out", cta: "BUY VIA NATIVE ETH POOL" };
    return { input: "UP in", output: "ETH out (native)", cta: "SELL VIA NATIVE ETH POOL" };
  }, [side]);

  async function ensureWallet() {
    if (!isConnected || !address) {
      await open({ view: "Connect" });
      throw new Error("Connect wallet with Reown AppKit first.");
    }
    if (chainId !== ACTIVE_CHAIN_ID) {
      await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
    }
    if (!walletClient) throw new Error("Wallet client not ready. Try again after connection finishes.");
    return { walletClient, account: address };
  }

  async function getQuote() {
    setBusy(true);
    setStatus(undefined);
    try {
      const exactAmount =
        side === "buy" ? parseEther(amount || "0") : parseUnits(amount || "0", 18);
      if (exactAmount <= 0n) throw new Error("Enter an amount greater than zero.");

      const result = await publicClient.readContract({
        address: V4_QUOTER,
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: ACTIVE_POOL_KEY,
            zeroForOne: side === "buy",
            exactAmount,
            hookData: "0x"
          }
        ]
      });

      setQuote({ amountOut: result[0], gasEstimate: result[1] });
      setStatus("Quote loaded from v4 quoter.");
      return { amountIn: exactAmount, amountOut: result[0] };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Quote failed.";
      setStatus(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function swap() {
    setBusy(true);
    setStatus(undefined);
    try {
      const { walletClient, account } = await ensureWallet();
      const { amountIn, amountOut } = quote
        ? {
            amountIn: side === "buy" ? parseEther(amount || "0") : parseUnits(amount || "0", 18),
            amountOut: quote.amountOut
          }
        : await getQuote();
      const minOut = applySlippage(amountOut, 500n);

      // hookData carries the actual trader so BountyV4Hook._trader decodes the
      // user (not the Universal Router). Without this the leaderboard records
      // the router address for every swap.
      const traderHookData: Hex = (account.toLowerCase() as Hex);

      const v4Planner = new V4Planner();
      v4Planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [
        {
          poolKey: ACTIVE_POOL_KEY,
          zeroForOne: side === "buy",
          amountIn: amountIn.toString(),
          amountOutMinimum: minOut.toString(),
          hookData: traderHookData
        }
      ]);
      v4Planner.addAction(Actions.SETTLE_ALL, [side === "buy" ? ACTIVE_POOL_KEY.currency0 : ACTIVE_POOL_KEY.currency1, amountIn.toString()]);
      v4Planner.addAction(Actions.TAKE_ALL, [side === "buy" ? ACTIVE_POOL_KEY.currency1 : ACTIVE_POOL_KEY.currency0, minOut.toString()]);

      const routePlanner = new RoutePlanner();
      routePlanner.addCommand(CommandType.V4_SWAP, [v4Planner.finalize()]);

      const hash = await walletClient.writeContract({
        account,
        address: UNIVERSAL_ROUTER,
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: "execute",
        args: [asHex(routePlanner.commands), routePlanner.inputs as Hex[], BigInt(Math.floor(Date.now() / 1000) + 20 * 60)],
        value: side === "buy" ? amountIn : 0n
      });

      setStatus(`Sent: ${hash}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Swap failed.";
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="swap-panel panel warm" id="buy">
      <div className="swap-head">
        <span className="eyebrow">
          <span className="pip" />
          direct v4 router
        </span>
        <h2>Native ETH pool — same PoolKey your launch deployed</h2>
        <p>
          Sepolia Uniswap UI often shows no route for custom v4 hooks. This panel quotes the exact native-ETH PoolKey
          (fee / tick / hook from your env). Match <code>NEXT_PUBLIC_V4_POOL_FEE</code> and{" "}
          <code>NEXT_PUBLIC_V4_TICK_SPACING</code> to forge deploy (default 10000 / 200).
        </p>
        <small>{isConnected && address ? `Connected: ${address.slice(0, 6)}...${address.slice(-4)}` : "Connect with Reown AppKit to swap."}</small>
      </div>

      <div className="swap-tabs">
        <button className={side === "buy" ? "active" : ""} onClick={() => setSide("buy")} type="button">
          Buy
        </button>
        <button className={side === "sell" ? "active" : ""} onClick={() => setSide("sell")} type="button">
          Sell
        </button>
      </div>

      <label className="swap-input">
        <span>{labels.input}</span>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
      </label>

      <div className="quote-box">
        <span>{labels.output}</span>
        <strong>
          {quote
            ? side === "buy"
              ? `${Number(formatUnits(quote.amountOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} UP`
              : `${formatEther(quote.amountOut)} ETH`
            : "No quote yet"}
        </strong>
        {quote ? <small>Gas estimate: {quote.gasEstimate.toLocaleString()} gas</small> : null}
      </div>

      <div className="swap-actions">
        <button className="button ghost" onClick={() => void getQuote()} disabled={busy} type="button">
          QUOTE
        </button>
        <button className="button huge" onClick={() => void swap()} disabled={busy} type="button">
          {busy ? "WORKING..." : labels.cta}
        </button>
      </div>

      {status ? <p className="swap-status">{status}</p> : null}
    </section>
  );
}
