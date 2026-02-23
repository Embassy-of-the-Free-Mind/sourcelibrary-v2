"use client";

import { useMoonPhase, useMoonSign, useMoonCycle } from "@/lib/hooks";
import { QUARTER_NAMES, QUARTER_EMOJIS } from "@/lib/constants";

export function PhaseCard() {
  const phase = useMoonPhase();
  const sign = useMoonSign();
  const cycle = useMoonCycle();

  return (
    <div className="bg-bg-card border border-border rounded-xl p-6">
      <div className="text-center mb-4">
        <div className="text-6xl mb-2">{phase.phase_emoji}</div>
        <h2 className="font-serif text-2xl font-semibold">{phase.phase_name}</h2>
        <p className="text-muted text-sm mt-1">
          {phase.illumination}% illuminated &middot; {phase.trend}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="bg-bg-dark/50 rounded-lg p-3">
          <div className="text-faint text-xs uppercase tracking-wider mb-1">Moon Age</div>
          <div className="text-cream font-medium">{phase.moon_age} days</div>
        </div>
        <div className="bg-bg-dark/50 rounded-lg p-3">
          <div className="text-faint text-xs uppercase tracking-wider mb-1">Moon Sign</div>
          <div className="text-cream font-medium">
            {sign.symbol} {sign.name}
          </div>
        </div>
        <div className="bg-bg-dark/50 rounded-lg p-3">
          <div className="text-faint text-xs uppercase tracking-wider mb-1">Element</div>
          <div className="text-cream font-medium">{sign.element}</div>
        </div>
        <div className="bg-bg-dark/50 rounded-lg p-3">
          <div className="text-faint text-xs uppercase tracking-wider mb-1">Cycle Progress</div>
          <div className="text-cream font-medium">{cycle.progress}%</div>
        </div>
      </div>

      {cycle.next_phase && (
        <div className="mt-4 pt-4 border-t border-border text-sm text-muted">
          Next: {QUARTER_EMOJIS[cycle.next_phase.quarter]} {QUARTER_NAMES[cycle.next_phase.quarter]} in{" "}
          <span className="text-accent-gold">{cycle.next_phase.days_away} days</span>
        </div>
      )}
    </div>
  );
}
