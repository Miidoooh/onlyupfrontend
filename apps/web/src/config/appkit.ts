"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet, sepolia, type AppKitNetwork } from "@reown/appkit/networks";
import { QueryClient } from "@tanstack/react-query";

export const projectId = "ae975541a386653f5b6e53354513e427";

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
const primary: AppKitNetwork = chainId === 1 ? mainnet : sepolia;

export const networks = [primary] as [AppKitNetwork, ...AppKitNetwork[]];

export const queryClient = new QueryClient();

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: "Only Up",
    description: "Bounty Hook v4 launch terminal",
    url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
    icons: []
  },
  features: {
    analytics: false,
    email: false,
    socials: false
  }
});
