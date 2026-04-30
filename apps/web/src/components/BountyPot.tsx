import { CountUp } from "./CountUp";
import { LiveDot } from "./LiveDot";

interface BountyPotProps {
  amountWei: bigint;
  symbol: string;
  windowBlocks: number;
  qualifyingBuyWei: bigint;
  qualifyingSymbol?: string;
  isActive: boolean;
}

function weiToNumber(value: bigint, decimals = 18): number {
  if (value === 0n) return 0;
  const sign = value < 0n ? -1 : 1;
  const abs = sign === -1 ? -value : value;
  const denom = 10n ** BigInt(decimals);
  const whole = Number(abs / denom);
  const frac = Number(abs % denom) / Number(denom);
  return sign * (whole + frac);
}

export function BountyPot({
  amountWei,
  symbol,
  windowBlocks,
  qualifyingBuyWei,
  qualifyingSymbol = "ETH",
  isActive
}: BountyPotProps) {
  const amount = weiToNumber(amountWei);
  const qualifying = weiToNumber(qualifyingBuyWei);

  return (
    <div className="pot-card panel warm">
      <div className="pot-header">
        <span className="eyebrow">
          <span className="pip" />
          The Bag
        </span>
        {isActive ? <LiveDot label="ARMED" /> : <LiveDot label="REARMING" />}
      </div>

      <div className="pot-amount">
        <CountUp to={amount} decimals={4} duration={1600} />
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
            <CountUp to={qualifying} decimals={3} duration={1400} suffix={` ${qualifyingSymbol}`} />
          </span>
        </div>
      </div>
    </div>
  );
}
