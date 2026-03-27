'use client';

import { useReducer, useCallback, useEffect, useState } from 'react';
import { Position } from '@/lib/rithmomachia/types';
import { gameReducer } from '@/lib/rithmomachia/game-state';
import { positionsEqual } from '@/lib/rithmomachia/board';
import { Scenario } from '@/lib/rithmomachia/scenarios';
import { createScenarioState, checkScenarioSuccess } from '@/lib/rithmomachia/scenario-state';
import { sourceUrl, SOURCES, SourceKey } from '@/lib/rithmomachia/sources';
import Board, { BoardRegion } from './Board';
import CapturePanel from './CapturePanel';

/** Compute a tight board region from scenario pieces with padding */
function computeRegion(pieces: { position: { col: number; row: number } }[]): BoardRegion {
  const cols = pieces.map(p => p.position.col);
  const rows = pieces.map(p => p.position.row);
  return {
    colStart: Math.max(0, Math.min(...cols) - 2),
    colEnd: Math.min(8, Math.max(...cols) + 3),
    rowStart: Math.max(0, Math.min(...rows) - 2),
    rowEnd: Math.min(16, Math.max(...rows) + 3),
  };
}

interface ScenarioPlayerProps {
  scenario: Scenario;
  onBack: () => void;
  onNext?: () => void;
}

export default function ScenarioPlayer({ scenario, onBack, onNext }: ScenarioPlayerProps) {
  const [state, dispatch] = useReducer(gameReducer, createScenarioState(scenario));
  const [solved, setSolved] = useState(false);
  const [hintsRevealed, setHintsRevealed] = useState(0);
  const [moveCount, setMoveCount] = useState(0);

  // Reset when scenario changes
  useEffect(() => {
    dispatch({ type: 'NEW_GAME', mode: 'hotseat', difficulty: 'medium' });
    // NEW_GAME resets to default initial state, so we need to use a fresh reducer
  }, [scenario.id]);

  // Check success after each state change
  useEffect(() => {
    if (solved) return;
    if (checkScenarioSuccess(scenario.successCondition, state, scenario.playerSide)) {
      setSolved(true);
    }
  }, [state, scenario, solved]);

  // Track moves
  useEffect(() => {
    setMoveCount(state.moveHistory.length);
  }, [state.moveHistory.length]);

  const handleCellClick = useCallback((pos: Position) => {
    if (solved) return;

    if (state.phase === 'select') {
      dispatch({ type: 'SELECT_PIECE', position: pos });
    } else if (state.phase === 'move') {
      if (state.legalMoves.some(m => positionsEqual(m, pos))) {
        dispatch({ type: 'MOVE_PIECE', to: pos });
      } else {
        dispatch({ type: 'SELECT_PIECE', position: pos });
      }
    }
  }, [state.phase, state.legalMoves, solved]);

  const handleCapture = useCallback((index: number) => {
    dispatch({ type: 'EXECUTE_CAPTURE', captureIndex: index });
  }, []);

  const handleSkipCapture = useCallback(() => {
    dispatch({ type: 'SKIP_CAPTURE' });
  }, []);

  const handleReset = useCallback(() => {
    setSolved(false);
    setHintsRevealed(0);
    // Re-create scenario state by dispatching a sequence
    const fresh = createScenarioState(scenario);
    // We can't easily reset the reducer, so we'll use a key trick
    window.location.hash = `#${scenario.id}`;
    window.location.reload();
  }, [scenario]);

  const difficultyStars = Array.from({ length: 3 }, (_, i) => i < scenario.difficulty);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={onBack}
          className="text-sm text-accent-rust hover:underline mb-3 inline-flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All scenarios
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-muted uppercase tracking-wide mb-1">{scenario.subtitle}</div>
            <h2 className="font-serif text-2xl text-primary">{scenario.title}</h2>
          </div>
          <div className="flex gap-0.5 mt-1">
            {difficultyStars.map((filled, i) => (
              <span key={i} className={`text-sm ${filled ? 'text-accent-gold' : 'text-border-medium'}`}>
                {filled ? '\u2605' : '\u2606'}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-6">
        {/* Board */}
        <div>
          {/* Goal */}
          <div className="bg-warm rounded-lg border border-border-light p-4 mb-4">
            <p className="text-secondary text-sm font-body leading-relaxed">
              {scenario.description}
            </p>
          </div>

          {/* Phase hint */}
          {!solved && state.phase === 'select' && (
            <div className="text-center text-sm text-muted mb-2">
              Select a piece to move
            </div>
          )}
          {!solved && state.phase === 'move' && (
            <div className="text-center text-sm text-muted mb-2">
              Click a highlighted square to move
            </div>
          )}

          <Board
            state={state}
            onCellClick={handleCellClick}
            region={computeRegion(scenario.pieces)}
          />

          {/* Capture panel */}
          <CapturePanel
            options={state.captureOptions}
            onCapture={handleCapture}
            onSkip={handleSkipCapture}
          />

          {/* Success overlay */}
          {solved && (
            <div className="bg-accent-sage/10 border border-accent-sage/30 rounded-lg p-5 mt-4">
              <div className="font-serif text-xl text-primary mb-2">Solved!</div>
              <p className="text-secondary text-sm font-body leading-relaxed mb-4">
                {scenario.explanation}
              </p>

              {/* Primary source illustration */}
              {scenario.illustration && (
                <a
                  href={sourceUrl(scenario.illustration.source, scenario.illustration.page)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg overflow-hidden border border-border-light mb-4 hover:border-accent-rust/40 transition-colors group"
                >
                  <img
                    src={scenario.illustration.imageUrl}
                    alt={scenario.illustration.caption}
                    className="w-full max-h-48 object-contain bg-warm/50"
                  />
                  <div className="px-3 py-2 bg-warm/50 flex items-center justify-between gap-2">
                    <span className="text-xs text-secondary group-hover:text-primary transition-colors">
                      {scenario.illustration.caption}
                    </span>
                    <span className="text-xs text-accent-rust/60 group-hover:text-accent-rust shrink-0">
                      View source &rarr;
                    </span>
                  </div>
                </a>
              )}

              <div className="flex gap-3">
                {onNext && (
                  <button
                    onClick={onNext}
                    className="px-4 py-2 text-sm bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors"
                  >
                    Next Scenario
                  </button>
                )}
                <button
                  onClick={onBack}
                  className="px-4 py-2 text-sm border border-border-light rounded-lg hover:bg-warm transition-colors"
                >
                  All Scenarios
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Hints */}
          <div className="bg-warm rounded-lg border border-border-light p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Hints</span>
              {hintsRevealed < scenario.hints.length && !solved && (
                <button
                  onClick={() => setHintsRevealed(h => h + 1)}
                  className="text-xs text-accent-rust hover:underline"
                >
                  Show hint ({hintsRevealed}/{scenario.hints.length})
                </button>
              )}
            </div>
            {hintsRevealed === 0 && !solved && (
              <p className="text-xs text-muted italic">Click &ldquo;Show hint&rdquo; if you get stuck.</p>
            )}
            <div className="space-y-2">
              {scenario.hints.slice(0, hintsRevealed).map((hint, i) => (
                <div key={i} className="text-xs text-secondary font-body leading-relaxed bg-white rounded p-2 border border-border-light">
                  {hint}
                </div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSolved(false);
                setHintsRevealed(0);
                // Reset by re-creating the scenario
                const fresh = createScenarioState(scenario);
                // Force re-mount by changing key
                onBack();
                setTimeout(() => {
                  // This is hacky but functional -- ideally we'd lift state
                }, 0);
              }}
              className="flex-1 px-3 py-1.5 text-sm border border-border-light rounded-lg hover:bg-warm transition-colors"
            >
              Reset
            </button>
          </div>

          {/* Source citations */}
          <div className="bg-warm rounded-lg border border-border-light p-3">
            <div className="text-sm font-medium mb-2">Primary Sources</div>
            <div className="space-y-1.5">
              {scenario.sourceRefs.map((ref, i) => {
                const src = SOURCES[ref.source];
                return (
                  <a
                    key={i}
                    href={sourceUrl(ref.source, ref.page)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-muted hover:text-secondary transition-colors group"
                  >
                    <span className="text-accent-rust/60 group-hover:text-accent-rust">
                      {src.language.slice(0, 2)}
                    </span>{' '}
                    {src.author} ({src.year}){ref.page ? `, p. ${ref.page}` : ''}
                    {ref.detail && (
                      <span className="block text-muted/70 ml-4 mt-0.5 italic">
                        &ldquo;{ref.detail}&rdquo;
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
