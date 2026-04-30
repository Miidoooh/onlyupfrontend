"use client";

import { useMemo } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAccount } from "wagmi";
import { formatTokenAmount, shortAddress, type HexAddress } from "@bounty/shared";
import type { ApiLeaderboardEntry } from "../lib/api";

interface HunterProfileProps {
  leaderboard: ApiLeaderboardEntry[];
}

export function HunterProfile({ leaderboard }: HunterProfileProps) {
  const { open } = useAppKit();
  const { address, isConnecting } = useAccount();

  const hunter = useMemo(
    () => leaderboard.find((entry) => address && entry.wallet.toLowerCase() === address.toLowerCase()),
    [address, leaderboard]
  );

  return (
    <div className="hunter panel warm">
      <div>
        <span className="eyebrow">
          <span className="pip" />
          your console
        </span>
        <h2>{address ? shortAddress(address as HexAddress) : "ape not connected"}</h2>
        <p className="muted">
          {hunter
            ? `Rank #${hunter.rank}. You've cleared ${hunter.windowsWon} bag${hunter.windowsWon === 1 ? "" : "s"}. Don't stop.`
            : "Plug in your wallet to track your bag, watch claimable, and join the hunt."}
        </p>
      </div>

      <button className="button" onClick={() => void open({ view: "Connect" })} disabled={isConnecting}>
        <span aria-hidden="true">▲</span>
        {address ? "WALLET LOCKED IN" : isConnecting ? "CONNECTING…" : "CONNECT WALLET"}
      </button>

      {hunter ? (
        <div className="hunter-stats">
          <div>
            <span className="label">$UP bought</span>
            <strong>{formatTokenAmount(BigInt(hunter.totalBought))}</strong>
          </div>
          <div>
            <span className="label">claimed</span>
            <strong>{formatTokenAmount(BigInt(hunter.totalRewards))}</strong>
          </div>
          <div>
            <span className="label">bags hunted</span>
            <strong>{hunter.windowsWon}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}
