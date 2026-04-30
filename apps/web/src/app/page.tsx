import { formatCompact, formatCompactWei, shortAddress } from "@bounty/shared";
import { BountyPot } from "../components/BountyPot";
import { CopyCA } from "../components/CopyCA";
import { HowItWorks } from "../components/HowItWorks";
import { HunterProfile } from "../components/HunterProfile";
import { LiveDot } from "../components/LiveDot";
import { Logo } from "../components/Logo";
import { Marquee } from "../components/Marquee";
import { PressureMeter } from "../components/PressureMeter";
import { RisingChart } from "../components/RisingChart";
import { V4SwapPanel } from "../components/V4SwapPanel";
import { WalletButton } from "../components/WalletButton";
import { getDashboardData } from "../lib/api";

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}


const FEED_ICONS: Record<string, { className: string; glyph: string; remix?: { title: string; description?: (d: string) => string } }> = {
  BountyOpened:          { className: "warm", glyph: "💰", remix: { title: "BAG ARMED" } },
  BountyFunded:          { className: "warm", glyph: "🐋", remix: { title: "WHALE PAID THE TAX" } },
  BountyPressureUpdated: { className: "warm", glyph: "📈", remix: { title: "BOUNTY PUMPED" } },
  BountyBuyRecorded:     { className: "up",   glyph: "🦍", remix: { title: "APE LOCKED IN" } },
  BountyClaimed:         { className: "up",   glyph: "💸", remix: { title: "PAID OUT" } },
  BountyWindowClosed:    { className: "down", glyph: "✦",  remix: { title: "WINDOW CLOSED" } }
};

function feedIcon(type: string) {
  return FEED_ICONS[type] ?? { className: "warm", glyph: "•" };
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "now";
  const diff = Date.now() - then;
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

const RANK_TITLES = ["🐐 GOAT", "🐋 WHALE", "🦍 APE", "🚀 HUNTER", "▲ HUNTER"];

export default async function Home() {
  const { activeWindows, stats, leaderboard, events, launch, botHealth, pressure } = await getDashboardData();

  const featured = activeWindows[0];
  const bountyPot = asBigInt(featured?.totalBounty ?? stats.totalBountyFunded);
  const qualifyingBuy = asBigInt(featured?.totalQualifyingBuy);
  const endBlock = asBigInt(featured?.endBlock);
  const startBlock = asBigInt(featured?.startBlock);
  const blocks = featured ? Number(endBlock - startBlock) : 0;

  const currentPressure = pressure[0];
  const bountyBps = currentPressure?.bountyBps ?? stats.currentBountyBps;
  const sellPressureBps = currentPressure?.sellPressureBps ?? stats.sellPressureBps;
  const bountyPctLabel = `${(bountyBps / 100).toFixed(2)}%`;

  const totalFunded  = formatCompactWei(asBigInt(stats.totalBountyFunded));
  const totalClaimed = formatCompactWei(asBigInt(stats.totalRewardsClaimed));
  const largestDump  = formatCompactWei(asBigInt(stats.largestDump));

  const tokenSymbol = launch.symbol || "UP";
  const isActive = Boolean(featured);

  return (
    <main className="shell">
      {/* ================= NAV ================= */}
      <nav className="nav" aria-label="Primary">
        <Logo />
        <div className="nav-pills">
          <a className="nav-pill" href="#how">How</a>
          <a className="nav-pill" href="#feed">Feed</a>
          <a className="nav-pill" href="#leaderboard">Top apes</a>
          <a className="nav-pill" href="#tokenomics">Tokenomics</a>
        </div>
        <div className="nav-actions">
          <a className="icon-btn" href="https://t.me/" aria-label="Telegram" target="_blank" rel="noreferrer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.5 4.5 2.6 11.7c-1 .4-1 1.5 0 1.8l4.6 1.4 1.8 5.7c.2.6 1 .8 1.5.3l2.6-2.4 5 3.7c.7.5 1.7.1 1.9-.7l3.3-15c.2-.9-.7-1.7-1.6-1.4z" />
            </svg>
          </a>
          <a className="icon-btn" href="https://x.com/" aria-label="X" target="_blank" rel="noreferrer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2H21l-6.52 7.46L22 22h-6.79l-4.72-6.18L5.05 22H2.29l6.96-7.95L2 2h6.91l4.27 5.66L18.244 2zm-2.38 18h1.74L8.23 4H6.37l9.49 16z" />
            </svg>
          </a>
          <WalletButton />
        </div>
      </nav>

      {/* ================= TICKER TAPE ================= */}
      <Marquee
        items={[
          { label: "ONLY UP", value: tokenSymbol },
          { label: "BAG", value: bountyPctLabel },
          { label: "PRESSURE", value: `${(sellPressureBps / 100).toFixed(1)}%` },
          { label: "WINDOW", value: isActive ? `${blocks} BLOCKS` : "REARMING" },
          { label: "TG", value: botHealth.telegramMode.toUpperCase() },
          { label: "X", value: botHealth.twitterMode.toUpperCase() },
          { label: "MAX BUY", value: "1%" },
          { label: "RUNS ON", value: "v4 HOOK" }
        ]}
      />

      {/* ================= HERO ================= */}
      <section className="hero">
        <div className="panel hero-copy warm">
          <div className="sticker-row">
            <span className="sticker tilt-l">100% DEGEN</span>
            <span className="sticker yellow tilt-r">v4 HOOK</span>
            <span className="sticker dark tilt-l">0% TAX TO TEAM</span>
          </div>

          <h1 className="megamark">
            <span className="only">ONLY</span>
            <span>
              <span className="up">UP</span>
              <span className="arrows" aria-hidden="true">▲</span>
            </span>
          </h1>

          <p className="tagline">
            The only token where <span className="crossout">dumps hurt</span>{" "}
            <strong>dumps print</strong>. Whales sell, the v4 hook skims{" "}
            <strong>{bountyPctLabel}</strong>, the next apes split the bag.
          </p>

          <div className="actions">
            <a className="button huge" href="#tokenomics">
              <span aria-hidden="true">▲</span>
              BUY $UP
            </a>
            <a className="button ghost" href="#how">
              HOW IT PRINTS
            </a>
            <span className="sticker pink tilt-xl" aria-hidden="true">NFA · DYOR</span>
          </div>

          <RisingChart />
        </div>

        <BountyPot
          amountWei={bountyPot}
          symbol={tokenSymbol}
          windowBlocks={blocks}
          qualifyingBuyWei={qualifyingBuy}
          isActive={isActive}
        />
      </section>

      <V4SwapPanel />

      {/* ================= STAT ROW ================= */}
      <section className="stat-row">
        <div className="stat">
          <span className="stat-emoji" aria-hidden="true">🪙</span>
          <span className="label">total funded</span>
          <span className="value">{totalFunded}</span>
        </div>
        <div className="stat">
          <span className="stat-emoji" aria-hidden="true">💸</span>
          <span className="label">paid to apes</span>
          <span className="value">{totalClaimed}</span>
        </div>
        <div className="stat">
          <span className="stat-emoji" aria-hidden="true">🦍</span>
          <span className="label">total apes</span>
          <span className="value">{formatCompact(stats.totalHunters)}</span>
        </div>
        <div className="stat">
          <span className="stat-emoji" aria-hidden="true">🐋</span>
          <span className="label">biggest dump</span>
          <span className="value">{largestDump}</span>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section id="how">
        <HowItWorks bountyBpsLabel={bountyPctLabel} windowBlocks={blocks || 50} />
      </section>

      {/* ================= LIVE PRESSURE ================= */}
      <section className="how panel">
        <div className="how-head">
          <span className="eyebrow"><span className="pip" />Live pressure</span>
          <h2>The bag <span className="accent">grows</span> when sellers cope</h2>
          <p>Net sell pressure tunes the skim live. Capped at 10%, never higher.</p>
        </div>
        <PressureMeter bountyBps={bountyBps} sellPressureBps={sellPressureBps} />
      </section>

      {/* ================= HUNTER ================= */}
      <HunterProfile leaderboard={leaderboard} />

      {/* ================= FEED + LEADERBOARD ================= */}
      <section className="columns">
        <div className="panel feed" id="feed">
          <h2 className="section-title">
            🔴 raid feed
            <span className="badge"><LiveDot label="LIVE" /></span>
          </h2>

          {events.length === 0 ? (
            <div className="empty">
              No on-chain action yet. The terminal is locked, loaded, and waiting for the next dump.
            </div>
          ) : (
            <div className="feed-list">
              {events.slice(0, 10).map((event) => {
                const icon = feedIcon(event.type);
                const title = icon.remix?.title ?? event.title.toUpperCase();
                return (
                  <div className="feed-item" key={event.id}>
                    <span className={`feed-icon ${icon.className}`} aria-hidden="true">
                      {icon.glyph}
                    </span>
                    <div className="feed-body">
                      <strong>{title}</strong>
                      <span>{event.description}</span>
                    </div>
                    <span className="feed-time">{timeAgo(event.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel leaderboard" id="leaderboard">
          <h2 className="section-title">
            🏆 top apes
            <span className="badge">TOP 5</span>
          </h2>
          {leaderboard.length === 0 ? (
            <div className="empty">No apes yet. First buyer takes the GOAT spot.</div>
          ) : (
            <div className="leader-list">
              {leaderboard.slice(0, 5).map((entry, i) => {
                const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
                const title = RANK_TITLES[i] ?? RANK_TITLES[RANK_TITLES.length - 1];
                return (
                  <div className="leader-row" key={entry.wallet}>
                    <span className={`rank ${rankClass}`}>{title}</span>
                    <span className="name">{shortAddress(entry.wallet)}</span>
                    <div className="meta">
                      <strong>{formatCompactWei(asBigInt(entry.totalBought))} {tokenSymbol}</strong>
                      <span>{entry.windowsWon} hunt{entry.windowsWon === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ================= CA + TOKENOMICS ================= */}
      <section id="tokenomics">
        <CopyCA
          address={
            launch.tokenAddress && launch.tokenAddress !== "0x0000000000000000000000000000000000000000"
              ? launch.tokenAddress
              : ""
          }
        />

        <div className="tokenomics">
          <article className="token-tile">
            <span className="check">✓</span>
            <h4>1% MAX BUY</h4>
            <p>No bots, no sniper rugs. Same cap on every wallet.</p>
          </article>
          <article className="token-tile">
            <span className="check">✓</span>
            <h4>1% MAX WALLET</h4>
            <p>Whales can't farm the bag harder than you can.</p>
          </article>
          <article className="token-tile">
            <span className="check">✓</span>
            <h4>0% TAX TO TEAM</h4>
            <p>The skim goes to buyers. Not to a multisig.</p>
          </article>
          <article className="token-tile">
            <span className="check">▲</span>
            <h4>v4 HOOK PRINTS</h4>
            <p>The bounty lives in a Uniswap v4 hook. Fully on-chain.</p>
          </article>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <span><span className="nfa">NFA · DYOR</span> · this is not financial advice, ser</span>
        <span>ONLY UP · v4 HOOK · {launch.tradingEnabled ? "LIVE" : "PRE-LAUNCH"}</span>
      </footer>
    </main>
  );
}
