"use client";

import { useMemo } from "react";
import { useAppState } from "@/lib/store";
import { getIlluminationForDate } from "@/lib/astro";

export function MoonHeatmap() {
  const { year } = useAppState();

  const data = useMemo(() => {
    const jan1 = new Date(year, 0, 1);
    const startDay = jan1.getDay(); // 0=Sun
    const daysInYear = (new Date(year + 1, 0, 1).getTime() - jan1.getTime()) / 86400000;

    const cells: Array<{
      date: Date;
      dayOfYear: number;
      illumination: number;
      weekday: number;
      week: number;
    }> = [];

    for (let d = 0; d < daysInYear; d++) {
      const date = new Date(year, 0, 1 + d);
      const weekday = date.getDay();
      const week = Math.floor((d + startDay) / 7);
      // Only compute every day (it's fast enough with astronomy-engine)
      const illumination = getIlluminationForDate(date);
      cells.push({ date, dayOfYear: d, illumination, weekday, week });
    }

    return { cells, weeks: Math.ceil((daysInYear + startDay) / 7) };
  }, [year]);

  const cellSize = 12;
  const gap = 2;
  const labelWidth = 20;
  const svgWidth = labelWidth + data.weeks * (cellSize + gap);
  const svgHeight = 7 * (cellSize + gap) + 20;

  const dayLabels = ["", "Mo", "", "We", "", "Fr", ""];

  return (
    <div className="overflow-x-auto">
      <svg width={svgWidth} height={svgHeight} className="block">
        {/* Day labels */}
        {dayLabels.map((label, i) =>
          label ? (
            <text
              key={i}
              x={0}
              y={i * (cellSize + gap) + cellSize / 2 + 16}
              fontSize={9}
              fill="var(--color-faint)"
              dominantBaseline="central"
              fontFamily="var(--font-sans)"
            >
              {label}
            </text>
          ) : null,
        )}

        {/* Cells */}
        {data.cells.map((cell) => {
          const x = labelWidth + cell.week * (cellSize + gap);
          const y = cell.weekday * (cellSize + gap) + 14;
          // Map illumination to gold opacity
          const opacity = cell.illumination / 100;

          return (
            <rect
              key={cell.dayOfYear}
              x={x}
              y={y}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={`rgba(201, 168, 108, ${0.05 + opacity * 0.85})`}
              stroke="rgba(255,255,255,0.03)"
              strokeWidth={0.5}
            >
              <title>
                {cell.date.toLocaleDateString("en", { month: "short", day: "numeric" })}: {cell.illumination}%
              </title>
            </rect>
          );
        })}

        {/* Month labels along the top */}
        {Array.from({ length: 12 }, (_, m) => {
          const firstOfMonth = new Date(year, m, 1);
          const dayOfYear = Math.floor((firstOfMonth.getTime() - new Date(year, 0, 1).getTime()) / 86400000);
          const startDay = new Date(year, 0, 1).getDay();
          const week = Math.floor((dayOfYear + startDay) / 7);
          return (
            <text
              key={m}
              x={labelWidth + week * (cellSize + gap)}
              y={10}
              fontSize={9}
              fill="var(--color-faint)"
              fontFamily="var(--font-sans)"
            >
              {firstOfMonth.toLocaleDateString("en", { month: "short" })}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
