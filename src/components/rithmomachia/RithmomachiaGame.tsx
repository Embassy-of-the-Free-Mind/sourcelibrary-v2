'use client';

import { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GameState, GameAction, Position, GameMode, Difficulty, Player } from '@/lib/rithmomachia/types';
import { gameReducer, createInitialState } from '@/lib/rithmomachia/game-state';
import { positionsEqual } from '@/lib/rithmomachia/board';
import { SOURCES, sourceUrl, SourceKey, CONCEPT_SOURCES } from '@/lib/rithmomachia/sources';
import Board from './Board';
import GameControls from './GameControls';
import CapturePanel from './CapturePanel';
import ScorePanel from './ScorePanel';
import MoveHistory from './MoveHistory';
import VictoryModal from './VictoryModal';
import TutorialOverlay from './TutorialOverlay';
import DemoMode from './DemoMode';

// AI imports (lazy — only loaded when needed)
import { getRandomMove, getRandomCaptureDecision } from '@/lib/rithmomachia/ai/random';
import { getHeuristicMove, getHeuristicCaptureDecision } from '@/lib/rithmomachia/ai/heuristic';
import { getMinimaxMove, getMinimaxCaptureDecision } from '@/lib/rithmomachia/ai/minimax';

export default function RithmomachiaGame() {
  const [state, dispatch] = useReducer(gameReducer, createInitialState('vs-ai', 'medium'));
  const [showVictory, setShowVictory] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const aiPlayerRef = useRef<Player>('odd'); // AI plays odd (black) by default

  // Show victory modal when game ends
  useEffect(() => {
    if (state.victory) {
      setShowVictory(true);
    }
  }, [state.victory]);

  // AI turn
  useEffect(() => {
    if (state.mode !== 'vs-ai') return;
    if (state.currentPlayer !== aiPlayerRef.current) return;
    if (state.phase === 'victory') return;

    if (state.phase === 'select') {
      setAiThinking(true);
      const timer = setTimeout(() => {
        const actions = getAiMove(state);
        for (const action of actions) {
          dispatch(action);
        }
        setAiThinking(false);
      }, 400); // Small delay for UX
      return () => clearTimeout(timer);
    }

    if (state.phase === 'capture') {
      const timer = setTimeout(() => {
        const action = getAiCaptureDecision(state);
        dispatch(action);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [state.currentPlayer, state.phase, state.mode]);

  const handleCellClick = useCallback((pos: Position) => {
    if (aiThinking) return;
    if (state.mode === 'vs-ai' && state.currentPlayer === aiPlayerRef.current) return;

    if (state.phase === 'select') {
      dispatch({ type: 'SELECT_PIECE', position: pos });
    } else if (state.phase === 'move') {
      // Check if clicking a legal move target
      if (state.legalMoves.some(m => positionsEqual(m, pos))) {
        dispatch({ type: 'MOVE_PIECE', to: pos });
      } else {
        // Try selecting a different piece, or deselect
        dispatch({ type: 'SELECT_PIECE', position: pos });
      }
    }
  }, [state.phase, state.legalMoves, state.currentPlayer, state.mode, aiThinking]);

  const handleNewGame = useCallback((mode: GameMode, difficulty: Difficulty) => {
    setShowVictory(false);
    aiPlayerRef.current = 'odd';
    dispatch({ type: 'NEW_GAME', mode, difficulty });
  }, []);

  const handleResign = useCallback(() => {
    dispatch({ type: 'RESIGN' });
  }, []);

  const handleCapture = useCallback((index: number) => {
    dispatch({ type: 'EXECUTE_CAPTURE', captureIndex: index });
  }, []);

  const handleSkipCapture = useCallback(() => {
    dispatch({ type: 'SKIP_CAPTURE' });
  }, []);

  // Demo mode takes over the entire view
  if (showDemo) {
    return <DemoMode onExit={() => setShowDemo(false)} />;
  }

  const evenOnBoard = state.pieces.filter(p => p.owner === 'even').length;
  const oddOnBoard = state.pieces.filter(p => p.owner === 'odd').length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="font-serif text-3xl md:text-4xl text-primary mb-2">Rithmomachia</h1>
        <p className="text-muted text-sm">
          The Battle of Numbers &mdash; a mathematical board game played across Europe for six centuries
        </p>
        <div className="flex items-center justify-center gap-4 mt-2">
          <button
            onClick={() => setShowTutorial(true)}
            className="text-sm text-accent-rust hover:underline"
          >
            How to play
          </button>
          <span className="text-border-medium">|</span>
          <button
            onClick={() => setShowDemo(true)}
            className="text-sm text-accent-rust hover:underline"
          >
            Watch a demo
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-6">
        {/* Board area */}
        <div>
          {/* Turn indicator (mobile — above board) */}
          <div className="lg:hidden mb-3">
            <GameControls
              mode={state.mode}
              difficulty={state.difficulty}
              currentPlayer={state.currentPlayer}
              turnNumber={state.turnNumber}
              phase={state.phase}
              onNewGame={handleNewGame}
              onResign={handleResign}
            />
          </div>

          {/* AI thinking indicator */}
          {aiThinking && (
            <div className="text-center text-sm text-muted mb-2 animate-pulse">
              AI is thinking...
            </div>
          )}

          <Board
            state={state}
            onCellClick={handleCellClick}
          />

          {/* Capture panel (below board) */}
          <CapturePanel
            options={state.captureOptions}
            onCapture={handleCapture}
            onSkip={handleSkipCapture}
          />

          {/* Game phase hint */}
          {state.phase === 'select' && !aiThinking && (
            <div className="text-center text-sm text-muted mt-3">
              Select a piece to move
            </div>
          )}
          {state.phase === 'move' && (
            <div className="text-center text-sm text-muted mt-3">
              Click a highlighted square to move, or select a different piece
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Turn indicator (desktop — in sidebar) */}
          <div className="hidden lg:block">
            <GameControls
              mode={state.mode}
              difficulty={state.difficulty}
              currentPlayer={state.currentPlayer}
              turnNumber={state.turnNumber}
              phase={state.phase}
              onNewGame={handleNewGame}
              onResign={handleResign}
            />
          </div>

          <ScorePanel
            capturedPieces={state.capturedPieces}
            piecesOnBoard={{ even: evenOnBoard, odd: oddOnBoard }}
          />

          {/* Move history */}
          <div className="bg-warm rounded-lg border border-border-light p-3">
            <div className="text-sm font-medium mb-2">Move History</div>
            <MoveHistory moves={state.moveHistory} />
          </div>

          {/* Rules quick reference with source links */}
          <div className="bg-warm rounded-lg border border-border-light p-3 text-xs text-muted space-y-1.5">
            <div className="font-medium text-sm text-secondary mb-1">Quick Reference</div>
            <QuickRefLine
              label="Circles"
              desc="move 1 space diagonally"
              conceptKey="circleMovement"
            />
            <QuickRefLine
              label="Triangles"
              desc="leap 2 spaces orthogonally"
              conceptKey="triangleMovement"
            />
            <QuickRefLine
              label="Squares"
              desc="leap 3 spaces orthogonally"
              conceptKey="squareMovement"
            />
            <QuickRefLine
              label="Pyramid"
              desc="moves as all three shapes"
              conceptKey="pyramid"
            />
            <div className="pt-1 border-t border-border-light">
              <span className="font-medium">Captures:</span> equality, addition, subtraction, multiplication, division, siege
            </div>
            <div className="pt-1 flex flex-col gap-1">
              <Link href="/blog/rithmomachia" className="text-accent-rust hover:underline">
                Read the full rules &rarr;
              </Link>
              <SourceLinks />
            </div>
          </div>
        </div>
      </div>

      {/* Victory modal */}
      {showVictory && state.victory && (
        <VictoryModal
          victory={state.victory}
          onNewGame={handleNewGame}
          onClose={() => setShowVictory(false)}
          mode={state.mode}
          difficulty={state.difficulty}
        />
      )}

      {/* Tutorial overlay */}
      {showTutorial && (
        <TutorialOverlay onClose={() => setShowTutorial(false)} />
      )}
    </div>
  );
}

// Quick reference line with source link on the rule description
function QuickRefLine({ label, desc, conceptKey }: { label: string; desc: string; conceptKey: string }) {
  const concept = CONCEPT_SOURCES[conceptKey];
  // Pick the first ref with a page number for the link
  const ref = concept?.refs.find(r => r.page);
  return (
    <div>
      <span className="font-medium">{label}</span> &mdash; {desc}
      {ref && (
        <>
          {' '}
          <a
            href={sourceUrl(ref.source, ref.page)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-rust/60 hover:text-accent-rust"
            title={`${SOURCES[ref.source].author} (${SOURCES[ref.source].year}), p. ${ref.page}`}
          >
            [{SOURCES[ref.source].year}]
          </a>
        </>
      )}
    </div>
  );
}

// Compact list of primary source books
function SourceLinks() {
  const sources: { key: SourceKey; year: number; lang: string }[] = [
    { key: 'jordanus', year: 1496, lang: 'La' },
    { key: 'boissiere', year: 1554, lang: 'Fr' },
    { key: 'lever', year: 1563, lang: 'En' },
    { key: 'barozzi', year: 1572, lang: 'It' },
    { key: 'selenus', year: 1616, lang: 'De' },
  ];

  return (
    <div className="text-xs text-muted/70">
      Sources:{' '}
      {sources.map((s, i) => (
        <span key={s.key}>
          {i > 0 && ' · '}
          <a
            href={sourceUrl(s.key)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-accent-rust transition-colors"
          >
            {s.lang} {s.year}
          </a>
        </span>
      ))}
    </div>
  );
}

// --- AI helpers ---

function getAiMove(state: GameState): GameAction[] {
  switch (state.difficulty) {
    case 'easy':
      return getRandomMove(state);
    case 'medium':
      return getHeuristicMove(state);
    case 'hard':
      return getMinimaxMove(state);
    default:
      return getRandomMove(state);
  }
}

function getAiCaptureDecision(state: GameState): GameAction {
  switch (state.difficulty) {
    case 'easy':
      return getRandomCaptureDecision(state);
    case 'medium':
      return getHeuristicCaptureDecision(state);
    case 'hard':
      return getMinimaxCaptureDecision(state);
    default:
      return getRandomCaptureDecision(state);
  }
}
