// Move history — scrollable log of moves played

import { MoveRecord } from '@/lib/rithmomachia/types';

interface MoveHistoryProps {
  moves: MoveRecord[];
}

const SHAPE_SYMBOLS: Record<string, string> = {
  circle: '\u25CB',
  triangle: '\u25B3',
  square: '\u25A1',
  pyramid: '\u25B2',
};

export default function MoveHistory({ moves }: MoveHistoryProps) {
  if (moves.length === 0) {
    return (
      <div className="text-sm text-muted italic">No moves yet</div>
    );
  }

  return (
    <div className="max-h-48 overflow-y-auto text-xs font-mono space-y-0.5">
      {moves.map((move, i) => {
        const symbol = SHAPE_SYMBOLS[move.piece.shape] || '?';
        const from = `${String.fromCharCode(97 + move.from.col)}${move.from.row + 1}`;
        const to = `${String.fromCharCode(97 + move.to.col)}${move.to.row + 1}`;
        const playerColor = move.player === 'even' ? '#fdfcf9' : '#2a2320';

        return (
          <div key={i} className="flex items-center gap-1.5 py-0.5">
            <span className="text-muted w-6 text-right">{move.turn}.</span>
            <span
              className="w-3 h-3 rounded-full inline-block shrink-0 border"
              style={{ backgroundColor: playerColor, borderColor: 'var(--border-medium)' }}
            />
            <span>{symbol}{move.piece.value}</span>
            <span className="text-muted">{from}</span>
            <span className="text-muted">&rarr;</span>
            <span>{to}</span>
            {move.capture && (
              <span className="text-accent-gold-dark">
                x{move.capture.captured.map(c => c.value).join(',')}
                <span className="text-muted ml-0.5">({move.capture.method})</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
