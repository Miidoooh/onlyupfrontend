interface LogoProps {
  size?: number;
  withWordmark?: boolean;
}

export function Logo({ size = 32, withWordmark = true }: LogoProps) {
  return (
    <span className="nav-brand" aria-label="Only Up">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="28" height="28" rx="8" fill="#00FF88" stroke="#03100A" strokeWidth="2.5" />
        <path
          d="M16 23 L16 11 M11 16 L16 11 L21 16"
          stroke="#03100A"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark ? (
        <span className="word">
          <span>ONLY</span>
          <span className="up">UP</span>
        </span>
      ) : null}
    </span>
  );
}
