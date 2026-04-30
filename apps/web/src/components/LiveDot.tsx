interface LiveDotProps {
  label?: string;
}

export function LiveDot({ label = "Live on chain" }: LiveDotProps) {
  return (
    <span className="live-dot">
      <span className="blob" aria-hidden="true" />
      {label}
    </span>
  );
}
