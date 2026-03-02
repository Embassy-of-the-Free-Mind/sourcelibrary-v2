// Demo / Spectator mode — AI plays both sides with commentary
// Each move is narrated with explanations and primary source citations

'use client';

import { useReducer, useState, useEffect, useRef, useCallback } from 'react';
import { GameState, GameAction, Player, MoveRecord } from '@/lib/rithmomachia/types';
import { gameReducer, createInitialState } from '@/lib/rithmomachia/game-state';
import { getHeuristicMove, getHeuristicCaptureDecision } from '@/lib/rithmomachia/ai/heuristic';
import { getOpeningCommentary, getMoveCommentary, getVictoryCommentary } from '@/lib/rithmomachia/commentary';
import { sourceUrl, sourceLabel, SourceKey } from '@/lib/rithmomachia/sources';
import Board from './Board';
import ScorePanel from './ScorePanel';

interface DemoModeProps {
  onExit: () => void;
}

interface CommentaryEntry {
  text: string;
  sourceRef?: { label: string; url: string };
  highlight?: string;
  moveIndex: number;
}

const MOVE_DELAY = 2500; // ms between moves
const CAPTURE_DELAY = 1500; // ms before capture decision

export default function DemoMode({ onExit }: DemoModeProps) {
  const [state, dispatch] = useReducer(gameReducer, createInitialState('hotseat', 'medium'));
  const [commentary, setCommentary] = useState<CommentaryEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1); // 0.5x, 1x, 2x
  const moveCountRef = useRef(0);
  const commentaryEndRef = useRef<HTMLDivElement>(null);
  const maxMoves = 60; // cap demo length

  // Add opening commentary on mount
  useEffect(() => {
    const opening = getOpeningCommentary();
    setCommentary([{ ...opening, moveIndex: -1 }]);
  }, []);

  // Auto-scroll commentary
  useEffect(() => {
    commentaryEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [commentary]);

  // AI plays both sides
  useEffect(() => {
    if (paused) return;
    if (state.phase === 'victory' || state.phase === 'gameover') return;
    if (moveCountRef.current >= maxMoves) {
      // End demo after max moves
      setCommentary(prev => [...prev, {
        text: `The demonstration ends after ${maxMoves} moves. In a full game, play continues until one side achieves a common or philosophical victory. Click "Play Now" to try the game yourself.`,
        moveIndex: moveCountRef.current,
      }]);
      return;
    }

    const delay = state.phase === 'capture' ? CAPTURE_DELAY / speed : MOVE_DELAY / speed;

    const timer = setTimeout(() => {
      if (state.phase === 'select') {
        const actions = getHeuristicMove(state);
        for (const action of actions) {
          dispatch(action);
        }

        // Commentary will be added in the MOVE_PIECE effect via move history
        moveCountRef.current++;
      } else if (state.phase === 'capture') {
        const action = getHeuristicCaptureDecision(state);
        dispatch(action);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [state.currentPlayer, state.phase, paused, speed]);

  // Generate commentary when move history changes
  useEffect(() => {
    const moves = state.moveHistory;
    if (moves.length === 0) return;

    const lastMove = moves[moves.length - 1];
    const moveIndex = moves.length - 1;

    // Only add commentary for new moves
    if (commentary.some(c => c.moveIndex === moveIndex)) return;

    const newComments = getMoveCommentary(lastMove, state, moveIndex);
    setCommentary(prev => [
      ...prev,
      ...newComments.map(c => ({ ...c, moveIndex })),
    ]);
  }, [state.moveHistory.length]);

  // Victory commentary
  useEffect(() => {
    if (state.victory) {
      const vc = getVictoryCommentary(state.victory.type, state.victory.player);
      setCommentary(prev => [...prev, { ...vc, moveIndex: state.moveHistory.length }]);
    }
  }, [state.victory]);

  const evenOnBoard = state.pieces.filter(p => p.owner === 'even').length;
  const oddOnBoard = state.pieces.filter(p => p.owner === 'odd').length;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-block bg-accent-rust/10 text-accent-rust px-3 py-1 rounded-full text-sm font-medium mb-2">
          Demonstration Game
        </div>
        <h1 className="font-serif text-3xl md:text-4xl text-primary mb-1">Rithmomachia</h1>
        <p className="text-muted text-sm">
          Watch two AI opponents play while learning the rules from five primary sources (1496&ndash;1616)
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Board area */}
        <div>
          {/* Current player indicator */}
          <div className="text-center text-sm text-muted mb-2">
            Turn {state.turnNumber} &mdash;{' '}
            {state.victory ? (
              <span className="text-accent-rust font-medium">Game Over</span>
            ) : moveCountRef.current >= maxMoves ? (
              <span className="text-accent-rust font-medium">Demo Complete</span>
            ) : (
              <>
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full mr-1"
                  style={{
                    backgroundColor: state.currentPlayer === 'even' ? '#fdfcf9' : '#2a2320',
                    border: '1px solid var(--border-medium)',
                  }}
                />
                {state.currentPlayer === 'even' ? 'Even (White)' : 'Odd (Black)'}
                {state.phase === 'capture' && (
                  <span className="text-accent-gold ml-1">evaluating capture...</span>
                )}
              </>
            )}
          </div>

          <Board
            state={state}
            onCellClick={() => {}} // no interaction in demo mode
          />

          {/* Controls */}
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={() => setPaused(p => !p)}
              className="px-4 py-2 text-sm border border-border-light rounded-lg hover:bg-warm transition-colors"
              disabled={state.victory !== null || moveCountRef.current >= maxMoves}
            >
              {paused ? '\u25B6 Resume' : '\u23F8 Pause'}
            </button>

            <select
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              className="px-3 py-2 text-sm border border-border-light rounded-lg bg-white"
            >
              <option value={0.5}>0.5x Speed</option>
              <option value={1}>1x Speed</option>
              <option value={2}>2x Speed</option>
            </select>

            <button
              onClick={onExit}
              className="px-4 py-2 text-sm bg-accent-rust text-white rounded-lg hover:bg-accent-rust/90 transition-colors"
            >
              Play Now
            </button>
          </div>
        </div>

        {/* Commentary sidebar */}
        <div className="space-y-4">
          <ScorePanel
            capturedPieces={state.capturedPieces}
            piecesOnBoard={{ even: evenOnBoard, odd: oddOnBoard }}
          />

          {/* Commentary feed */}
          <div className="bg-warm rounded-lg border border-border-light">
            <div className="px-3 py-2 border-b border-border-light">
              <div className="text-sm font-medium">Commentary</div>
              <div className="text-xs text-muted">Move explanations with source citations</div>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-3 space-y-3">
              {commentary.map((entry, i) => (
                <div key={i} className="text-sm">
                  {entry.highlight && (
                    <div className="text-xs font-medium text-accent-gold-dark mb-0.5">
                      {entry.highlight}
                    </div>
                  )}
                  <p className="font-body text-secondary leading-relaxed">
                    {entry.text}
                  </p>
                  {entry.sourceRef && (
                    <a
                      href={entry.sourceRef.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-1 text-xs text-accent-rust hover:underline"
                    >
                      {entry.sourceRef.label} &rarr;
                    </a>
                  )}
                </div>
              ))}
              <div ref={commentaryEndRef} />
            </div>
          </div>

          {/* Source books */}
          <div className="bg-warm rounded-lg border border-border-light p-3 text-xs text-muted space-y-1">
            <div className="font-medium text-sm text-secondary mb-1">Primary Sources</div>
            <SourceLink source="jordanus" />
            <SourceLink source="boissiere" />
            <SourceLink source="lever" />
            <SourceLink source="barozzi" />
            <SourceLink source="selenus" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceLink({ source }: { source: SourceKey }) {
  const { author, year, language, shortTitle, slug } = {
    jordanus: { author: 'Jordanus / Lefèvre', year: 1496, language: 'Latin', shortTitle: 'Rithmimachie Ludus', slug: 'arithmetica-decem-libris-demonstrata-with-rithmimachie-ludus-stapulensis' },
    boissiere: { author: 'Boissière', year: 1554, language: 'French', shortTitle: 'Le Jeu Pythagorique', slug: 'le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere' },
    lever: { author: 'Lever & Fulke', year: 1563, language: 'English', shortTitle: 'The Learned Playe', slug: 'the-most-noble-auncient-and-learned-playe-called-the-fulke' },
    barozzi: { author: 'Barozzi', year: 1572, language: 'Italian', shortTitle: 'Il Giuoco Pythagoreo', slug: 'il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi' },
    selenus: { author: 'Selenus', year: 1616, language: 'German', shortTitle: 'Das Schach-Spiel', slug: 'the-game-of-chess-gustavus-selenus' },
  }[source];

  return (
    <a
      href={`https://sourcelibrary.org/book/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 hover:text-secondary transition-colors"
    >
      <span className="text-accent-rust/60 w-4">{language.slice(0, 2)}</span>
      <span>{author} ({year})</span>
      <span className="text-muted/50 italic">{shortTitle}</span>
    </a>
  );
}
