export function formatTokenAmount(value: bigint, decimals = 18, precision = 4): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;
  const scaled = fraction.toString().padStart(decimals, "0").slice(0, precision);
  const trimmed = scaled.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${trimmed ? `.${trimmed}` : ""}`;
}

/**
 * Format a number for display in a fixed-width slot. Abbreviates large values
 * (1.2K, 3.45M, 1.06B, 12T) and adapts decimal precision to magnitude so the
 * rendered string never gets unbounded width.
 *
 *   formatCompact(0.00342)  → "0.0034"
 *   formatCompact(7.23)     → "7.23"
 *   formatCompact(714.7289) → "714.73"
 *   formatCompact(12_345)   → "12.35K"
 *   formatCompact(2_400_000)→ "2.4M"
 *   formatCompact(1.06e9)   → "1.06B"
 */
export function formatCompact(value: number, opts: { mantissa?: number } = {}): string {
  if (!Number.isFinite(value)) return "0";
  const mantissa = opts.mantissa ?? 2;
  const abs = Math.abs(value);
  if (abs === 0) return "0";

  if (abs < 0.01) return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (abs < 1)   return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (abs < 1_000) {
    const dp = abs >= 100 ? mantissa : Math.min(mantissa + 1, 4);
    return value.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
  }

  const tiers: Array<[number, string]> = [
    [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]
  ];
  for (const [min, suffix] of tiers) {
    if (abs >= min) {
      const scaled = value / min;
      const dp = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      const formatted = scaled.toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
      return `${formatted}${suffix}`;
    }
  }
  return value.toFixed(mantissa);
}

/** wei → number → formatCompact, in one call. */
export function formatCompactWei(wei: bigint, decimals = 18, opts?: { mantissa?: number }): string {
  if (wei === 0n) return "0";
  const sign = wei < 0n ? -1 : 1;
  const abs = sign === -1 ? -wei : wei;
  const denom = 10n ** BigInt(decimals);
  const whole = Number(abs / denom);
  const frac = Number(abs % denom) / Number(denom);
  return formatCompact(sign * (whole + frac), opts);
}

export function shortAddress(address: `0x${string}`): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function blocksRemaining(currentBlock: bigint, endBlock: bigint): bigint {
  return currentBlock >= endBlock ? 0n : endBlock - currentBlock;
}
