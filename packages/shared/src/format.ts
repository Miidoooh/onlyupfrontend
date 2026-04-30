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

export function shortAddress(address: `0x${string}`): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function blocksRemaining(currentBlock: bigint, endBlock: bigint): bigint {
  return currentBlock >= endBlock ? 0n : endBlock - currentBlock;
}
