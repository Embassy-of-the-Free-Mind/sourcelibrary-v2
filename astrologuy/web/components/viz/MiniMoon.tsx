"use client";

import * as Astronomy from "astronomy-engine";
import { buildLitPath } from "@/lib/astro";

interface MiniMoonProps {
  date: Date;
  size?: number;
  glow?: boolean;
  className?: string;
}

/**
 * Small SVG moon disc showing accurate phase shape for any date.
 * Computes illumination + phase angle inline — no hooks needed.
 */
export function MiniMoon({ date, size = 20, glow = false, className }: MiniMoonProps) {
  const angle = Astronomy.MoonPhase(date);
  const k = Math.cos((angle * Math.PI) / 180);
  const waxing = angle < 180;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  const litPath = buildLitPath(cx, cy, r, k, waxing);

  const filterId = glow ? `moon-glow-${size}` : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      {glow && (
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={size * 0.12} result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
      )}
      <g filter={glow ? `url(#${filterId})` : undefined}>
        <circle cx={cx} cy={cy} r={r} fill="#1a1612" />
        <path d={litPath} fill="#e8dcc8" opacity={0.92} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(201,168,108,0.2)" strokeWidth={0.5} />
      </g>
    </svg>
  );
}
