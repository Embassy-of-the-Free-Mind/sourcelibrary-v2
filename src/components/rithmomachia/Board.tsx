// SVG board renderer — 8x16 checkered grid with pieces
// Visual style inspired by the Selenus (1616) copperplate engraving

import { GameState, Position } from '@/lib/rithmomachia/types';
import { BOARD_COLS, BOARD_ROWS, CELL_SIZE } from '@/lib/rithmomachia/constants';
import { positionsEqual, positionKey } from '@/lib/rithmomachia/board';
import Piece, { PieceDefs } from './Piece';

interface BoardProps {
  state: GameState;
  onCellClick: (pos: Position) => void;
}

const WIDTH = BOARD_COLS * CELL_SIZE;
const HEIGHT = BOARD_ROWS * CELL_SIZE;
const BORDER = 6;

export default function Board({ state, onCellClick }: BoardProps) {
  const legalMoveSet = new Set(state.legalMoves.map(positionKey));
  const captureTargetSet = new Set(state.captureOptions.map(c => positionKey(c.target)));

  return (
    <svg
      viewBox={`${-BORDER} ${-BORDER} ${WIDTH + BORDER * 2} ${HEIGHT + BORDER * 2}`}
      className="w-full max-w-lg mx-auto select-none"
      style={{ backgroundColor: '#f5f0e8' }}
    >
      <defs>
        {/* Hatching pattern for light squares — fine diagonal lines like an engraving */}
        <pattern id="board-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#1a1612" strokeWidth="0.5" opacity="0.08" />
        </pattern>
        {/* Piece hatching patterns */}
        <PieceDefs />
      </defs>

      {/* Board frame — double border like a printed plate */}
      <rect
        x={-BORDER}
        y={-BORDER}
        width={WIDTH + BORDER * 2}
        height={HEIGHT + BORDER * 2}
        fill="none"
        stroke="#1a1612"
        strokeWidth={3}
      />
      <rect
        x={-1}
        y={-1}
        width={WIDTH + 2}
        height={HEIGHT + 2}
        fill="none"
        stroke="#1a1612"
        strokeWidth={1}
      />

      {/* Board squares — high contrast like the copperplate */}
      {Array.from({ length: BOARD_ROWS }, (_, row) =>
        Array.from({ length: BOARD_COLS }, (_, col) => {
          const isDark = (row + col) % 2 === 1;
          const isLegalMove = legalMoveSet.has(`${col},${row}`);

          return (
            <g key={`${col}-${row}`}>
              <rect
                x={col * CELL_SIZE}
                y={row * CELL_SIZE}
                width={CELL_SIZE}
                height={CELL_SIZE}
                fill={isDark ? '#2a2320' : '#f0ebe0'}
                onClick={() => onCellClick({ col, row })}
                style={{ cursor: isLegalMove ? 'pointer' : 'default' }}
              />
              {/* Subtle texture on light squares */}
              {!isDark && (
                <rect
                  x={col * CELL_SIZE}
                  y={row * CELL_SIZE}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  fill="url(#board-hatch)"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })
      )}

      {/* Midline separator — thin engraved line */}
      <line
        x1={0}
        y1={8 * CELL_SIZE}
        x2={WIDTH}
        y2={8 * CELL_SIZE}
        stroke="#9e4a3a"
        strokeWidth={1.5}
        opacity={0.4}
      />

      {/* Legal move indicators */}
      {state.legalMoves.map(pos => (
        <circle
          key={`move-${pos.col}-${pos.row}`}
          cx={pos.col * CELL_SIZE + CELL_SIZE / 2}
          cy={pos.row * CELL_SIZE + CELL_SIZE / 2}
          r={15}
          fill="var(--accent-sage)"
          opacity={0.5}
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

      {/* Pieces */}
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

      {/* Column labels — serif like the engraving */}
      {Array.from({ length: BOARD_COLS }, (_, i) => (
        <text
          key={`col-${i}`}
          x={i * CELL_SIZE + CELL_SIZE / 2}
          y={HEIGHT - 5}
          textAnchor="middle"
          fill="#6b6560"
          fontSize={11}
          fontFamily="var(--font-serif)"
          fontStyle="italic"
          opacity={0.6}
        >
          {String.fromCharCode(97 + i)}
        </text>
      ))}

      {/* Row labels */}
      {Array.from({ length: BOARD_ROWS }, (_, i) => (
        <text
          key={`row-${i}`}
          x={7}
          y={i * CELL_SIZE + CELL_SIZE / 2 + 4}
          textAnchor="start"
          fill="#6b6560"
          fontSize={11}
          fontFamily="var(--font-serif)"
          fontStyle="italic"
          opacity={0.5}
        >
          {i + 1}
        </text>
      ))}
    </svg>
  );
}
