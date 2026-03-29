// SVG board renderer — 8x16 checkered grid with pieces
// Visual style inspired by the Selenus (1616) copperplate engraving
// Supports optional region cropping for scenario puzzles

import { GameState, Position } from '@/lib/rithmomachia/types';
import { BOARD_COLS, BOARD_ROWS, CELL_SIZE } from '@/lib/rithmomachia/constants';
import { positionsEqual, positionKey } from '@/lib/rithmomachia/board';
import Piece, { PieceDefs } from './Piece';

export interface BoardRegion {
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
}

interface BoardProps {
  state: GameState;
  onCellClick: (pos: Position) => void;
  /** Optional region to crop the board view (for scenarios/puzzles) */
  region?: BoardRegion;
}

const BORDER = 6;

export default function Board({ state, onCellClick, region }: BoardProps) {
  const legalMoveSet = new Set(state.legalMoves.map(positionKey));

  // Region defaults to full board
  const colStart = region?.colStart ?? 0;
  const colEnd = region?.colEnd ?? BOARD_COLS;
  const rowStart = region?.rowStart ?? 0;
  const rowEnd = region?.rowEnd ?? BOARD_ROWS;
  const cols = colEnd - colStart;
  const rows = rowEnd - rowStart;
  const WIDTH = cols * CELL_SIZE;
  const HEIGHT = rows * CELL_SIZE;

  // Is this a cropped (scenario) view?
  const isCropped = region != null;

  return (
    <svg
      viewBox={`${-BORDER} ${-BORDER} ${WIDTH + BORDER * 2} ${HEIGHT + BORDER * 2}`}
      className={`w-full select-none ${isCropped ? 'max-w-md' : 'max-w-lg'} mx-auto`}
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
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const boardRow = r + rowStart;
          const boardCol = c + colStart;
          const isDark = (boardRow + boardCol) % 2 === 1;
          const isLegalMove = legalMoveSet.has(`${boardCol},${boardRow}`);

          return (
            <g key={`${c}-${r}`}>
              <rect
                x={c * CELL_SIZE}
                y={r * CELL_SIZE}
                width={CELL_SIZE}
                height={CELL_SIZE}
                fill={isDark ? '#2a2320' : '#f0ebe0'}
                onClick={() => onCellClick({ col: boardCol, row: boardRow })}
                style={{ cursor: isLegalMove ? 'pointer' : 'default' }}
              />
              {/* Subtle texture on light squares */}
              {!isDark && (
                <rect
                  x={c * CELL_SIZE}
                  y={r * CELL_SIZE}
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

      {/* Midline separator — only show if visible in the region */}
      {rowStart < 8 && rowEnd > 8 && (
        <line
          x1={0}
          y1={(8 - rowStart) * CELL_SIZE}
          x2={WIDTH}
          y2={(8 - rowStart) * CELL_SIZE}
          stroke="#9e4a3a"
          strokeWidth={1.5}
          opacity={0.4}
        />
      )}

      {/* Last move indicator — subtle highlight on from/to squares */}
      {state.moveHistory.length > 0 && (() => {
        const last = state.moveHistory[state.moveHistory.length - 1];
        const fromX = (last.from.col - colStart) * CELL_SIZE;
        const fromY = (last.from.row - rowStart) * CELL_SIZE;
        const toX = (last.to.col - colStart) * CELL_SIZE;
        const toY = (last.to.row - rowStart) * CELL_SIZE;
        return (
          <>
            <rect
              x={fromX + 2} y={fromY + 2}
              width={CELL_SIZE - 4} height={CELL_SIZE - 4}
              rx={3} fill="#9e4a3a" opacity={0.08} pointerEvents="none"
            />
            <rect
              x={toX + 2} y={toY + 2}
              width={CELL_SIZE - 4} height={CELL_SIZE - 4}
              rx={3} fill="#9e4a3a" opacity={0.15} pointerEvents="none"
            />
          </>
        );
      })()}

      {/* Legal move indicators */}
      {state.legalMoves.map(pos => (
        <circle
          key={`move-${pos.col}-${pos.row}`}
          cx={(pos.col - colStart) * CELL_SIZE + CELL_SIZE / 2}
          cy={(pos.row - rowStart) * CELL_SIZE + CELL_SIZE / 2}
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
          x={(cap.target.col - colStart) * CELL_SIZE + 3}
          y={(cap.target.row - rowStart) * CELL_SIZE + 3}
          width={CELL_SIZE - 6}
          height={CELL_SIZE - 6}
          rx={4}
          fill="none"
          stroke="var(--accent-gold)"
          strokeWidth={3}
          opacity={0.7}
        />
      ))}

      {/* Pieces — only render those in the visible region */}
      {state.pieces
        .filter(p =>
          p.position.col >= colStart && p.position.col < colEnd &&
          p.position.row >= rowStart && p.position.row < rowEnd
        )
        .map(piece => {
          // Offset piece position for cropped rendering
          const offsetPiece = isCropped
            ? { ...piece, position: { col: piece.position.col - colStart, row: piece.position.row - rowStart } }
            : piece;
          const isSelected = state.selectedPiece !== null && positionsEqual(piece.position, state.selectedPiece);
          return (
            <Piece
              key={piece.id}
              piece={offsetPiece}
              isSelected={isSelected}
              isCurrentPlayer={piece.owner === state.currentPlayer}
              onClick={() => onCellClick(piece.position)}
            />
          );
        })}

      {/* Column labels */}
      {Array.from({ length: cols }, (_, i) => (
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
          {String.fromCharCode(97 + i + colStart)}
        </text>
      ))}

      {/* Row labels */}
      {Array.from({ length: rows }, (_, i) => (
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
          {i + 1 + rowStart}
        </text>
      ))}
    </svg>
  );
}
