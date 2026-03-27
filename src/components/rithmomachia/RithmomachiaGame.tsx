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
  const [rulesExpanded, setRulesExpanded] = useState(true);
  const aiPlayerRef = useRef<Player>('odd'); // AI plays odd (black) by default

  // Show victory modal when game ends
  useEffect(() => {
    if (state.victory) {
      setShowVictory(true);
    }
  }, [state.victory]);

  // Collapse rules after first capture (user has the basics)
  useEffect(() => {
    const totalCaptured = state.capturedPieces.even.length + state.capturedPieces.odd.length;
    if (totalCaptured > 0) setRulesExpanded(false);
  }, [state.capturedPieces.even.length, state.capturedPieces.odd.length]);

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
    setRulesExpanded(true);
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
          <Link href="/rithmomachia/guide" className="text-sm text-accent-rust hover:underline">
            Visual guide
          </Link>
          <span className="text-border-medium">|</span>
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
          <span className="text-border-medium">|</span>
          <Link href="/rithmomachia/scenarios" className="text-sm text-accent-rust hover:underline">
            Strategy scenarios
          </Link>
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

          {/* How to Play — prominent, collapsible */}
          <div className="bg-warm rounded-lg border border-border-light overflow-hidden">
            <button
              onClick={() => setRulesExpanded(r => !r)}
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-cream/50 transition-colors"
            >
              <span className="text-sm font-medium text-secondary">How to Play</span>
              <span className="text-muted text-xs">{rulesExpanded ? '\u25B2' : '\u25BC'}</span>
            </button>

            {rulesExpanded && (
              <div className="px-3 pb-3 space-y-3 text-sm border-t border-border-light pt-2">
                {/* Objective */}
                <div>
                  <div className="font-medium text-secondary text-xs uppercase tracking-wide mb-1">Objective</div>
                  <p className="text-muted leading-snug">
                    Capture 15 enemy pieces <em>or</em> pieces worth 200+ points.
                  </p>
                </div>

                {/* Turn flow */}
                <div>
                  <div className="font-medium text-secondary text-xs uppercase tracking-wide mb-1">Each Turn</div>
                  <ol className="text-muted leading-snug space-y-0.5 list-decimal list-inside">
                    <li>Select one of your pieces</li>
                    <li>Move it to a highlighted square</li>
                    <li>If a capture is possible, you&apos;ll be prompted</li>
                  </ol>
                </div>

                {/* Movement */}
                <div>
                  <div className="font-medium text-secondary text-xs uppercase tracking-wide mb-1">Movement</div>
                  <div className="text-muted leading-snug space-y-0.5">
                    <div><span className="font-medium">Circles</span> &mdash; 1 space, diagonally</div>
                    <div><span className="font-medium">Triangles</span> &mdash; 2 spaces, straight line</div>
                    <div><span className="font-medium">Squares</span> &mdash; 3 spaces, straight line</div>
                    <div><span className="font-medium">Pyramid</span> &mdash; moves as all three</div>
                  </div>
                </div>

                {/* Capture — the key missing info */}
                <div>
                  <div className="font-medium text-secondary text-xs uppercase tracking-wide mb-1">How Captures Work</div>
                  <p className="text-muted leading-snug mb-1">
                    You don&apos;t land on enemies. After moving, the game checks if your pieces can
                    capture an adjacent enemy by matching its value:
                  </p>
                  <div className="text-muted leading-snug space-y-0.5 text-xs">
                    <div><span className="font-medium">Equality</span> &mdash; your piece = enemy&apos;s value</div>
                    <div><span className="font-medium">Addition</span> &mdash; two of your pieces sum to enemy&apos;s value</div>
                    <div><span className="font-medium">Subtraction</span> &mdash; difference of two of your pieces = enemy</div>
                    <div><span className="font-medium">Multiplication</span> &mdash; your piece &times; distance = enemy</div>
                    <div><span className="font-medium">Division</span> &mdash; your piece &divide; distance = enemy</div>
                    <div><span className="font-medium">Siege</span> &mdash; enemy surrounded on all sides</div>
                  </div>
                </div>

                <div className="pt-1 border-t border-border-light flex flex-col gap-1 text-xs">
                  <Link href="/rithmomachia/guide" className="text-accent-rust hover:underline">
                    Visual guide with diagrams &rarr;
                  </Link>
                  <button
                    onClick={() => setShowTutorial(true)}
                    className="text-accent-rust hover:underline text-left"
                  >
                    Interactive tutorial &rarr;
                  </button>
                  <Link href="/blog/rithmomachia" className="text-accent-rust hover:underline">
                    Full rules with primary sources &rarr;
                  </Link>
                </div>
              </div>
            )}
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

          {/* Source books — compact */}
          <div className="bg-warm rounded-lg border border-border-light p-3 text-xs text-muted">
            <div className="font-medium text-sm text-secondary mb-1">Primary Sources</div>
            <SourceLinks />
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

// Compact list of primary source books
function SourceLinks() {
  const sources: { key: SourceKey; year: number; lang: string; author: string }[] = [
    { key: 'jordanus', year: 1496, lang: 'La', author: 'Jordanus / Lefèvre' },
    { key: 'boissiere', year: 1554, lang: 'Fr', author: 'Boissière' },
    { key: 'lever', year: 1563, lang: 'En', author: 'Lever & Fulke' },
    { key: 'barozzi', year: 1572, lang: 'It', author: 'Barozzi' },
    { key: 'selenus', year: 1616, lang: 'De', author: 'Selenus' },
  ];

  return (
    <div className="space-y-0.5">
      {sources.map(s => (
        <a
          key={s.key}
          href={sourceUrl(s.key)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-secondary transition-colors"
        >
          <span className="text-accent-rust/60 w-4">{s.lang}</span>
          <span>{s.author} ({s.year})</span>
        </a>
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
