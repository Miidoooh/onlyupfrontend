import { formatCompactWei } from "@bounty/shared";
import { LiveDot } from "./LiveDot";

interface BountyPotProps {
  amountWei: bigint;
  symbol: string;
  windowBlocks: number;
  qualifyingBuyWei: bigint;
  qualifyingSymbol?: string;
  isActive: boolean;
}

export function BountyPot({
  amountWei,
  symbol,
  windowBlocks,
  qualifyingBuyWei,
  qualifyingSymbol = "ETH",
  isActive
}: BountyPotProps) {
  const amount = formatCompactWei(amountWei);
  const qualifying = formatCompactWei(qualifyingBuyWei);

  return (
    <div className="pot-card panel warm">
      <div className="pot-header">
        <span className="eyebrow">
          <span className="pip" />
          The Bag
        </span>
        {isActive ? <LiveDot label="ARMED" /> : <LiveDot label="REARMING" />}
      </div>

      <div className="pot-amount" title={`${amountWei.toString()} (raw wei)`}>
        <span className="pot-number">{amount}</span>
        <span className="unit">{symbol}</span>
      </div>

      <p className="pot-sub">
        {isActive
          ? "Up for grabs. Earlier you ape, fatter your slice."
          : "Quiet. The next dump rearms the bag and starts a fresh hunt."}
      </p>

      <div className="pot-grid">
        <div>
          <span className="label">⏱ window</span>
          <span className="value">{windowBlocks > 0 ? `${windowBlocks} blocks` : "Closed"}</span>
        </div>
        <div>
          <span className="label">🦍 buy vol</span>
          <span className="value">
            {qualifying} {qualifyingSymbol}
          </span>
        </div>
      </div>
    </div>
  );
}
