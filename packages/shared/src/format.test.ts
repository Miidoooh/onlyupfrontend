import { describe, expect, it } from "vitest";
import { blocksRemaining, formatCompact, formatCompactWei, formatTokenAmount, shortAddress } from "./format.js";

describe("format helpers", () => {
  it("formats token amounts without floating point drift", () => {
    expect(formatTokenAmount(3_250_000_000_000_000_000n)).toBe("3.25");
  });

  it("shortens addresses", () => {
    expect(shortAddress("0x1111111111111111111111111111111111111111")).toBe("0x1111...1111");
  });

  it("clamps remaining blocks at zero", () => {
    expect(blocksRemaining(51n, 50n)).toBe(0n);
  });

  it("formatCompact adapts decimals to magnitude", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(7.23)).toBe("7.23");
    expect(formatCompact(714.7289)).toBe("714.73");
    expect(formatCompact(12_345)).toBe("12.3K");
    expect(formatCompact(2_400_000)).toBe("2.4M");
    expect(formatCompact(1.06e9)).toBe("1.06B");
  });

  it("formatCompactWei abbreviates 18-decimal bigints", () => {
    expect(formatCompactWei(714_728_920_000_000_000_000n)).toBe("714.73");
    expect(formatCompactWei(0n)).toBe("0");
  });
});
