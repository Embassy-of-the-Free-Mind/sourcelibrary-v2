"use client";

import { useMoonPhase, useMoonSign, useMoonCycle } from "@/lib/hooks";

/**
 * SVG moon phase disc — shows the illuminated portion accurately.
 * No Three.js, no useLayoutEffect, zero SSR issues.
 */
export function MoonDisplay() {
  const phase = useMoonPhase();
  const sign = useMoonSign();
  const cycle = useMoonCycle();

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  // Build the terminator (shadow boundary) as an SVG path.
  // phase_angle: 0 = new moon, 90 = first quarter, 180 = full, 270 = third quarter
  const angle = phase.phase_angle;
  const illumination = phase.illumination / 100;

  // The terminator is an ellipse: at new/full it matches the circle,
  // at quarters it's a vertical line (ellipse width = 0).
  // k ranges from -1 (new moon, all dark) through 0 (quarter) to +1 (full, all lit)
  const k = Math.cos((angle * Math.PI) / 180);

  // Determine which half is lit
  const waxing = angle < 180;

  // Build the lit-side path using two arcs:
  // 1. A semicircle on the lit side
  // 2. A semi-ellipse (the terminator) connecting back
  const litPath = buildLitPath(cx, cy, r, k, waxing);

  // Next phase info
  const nextPhaseNames = ["New Moon", "First Quarter", "Full Moon", "Third Quarter"];

  return (
    <div className="w-full max-w-sm mx-auto text-center">
      {/* Moon disc */}
      <div className="relative inline-block">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Dark side (base) */}
          <circle cx={cx} cy={cy} r={r} fill="#1a1612" stroke="var(--color-border)" strokeWidth={1} />

          {/* Lit side */}
          <path d={litPath} fill="#e8dcc8" opacity={0.92} />

          {/* Subtle rim highlight */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(201, 168, 108, 0.15)" strokeWidth={1.5} />
        </svg>

        {/* Sun direction indicator */}
        <div
          className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 ${
            waxing ? "right-0 translate-x-[calc(100%+8px)]" : "left-0 -translate-x-[calc(100%+8px)]"
          }`}
        >
          <span className="text-accent-gold text-lg">&#9788;</span>
          <span className="text-faint text-xs">Sun</span>
        </div>
      </div>

      {/* Phase info */}
      <div className="mt-4 space-y-1.5">
        <div className="font-serif text-2xl text-accent-gold">
          {phase.phase_emoji} {phase.phase_name}
        </div>
        <div className="text-sm text-cream">
          {phase.illumination}% illuminated
        </div>
        <div className="text-sm text-muted">
          Day {cycle.moon_age.toFixed(0)} &middot; Moon in {sign.name} {sign.symbol}
        </div>
        {cycle.next_phase && (
          <div className="text-xs text-faint">
            {nextPhaseNames[cycle.next_phase.quarter]} in{" "}
            {cycle.next_phase.days_away < 1
              ? `${Math.round(cycle.next_phase.days_away * 24)}h`
              : `${cycle.next_phase.days_away.toFixed(0)} days`}
          </div>
        )}
      </div>
    </div>
  );
}

/** Build SVG path for the illuminated portion of the moon disc. */
function buildLitPath(cx: number, cy: number, r: number, k: number, waxing: boolean): string {
  const top = cy - r;
  const bottom = cy + r;

  // Semi-circle on the lit side (right if waxing, left if waning)
  // sweepFlag: 1 = clockwise, 0 = counter-clockwise
  const litSweep = waxing ? 1 : 0;

  // Terminator ellipse: the x-radius is |k| * r, y-radius is r
  // When k > 0 (gibbous), terminator curves toward the dark side
  // When k < 0 (crescent), terminator curves into the lit side
  const terminatorRx = Math.abs(k) * r;

  // For the terminator arc, we need to determine sweep direction
  // based on whether moon is crescent or gibbous
  const gibbous = Math.abs(phase_to_illum_check(k)) > 0.5;
  const terminatorSweep = (waxing === gibbous) ? 0 : 1;

  // Path: start at top, semicircle to bottom (lit side), terminator back to top
  return `M ${cx} ${top} A ${r} ${r} 0 0 ${litSweep} ${cx} ${bottom} A ${terminatorRx} ${r} 0 0 ${terminatorSweep} ${cx} ${top}`;
}

function phase_to_illum_check(k: number): number {
  // k = cos(angle): +1 at full, -1 at new
  return (1 + k) / 2;
}
