import { describe, expect, it } from "vitest";
import { demoEvents } from "./fixtures.js";
import { BountyReadStore } from "./store.js";

describe("BountyReadStore", () => {
  it("builds stats and leaderboard from hook events", () => {
    const store = new BountyReadStore();
    demoEvents.forEach((event) => store.apply(event));

    expect(store.getActiveWindows()).toHaveLength(1);
    expect(store.getStats().totalHunters).toBe(2);
    expect(store.getLeaderboard()[0]?.totalBought).toBe(12_000_000_000_000_000_000n);
  });
});
