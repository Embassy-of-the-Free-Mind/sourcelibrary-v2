// Score panel — captured pieces and victory progress

import { Piece, Player } from '@/lib/rithmomachia/types';
import { VICTORY_BODIES, VICTORY_GOODS, VICTORY_QUARREL_PIECES, VICTORY_QUARREL_VALUE } from '@/lib/rithmomachia/constants';

interface ScorePanelProps {
  capturedPieces: { even: Piece[]; odd: Piece[] };
  piecesOnBoard: { even: number; odd: number };
}

export default function ScorePanel({ capturedPieces, piecesOnBoard }: ScorePanelProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <PlayerScore
        player="even"
        label="Even (White)"
        captured={capturedPieces.even}
        onBoard={piecesOnBoard.even}
      />
      <PlayerScore
        player="odd"
        label="Odd (Black)"
        captured={capturedPieces.odd}
        onBoard={piecesOnBoard.odd}
      />
    </div>
  );
}

function PlayerScore({
  player, label, captured, onBoard,
}: {
  player: Player; label: string; captured: Piece[]; onBoard: number;
}) {
  const totalValue = captured.reduce((sum, p) => sum + p.value, 0);
  const bgColor = player === 'even' ? '#fdfcf9' : '#2a2320';
  const textColor = player === 'even' ? '#1a1612' : '#fdfcf9';

  return (
    <div className="bg-warm rounded-lg border border-border-light p-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-3 h-3 rounded-full border"
          style={{ backgroundColor: bgColor, borderColor: 'var(--border-medium)' }}
        />
        <span className="text-sm font-medium">{label}</span>
      </div>

      <div className="text-xs text-muted space-y-1">
        <div>On board: {onBoard} pieces</div>
        <div>Captured: {captured.length} pieces</div>
        <div>Captured value: {totalValue}</div>
      </div>

      {/* Victory progress bars */}
      <div className="mt-2 space-y-1">
        <ProgressBar label="Bodies" current={captured.length} target={VICTORY_BODIES} />
        <ProgressBar label="Goods" current={totalValue} target={VICTORY_GOODS} />
      </div>
    </div>
  );
}

function ProgressBar({ label, current, target }: { label: string; current: number; target: number }) {
  const pct = Math.min(100, (current / target) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span>{current}/{target}</span>
      </div>
      <div className="h-1.5 bg-border-light rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: pct >= 100 ? 'var(--status-success)' : 'var(--accent-sage)',
          }}
        />
      </div>
    </div>
  );
}
