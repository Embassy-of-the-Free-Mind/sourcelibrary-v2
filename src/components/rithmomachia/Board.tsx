// SVG board renderer — 8x16 checkered grid with pieces

import { GameState, Position } from '@/lib/rithmomachia/types';
import { BOARD_COLS, BOARD_ROWS, CELL_SIZE } from '@/lib/rithmomachia/constants';
import { positionsEqual, positionKey } from '@/lib/rithmomachia/board';
import Piece from './Piece';

interface BoardProps {
  state: GameState;
  onCellClick: (pos: Position) => void;
}

const WIDTH = BOARD_COLS * CELL_SIZE;
const HEIGHT = BOARD_ROWS * CELL_SIZE;

export default function Board({ state, onCellClick }: BoardProps) {
  const legalMoveSet = new Set(state.legalMoves.map(positionKey));
  const captureTargetSet = new Set(state.captureOptions.map(c => positionKey(c.target)));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full max-w-lg mx-auto border-2 rounded-lg shadow-lg select-none"
      style={{
        borderColor: 'var(--border-medium)',
        backgroundColor: 'var(--bg-warm)',
      }}
    >
      {/* Board squares */}
      {Array.from({ length: BOARD_ROWS }, (_, row) =>
        Array.from({ length: BOARD_COLS }, (_, col) => {
          const isDark = (row + col) % 2 === 1;
          const isLegalMove = legalMoveSet.has(`${col},${row}`);

          return (
            <rect
              key={`${col}-${row}`}
              x={col * CELL_SIZE}
              y={row * CELL_SIZE}
              width={CELL_SIZE}
              height={CELL_SIZE}
              fill={isDark ? '#e8e4dc' : '#f5f0e8'}
              onClick={() => onCellClick({ col, row })}
              style={{ cursor: isLegalMove ? 'pointer' : 'default' }}
            />
          );
        })
      )}

      {/* Midline separator */}
      <line
        x1={0}
        y1={8 * CELL_SIZE}
        x2={WIDTH}
        y2={8 * CELL_SIZE}
        stroke="var(--accent-rust)"
        strokeWidth={2}
        opacity={0.3}
      />

      {/* Legal move indicators */}
      {state.legalMoves.map(pos => (
        <circle
          key={`move-${pos.col}-${pos.row}`}
          cx={pos.col * CELL_SIZE + CELL_SIZE / 2}
          cy={pos.row * CELL_SIZE + CELL_SIZE / 2}
          r={15}
          fill="var(--accent-sage)"
          opacity={0.4}
          onClick={() => onCellClick(pos)}
          style={{ cursor: 'pointer' }}
        />
      ))}

      {/* Capture target indicators */}
      {state.captureOptions.map((cap, i) => (
        <rect
          key={`cap-${i}`}
          x={cap.target.col * CELL_SIZE + 3}
          y={cap.target.row * CELL_SIZE + 3}
          width={CELL_SIZE - 6}
          height={CELL_SIZE - 6}
          rx={4}
          fill="none"
          stroke="var(--accent-gold)"
          strokeWidth={3}
          opacity={0.7}
        />
      ))}

      {/* Pieces — each piece handles its own positioning via CSS transform */}
      {state.pieces.map(piece => (
        <Piece
          key={piece.id}
          piece={piece}
          isSelected={
            state.selectedPiece !== null &&
            positionsEqual(piece.position, state.selectedPiece)
          }
          isCurrentPlayer={piece.owner === state.currentPlayer}
          onClick={() => onCellClick(piece.position)}
        />
      ))}

      {/* Column labels */}
      {Array.from({ length: BOARD_COLS }, (_, i) => (
        <text
          key={`col-${i}`}
          x={i * CELL_SIZE + CELL_SIZE / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize={10}
          fontFamily="var(--font-sans)"
          opacity={0.5}
        >
          {String.fromCharCode(97 + i)}
        </text>
      ))}

      {/* Row labels */}
      {Array.from({ length: BOARD_ROWS }, (_, i) => (
        <text
          key={`row-${i}`}
          x={6}
          y={i * CELL_SIZE + CELL_SIZE / 2 + 4}
          textAnchor="start"
          fill="var(--text-muted)"
          fontSize={10}
          fontFamily="var(--font-sans)"
          opacity={0.4}
        >
          {i + 1}
        </text>
      ))}
    </svg>
  );
}
