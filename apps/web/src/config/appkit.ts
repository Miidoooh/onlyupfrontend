"use client";

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { sepolia } from "@reown/appkit/networks";
import { QueryClient } from "@tanstack/react-query";

export const projectId = "ae975541a386653f5b6e53354513e427";

export const networks = [sepolia] as [typeof sepolia, ...Array<typeof sepolia>];

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
