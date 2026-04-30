interface CandleStackProps {
  height?: number;
}

const STEPS = [
  { open: 18, close: 26 },
  { open: 24, close: 34 },
  { open: 32, close: 30 },
  { open: 30, close: 42 },
  { open: 40, close: 52 },
  { open: 50, close: 62 },
  { open: 60, close: 58 },
  { open: 58, close: 72 },
  { open: 70, close: 84 },
  { open: 82, close: 96 }
];

export function RisingChart({ height = 130 }: CandleStackProps) {
  const padding = 14;
  const width = 800;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const max = 100;
  const candleWidth = innerW / STEPS.length;
  const bodyWidth = candleWidth * 0.55;

  return (
    <div className="candle-stack" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <g className="grid">
          <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} />
          <line x1="0" y1={height * 0.5}  x2={width} y2={height * 0.5} />
          <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} />
        </g>

        {STEPS.map((c, i) => {
          const cx = padding + candleWidth * (i + 0.5);
          const top = Math.min(c.open, c.close);
          const bottom = Math.max(c.open, c.close);
          const wickTop = bottom + 8 > max ? max : bottom + 6;
          const wickBottom = Math.max(top - 6, 0);
          const yTop = padding + innerH - (bottom / max) * innerH;
          const yBottom = padding + innerH - (top / max) * innerH;
          const yWickTop = padding + innerH - (wickTop / max) * innerH;
          const yWickBottom = padding + innerH - (wickBottom / max) * innerH;
          return (
            <g key={i} style={{ animationDelay: `${i * 90}ms` } as React.CSSProperties}>
              <line
                className="candle-wick"
                x1={cx} y1={yWickTop}
                x2={cx} y2={yWickBottom}
              />
              <rect
                className="candle-body"
                x={cx - bodyWidth / 2}
                y={yTop}
                width={bodyWidth}
                height={Math.max(yBottom - yTop, 2)}
                rx="2"
                style={{ animationDelay: `${i * 90}ms` } as React.CSSProperties}
              />
            </g>
          );
        })}

        <circle
          className="candle-blip"
          cx={padding + candleWidth * (STEPS.length - 0.5)}
          cy={padding + innerH - (((STEPS[STEPS.length - 1]?.close ?? 96)) / max) * innerH}
          r="5"
          style={{ animationDelay: `${STEPS.length * 90 + 200}ms` } as React.CSSProperties}
        />
      </svg>
    </div>
  );
}
