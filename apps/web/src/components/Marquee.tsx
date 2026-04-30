interface MarqueeProps {
  items: Array<{ label: string; value?: string }>;
}

export function Marquee({ items }: MarqueeProps) {
  const loop = [...items, ...items];
  return (
    <div className="tape" role="marquee" aria-label="Live status">
      <div className="tape-track">
        {loop.map((item, index) => (
          <span key={`${item.label}-${index}`}>
            {item.label}
            {item.value ? <strong>{item.value}</strong> : null}
            <span className="dot">▲</span>
          </span>
        ))}
      </div>
    </div>
  );
}
