import { z } from "zod";

export const hexAddressSchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value),
  "Expected an EVM address"
);

export const bytes32Schema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value),
  "Expected a bytes32 hex value"
);

const bigintString = z.string().regex(/^\d+$/).transform((value) => BigInt(value));
const bigintValue = z.union([bigintString, z.bigint(), z.number().int().nonnegative().transform((value) => BigInt(value))]);

export const bountyEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("BountyOpened"),
    windowId: z.string(),
    poolId: bytes32Schema,
    bountyToken: hexAddressSchema,
    quoteToken: hexAddressSchema,
    startBlock: bigintValue,
    endBlock: bigintValue,
    bountyAmount: bigintValue,
    bountyBps: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal("BountyFunded"),
    windowId: z.string(),
    seller: hexAddressSchema,
    bountyAmount: bigintValue,
    sellAmount: bigintValue,
    bountyBps: z.number().int().nonnegative().optional()
  }),
  z.object({
    type: z.literal("BountyBuyRecorded"),
    windowId: z.string(),
    buyer: hexAddressSchema,
    buyAmount: bigintValue
  }),
  z.object({
    type: z.literal("BountyPressureUpdated"),
    poolId: bytes32Schema,
    sellVolume: bigintValue,
    buyVolume: bigintValue,
    bountyBps: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("BountyWindowClosed"),
    windowId: z.string(),
    totalBounty: bigintValue,
    totalQualifyingBuy: bigintValue
  }),
  z.object({
    type: z.literal("BountyClaimed"),
    windowId: z.string(),
    buyer: hexAddressSchema,
    rewardAmount: bigintValue
  })
]);

export type BountyEvent = z.infer<typeof bountyEventSchema>;
