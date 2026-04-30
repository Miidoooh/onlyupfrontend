import { createPublicClient, getContract, http, parseAbi, type Hex } from "viem";
import type { ChainConfig } from "@bounty/shared";

export const bountyHookAbi = parseAbi([
  "event BountyOpened(bytes32 indexed windowId, bytes32 indexed poolId, address indexed bountyToken, address quoteToken, uint64 startBlock, uint64 endBlock, uint256 bountyAmount)",
  "event BountyFunded(bytes32 indexed windowId, address indexed seller, uint256 bountyAmount, uint256 sellAmount, uint16 bountyBps)",
  "event BountyBuyRecorded(bytes32 indexed windowId, address indexed buyer, uint256 buyAmount)",
  "event BountyPressureUpdated(bytes32 indexed poolId, uint256 sellVolume, uint256 buyVolume, uint16 bountyBps)",
  "event BountyWindowClosed(bytes32 indexed windowId, uint256 totalBounty, uint256 totalQualifyingBuy)",
  "event BountyClaimed(bytes32 indexed windowId, address indexed buyer, uint256 rewardAmount)"
]);

export function createBountyHookClient(config: ChainConfig) {
  const client = createPublicClient({ transport: http(config.rpcHttpUrl) });
  return getContract({
    address: config.bountyHookAddress as Hex,
    abi: bountyHookAbi,
    client
  });
}
