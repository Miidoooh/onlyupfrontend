/** Deterministic wallet derivation for the load test. */

import { mnemonicToAccount } from "viem/accounts";
import type { HDAccount } from "viem/accounts";
import { CONFIG } from "./config.js";

export interface TestWallet {
  index: number;
  account: HDAccount;
  address: `0x${string}`;
}

/**
 * Derive `count` wallets from the configured mnemonic using the standard
 * BIP-44 path m/44'/60'/0'/0/i — same path Anvil and most wallets use.
 *
 * Default mnemonic is the canonical Anvil/Hardhat test phrase, so wallets
 * 0..9 will collide with Anvil's pre-funded accounts on a fresh fork.
 * That's intentional — they already have 10000 ETH.
 */
export function deriveWallets(count = CONFIG.walletCount): TestWallet[] {
  const wallets: TestWallet[] = [];
  for (let i = 0; i < count; i++) {
    const account = mnemonicToAccount(CONFIG.mnemonic, { addressIndex: i });
    wallets.push({ index: i, account, address: account.address });
  }
  return wallets;
}
