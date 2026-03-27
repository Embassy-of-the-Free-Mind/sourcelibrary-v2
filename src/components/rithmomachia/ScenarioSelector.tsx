'use client';

import { useState, useCallback } from 'react';
import { SCENARIOS, SCENARIO_CATEGORIES, Scenario, ScenarioCategory } from '@/lib/rithmomachia/scenarios';
import MiniBoard, { MiniBoardPiece } from './MiniBoard';
import ScenarioPlayer from './ScenarioPlayer';

export default function ScenarioSelector() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [key, setKey] = useState(0); // force re-mount on reset

  const selectedScenario = selectedId ? SCENARIOS.find(s => s.id === selectedId) : null;

  const handleBack = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleNext = useCallback(() => {
    if (!selectedId) return;
    const idx = SCENARIOS.findIndex(s => s.id === selectedId);
    if (idx < SCENARIOS.length - 1) {
      setSelectedId(SCENARIOS[idx + 1].id);
      setKey(k => k + 1);
    } else {
      setSelectedId(null);
    }
  }, [selectedId]);

  // Playing a scenario
  if (selectedScenario) {
    return (
      <ScenarioPlayer
        key={`${selectedScenario.id}-${key}`}
        scenario={selectedScenario}
        onBack={handleBack}
        onNext={handleNext}
      />
    );
  }

  // Scenario list
  return (
    <div>
      <div className="text-center mb-10">
        <h1 className="font-serif text-3xl md:text-4xl text-primary mb-2">Strategy Scenarios</h1>
        <p className="text-muted text-sm max-w-lg mx-auto">
          Interactive puzzles from five Renaissance treatises. Each scenario teaches a specific
          capture method, victory formation, or strategic concept &mdash; with citations to the
          original pages.
        </p>
      </div>

      <div className="space-y-10">
        {SCENARIO_CATEGORIES.map(cat => {
          const scenarios = SCENARIOS.filter(s => s.category === cat.key);
          if (scenarios.length === 0) return null;

          return (
            <div key={cat.key}>
              <div className="mb-4">
                <h2 className="font-serif text-xl text-secondary">{cat.label}</h2>
                <p className="text-sm text-muted">{cat.description}</p>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {scenarios.map(scenario => (
                  <ScenarioCard
                    key={scenario.id}
                    scenario={scenario}
                    onClick={() => {
                      setSelectedId(scenario.id);
                      setKey(k => k + 1);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario, onClick }: { scenario: Scenario; onClick: () => void }) {
  const difficultyStars = Array.from({ length: 3 }, (_, i) => i < scenario.difficulty);

  // Convert scenario pieces to MiniBoard format and compute a tight region
  const pieces: MiniBoardPiece[] = scenario.pieces.map(p => ({
    shape: p.shape,
    value: p.value,
    owner: p.owner,
    position: p.position,
  }));

  // Auto-compute region from piece positions with 1-cell padding
  const cols = pieces.map(p => p.position.col);
  const rows = pieces.map(p => p.position.row);
  const region = {
    colStart: Math.max(0, Math.min(...cols) - 1),
    colEnd: Math.min(8, Math.max(...cols) + 2),
    rowStart: Math.max(0, Math.min(...rows) - 1),
    rowEnd: Math.min(16, Math.max(...rows) + 2),
  };

  return (
    <button
      onClick={onClick}
      className="bg-white rounded-lg border border-border-light p-4 hover:border-accent-rust/30 hover:shadow-sm transition-all text-left group"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">{scenario.subtitle}</div>
          <div className="font-serif text-base text-primary group-hover:text-accent-rust transition-colors">
            {scenario.title}
          </div>
        </div>
        <div className="flex gap-0.5 shrink-0">
          {difficultyStars.map((filled, i) => (
            <span key={i} className={`text-xs ${filled ? 'text-accent-gold' : 'text-border-medium'}`}>
              {filled ? '\u2605' : '\u2606'}
            </span>
          ))}
        </div>
      </div>

      <div className="flex justify-center mb-3">
        <MiniBoard
          pieces={pieces}
          region={region}
        />
      </div>

      <p className="text-xs text-muted leading-relaxed line-clamp-2">
        {scenario.description}
      </p>
    </button>
  );
}
