interface PressureMeterProps {
  bountyBps: number;
  sellPressureBps: number;
}

export function PressureMeter({ bountyBps, sellPressureBps }: PressureMeterProps) {
  const pressure = Math.min(Math.max(sellPressureBps, 0), 10_000);
  const ratio = pressure / 10_000;
  const bountyPct = (bountyBps / 100).toFixed(2);
  const pressurePct = (pressure / 100).toFixed(1);

  const radius = 70;
  const circumference = Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);

  const angleDeg = -180 + ratio * 180;
  const needleRad = (angleDeg * Math.PI) / 180;
  const cx = 90;
  const cy = 90;
  const nx = cx + Math.cos(needleRad) * (radius - 6);
  const ny = cy + Math.sin(needleRad) * (radius - 6);

  return (
    <div className="gauge">
      <svg className="gauge-svg" viewBox="0 0 180 110" aria-label="Sell pressure gauge">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="#00FF88" />
            <stop offset="55%" stopColor="#FFB347" />
            <stop offset="100%" stopColor="#FF5C7A" />
          </linearGradient>
        </defs>

        <path
          className="gauge-track"
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <path
          className="gauge-fill"
          d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
          fill="none"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />

        <line className="gauge-needle" x1={cx} y1={cy} x2={nx} y2={ny} strokeWidth="3" />
        <circle cx={cx} cy={cy} r="5" fill="#E6FFF1" />

        <text x={cx} y={cy - 22} textAnchor="middle" className="gauge-text" fontSize="20">{pressurePct}%</text>
        <text x={cx} y={cy + 26} textAnchor="middle" className="gauge-label">Sell pressure</text>
      </svg>

      <div className="gauge-meta">
        <span>Dynamic bounty</span>
        <strong>{bountyPct}%</strong>
      </div>
    </div>
  );
}
