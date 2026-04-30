"use client";

import { useState } from "react";

interface CopyCAProps {
  address: string;
}

function isValidTokenCa(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr) && !/^0x0{40}$/i.test(addr);
}

export function CopyCA({ address }: CopyCAProps) {
  const [copied, setCopied] = useState(false);

  if (!isValidTokenCa(address)) {
    return (
      <div className="ca-bar">
        <div>
          <span className="ca-label">$UP contract address</span>
          <span className="ca-value" style={{ opacity: 0.85 }}>
            Set <code>BOUNTY_TOKEN_ADDRESS</code> in root <code>.env</code> and restart <code>npm run dev:api</code> /
            rebuild web — never show the bounty core as the token CA.
          </span>
        </div>
      </div>
    );
  }

  async function copy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(address);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  }

  return (
    <div className="ca-bar">
      <div>
        <span className="ca-label">$UP contract address</span>
        <span className="ca-value">{address}</span>
      </div>
      <button className="button copy-btn" onClick={copy}>
        <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
        {copied ? "Copied" : "Copy CA"}
      </button>
    </div>
  );
}
