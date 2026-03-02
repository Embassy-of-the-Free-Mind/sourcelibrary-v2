// Game controls — new game, difficulty selection, resign

import { GameMode, Difficulty, Player } from '@/lib/rithmomachia/types';

interface GameControlsProps {
  mode: GameMode;
  difficulty: Difficulty;
  currentPlayer: Player;
  turnNumber: number;
  phase: string;
  onNewGame: (mode: GameMode, difficulty: Difficulty) => void;
  onResign: () => void;
}

export default function GameControls({
  mode, difficulty, currentPlayer, turnNumber, phase, onNewGame, onResign,
}: GameControlsProps) {
  return (
    <div className="space-y-4">
      {/* Turn indicator */}
      <div className="text-center">
        <div className="text-sm text-muted mb-1">Turn {turnNumber}</div>
        <div className="font-serif text-lg">
          {phase === 'victory' ? (
            <span className="text-accent-rust">Game Over</span>
          ) : (
            <>
              <span
                className="inline-block w-3 h-3 rounded-full mr-2"
                style={{ backgroundColor: currentPlayer === 'even' ? '#fdfcf9' : '#2a2320', border: '1px solid var(--border-medium)' }}
              />
              {currentPlayer === 'even' ? 'Even (White)' : 'Odd (Black)'}
              {phase === 'capture' && (
                <span className="text-accent-gold ml-2 text-sm font-sans">- Capture available!</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mode & difficulty */}
      <div className="flex flex-wrap gap-2 justify-center">
        <select
          value={mode}
          onChange={e => onNewGame(e.target.value as GameMode, difficulty)}
          className="px-3 py-1.5 text-sm border border-border-light rounded-lg bg-white"
        >
          <option value="hotseat">2 Player</option>
          <option value="vs-ai">vs AI</option>
        </select>

        {mode === 'vs-ai' && (
          <select
            value={difficulty}
            onChange={e => onNewGame(mode, e.target.value as Difficulty)}
            className="px-3 py-1.5 text-sm border border-border-light rounded-lg bg-white"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        )}

        <button
          onClick={() => onNewGame(mode, difficulty)}
          className="px-3 py-1.5 text-sm border border-border-light rounded-lg bg-white hover:bg-warm transition-colors"
        >
          New Game
        </button>

        {phase !== 'victory' && (
          <button
            onClick={onResign}
            className="px-3 py-1.5 text-sm border border-border-light rounded-lg text-accent-rust hover:bg-accent-rust/10 transition-colors"
          >
            Resign
          </button>
        )}
      </div>
    </div>
  );
}
