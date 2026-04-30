import { describe, expect, it } from "vitest";
import { blocksRemaining, formatTokenAmount, shortAddress } from "./format.js";

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
});
