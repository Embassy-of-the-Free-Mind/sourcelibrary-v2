"use client";

import { useMemo } from "react";
import { useAppState } from "@/lib/store";
import { computeDriftData, findBirthLunation, compute13MonthCalendar } from "@/lib/astro";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function DriftChart() {
  const { birthDate } = useAppState();

  const data = useMemo(() => {
    if (!birthDate) return null;

    const birth = new Date(birthDate);
    const birthYear = birth.getFullYear();
    const birthInfo = findBirthLunation(birth);
    if (!birthInfo) return null;

    const driftData = computeDriftData(birthYear, birth, birthInfo.lunarDay, birthInfo.lunationIndex);
    return driftData;
  }, [birthDate]);

  if (!birthDate) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-muted">Enter your birth date to see the 19-year Metonic cycle drift.</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-muted">Could not compute drift data for this date.</p>
      </div>
    );
  }

  const barHeight = 22;
  const gap = 3;
  const labelWidth = 55;
  const monthWidth = 50;
  const svgWidth = labelWidth + 12 * monthWidth;
  const svgHeight = data.length * (barHeight + gap) + 40;

  return (
    <div className="overflow-x-auto">
      <svg width={svgWidth} height={svgHeight} className="block">
        {/* Month labels */}
        {MONTHS.map((m, i) => (
          <text
            key={m}
            x={labelWidth + i * monthWidth + monthWidth / 2}
            y={14}
            textAnchor="middle"
            fontSize={10}
            fill="var(--color-faint)"
            fontFamily="var(--font-sans)"
          >
            {m}
          </text>
        ))}

        {/* Year rows */}
        {data.map((row, i) => {
          const y = 24 + i * (barHeight + gap);
          const isBirthYear = row.isCurrent;

          // Extract month/day from row.date
          const gregMonth = row.date.getMonth(); // 0-indexed
          const gregDay = row.date.getDate();

          // Map month/day to x position
          const startX = labelWidth + (gregMonth * monthWidth) + ((gregDay - 1) / 30) * monthWidth;
          const barWidth = Math.max((29.5 / 365) * 12 * monthWidth, 20);

          return (
            <g key={i}>
              {/* Year label */}
              <text
                x={labelWidth - 8}
                y={y + barHeight / 2 + 1}
                textAnchor="end"
                fontSize={11}
                fill={isBirthYear ? "var(--color-accent-gold)" : "var(--color-muted)"}
                fontWeight={isBirthYear ? 600 : 400}
                fontFamily="var(--font-sans)"
                dominantBaseline="central"
              >
                {row.year}
              </text>

              {/* Lunation bar */}
              <rect
                x={startX}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={4}
                fill={row.hasLeap ? "var(--color-accent-violet)" : "var(--color-accent-gold)"}
                opacity={isBirthYear ? 0.9 : 0.4}
              />

              {/* Gregorian date label */}
              <text
                x={startX + barWidth + 6}
                y={y + barHeight / 2 + 1}
                fontSize={9}
                fill="var(--color-faint)"
                fontFamily="var(--font-sans)"
                dominantBaseline="central"
              >
                {MONTHS[gregMonth]} {gregDay}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex items-center gap-4 mt-3 text-xs text-faint">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "var(--accent-gold)", opacity: 0.6 }} />
          Normal year
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: "var(--accent-violet)", opacity: 0.6 }} />
          Leap year (13 months)
        </span>
      </div>
    </div>
  );
}
