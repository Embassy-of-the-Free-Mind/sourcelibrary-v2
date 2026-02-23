"use client";

import { useMoonPhase } from "@/lib/hooks";
import { PHASE_NAMES } from "@/lib/constants";

export function PhaseWheel({ size = 280 }: { size?: number }) {
  const phase = useMoonPhase();
  const r = size / 2;
  const innerR = r * 0.55;
  const outerR = r * 0.85;
  const pointerR = r * 0.92;

  // Current angle (0 = new moon at top, clockwise)
  const currentAngle = (phase.phase_angle / 360) * Math.PI * 2 - Math.PI / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {/* Background circle */}
      <circle cx={r} cy={r} r={r - 2} fill="none" stroke="var(--color-border)" strokeWidth={1} />

      {/* Phase segments */}
      {PHASE_NAMES.map((p, i) => {
        const startAngle = ((p.min / 360) * Math.PI * 2) - Math.PI / 2;
        const endAngle = ((p.max / 360) * Math.PI * 2) - Math.PI / 2;
        const midAngle = (startAngle + endAngle) / 2;

        const isActive = phase.phase_angle >= p.min && phase.phase_angle < p.max;

        // Arc path
        const x1 = r + innerR * Math.cos(startAngle);
        const y1 = r + innerR * Math.sin(startAngle);
        const x2 = r + outerR * Math.cos(startAngle);
        const y2 = r + outerR * Math.sin(startAngle);
        const x3 = r + outerR * Math.cos(endAngle);
        const y3 = r + outerR * Math.sin(endAngle);
        const x4 = r + innerR * Math.cos(endAngle);
        const y4 = r + innerR * Math.sin(endAngle);

        // Emoji position
        const emojiR = (innerR + outerR) / 2;
        const ex = r + emojiR * Math.cos(midAngle);
        const ey = r + emojiR * Math.sin(midAngle);

        return (
          <g key={i}>
            <path
              d={`M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 0 0 ${x1} ${y1}`}
              fill={isActive ? "rgba(201, 168, 108, 0.2)" : "rgba(255, 255, 255, 0.03)"}
              stroke="var(--color-border)"
              strokeWidth={0.5}
            />
            <text
              x={ex}
              y={ey}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={size * 0.065}
              className="select-none pointer-events-none"
            >
              {p.emoji}
            </text>
          </g>
        );
      })}

      {/* Golden pointer */}
      <circle
        cx={r + pointerR * Math.cos(currentAngle)}
        cy={r + pointerR * Math.sin(currentAngle)}
        r={5}
        fill="var(--color-accent-gold)"
      />
      <line
        x1={r}
        y1={r}
        x2={r + pointerR * Math.cos(currentAngle)}
        y2={r + pointerR * Math.sin(currentAngle)}
        stroke="var(--color-accent-gold)"
        strokeWidth={1.5}
        opacity={0.6}
      />

      {/* Center text */}
      <text
        x={r}
        y={r - 12}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.12}
        className="select-none"
      >
        {phase.phase_emoji}
      </text>
      <text
        x={r}
        y={r + 12}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.042}
        fill="var(--color-muted)"
        fontFamily="var(--font-sans)"
        className="select-none"
      >
        {phase.phase_name}
      </text>
      <text
        x={r}
        y={r + 26}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.035}
        fill="var(--color-faint)"
        fontFamily="var(--font-sans)"
        className="select-none"
      >
        {phase.illumination}%
      </text>
    </svg>
  );
}
