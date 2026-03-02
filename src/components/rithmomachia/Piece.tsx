// SVG piece renderer — circle, triangle, square, or pyramid with value label

import { Piece as PieceType, PieceShape } from '@/lib/rithmomachia/types';
import { CELL_SIZE } from '@/lib/rithmomachia/constants';

interface PieceProps {
  piece: PieceType;
  isSelected: boolean;
  isCurrentPlayer: boolean;
  onClick: () => void;
}

const HALF = CELL_SIZE / 2;
const PIECE_RADIUS = 38; // circle radius / triangle+square half-size

export default function Piece({ piece, isSelected, isCurrentPlayer, onClick }: PieceProps) {
  const cx = piece.position.col * CELL_SIZE + HALF;
  const cy = piece.position.row * CELL_SIZE + HALF;
  const isEven = piece.owner === 'even';

  // Colors
  const fill = isEven ? '#fdfcf9' : '#2a2320';
  const stroke = isEven ? '#2a2320' : '#d4cfc4';
  const textColor = isEven ? '#1a1612' : '#fdfcf9';
  const selectRing = 'var(--accent-rust)';

  // Font size scales with value length
  const valueStr = String(piece.value);
  const fontSize = valueStr.length <= 2 ? 22 : valueStr.length === 3 ? 18 : 15;

  return (
    <g
      onClick={onClick}
      style={{ cursor: isCurrentPlayer ? 'pointer' : 'default' }}
      role="button"
      aria-label={`${piece.owner} ${piece.shape} ${piece.value}`}
    >
      {/* Selection ring */}
      {isSelected && (
        <circle cx={cx} cy={cy} r={PIECE_RADIUS + 5} fill="none" stroke={selectRing} strokeWidth={3} />
      )}

      {/* Piece shape */}
      {piece.shape === 'circle' && (
        <circle cx={cx} cy={cy} r={PIECE_RADIUS - 2} fill={fill} stroke={stroke} strokeWidth={2.5} />
      )}

      {piece.shape === 'triangle' && (
        <polygon
          points={trianglePoints(cx, cy, PIECE_RADIUS - 2)}
          fill={fill}
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
      )}

      {piece.shape === 'square' && (
        <rect
          x={cx - PIECE_RADIUS + 4}
          y={cy - PIECE_RADIUS + 4}
          width={(PIECE_RADIUS - 4) * 2}
          height={(PIECE_RADIUS - 4) * 2}
          rx={3}
          fill={fill}
          stroke={stroke}
          strokeWidth={2.5}
        />
      )}

      {piece.shape === 'pyramid' && (
        <PyramidShape cx={cx} cy={cy} isEven={isEven} fill={fill} stroke={stroke} />
      )}

      {/* Value label */}
      <text
        x={cx}
        y={cy + (piece.shape === 'triangle' ? 4 : 1)}
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={fontSize}
        fontWeight="600"
        fontFamily="var(--font-sans)"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {piece.value}
      </text>
    </g>
  );
}

function trianglePoints(cx: number, cy: number, r: number): string {
  // Equilateral triangle pointing up
  const top = `${cx},${cy - r}`;
  const bottomLeft = `${cx - r * 0.866},${cy + r * 0.5}`;
  const bottomRight = `${cx + r * 0.866},${cy + r * 0.5}`;
  return `${top} ${bottomRight} ${bottomLeft}`;
}

function PyramidShape({ cx, cy, isEven, fill, stroke }: {
  cx: number; cy: number; isEven: boolean; fill: string; stroke: string;
}) {
  // Stacked shapes: outer square, inner triangle, inner circle
  const s = PIECE_RADIUS - 2;
  return (
    <>
      {/* Outer square */}
      <rect
        x={cx - s}
        y={cy - s}
        width={s * 2}
        height={s * 2}
        rx={3}
        fill={fill}
        stroke={stroke}
        strokeWidth={2.5}
      />
      {/* Inner triangle */}
      <polygon
        points={trianglePoints(cx, cy, s * 0.65)}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        opacity={0.5}
      />
      {/* Inner circle */}
      <circle
        cx={cx}
        cy={cy + 2}
        r={s * 0.3}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        opacity={0.5}
      />
    </>
  );
}
