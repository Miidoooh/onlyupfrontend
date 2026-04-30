"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  to: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
}

function format(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(decimals);
  const parts = fixed.split(".");
  const whole = parts[0] ?? "0";
  const frac = parts[1];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac.replace(/0+$/, "") || "0"}` : grouped;
}

export function CountUp({ to, decimals = 4, duration = 1400, prefix = "", suffix = "" }: CountUpProps) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);
  const targetRef = useRef(to);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = value;
    targetRef.current = to;
    startRef.current = null;

    const reduced = typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setValue(to);
      return;
    }

    let raf = 0;
    const tick = (timestamp: number) => {
      if (startRef.current == null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = fromRef.current + (targetRef.current - fromRef.current) * eased;
      setValue(next);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, duration]);

  return (
    <span>
      {prefix}
      {format(value, decimals)}
      {suffix}
    </span>
  );
}
