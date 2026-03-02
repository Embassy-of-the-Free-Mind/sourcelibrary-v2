// SVG piece renderer — circle, triangle, square, or pyramid with value label
// Visual style: copperplate engraving aesthetic inspired by Selenus (1616)

import { Piece as PieceType, PieceShape } from '@/lib/rithmomachia/types';
import { CELL_SIZE } from '@/lib/rithmomachia/constants';

interface PieceProps {
  piece: PieceType;
  isSelected: boolean;
  isCurrentPlayer: boolean;
  isCaptured?: boolean;
  onClick: () => void;
}

const HALF = CELL_SIZE / 2;
const PIECE_RADIUS = 38;

// Unique pattern IDs per owner to avoid SVG conflicts
const HATCH_EVEN = 'piece-hatch-even';
const HATCH_ODD = 'piece-hatch-odd';

/** Shared SVG defs — render once inside the Board's <svg> */
export function PieceDefs() {
  return (
    <>
      {/* Even (white) pieces: very subtle stipple texture */}
      <pattern id={HATCH_EVEN} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(30)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#1a1612" strokeWidth="0.3" opacity="0.06" />
      </pattern>
      {/* Odd (dark) pieces: fine crosshatch like an engraving */}
      <pattern id={HATCH_ODD} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" stroke="#f0ebe0" strokeWidth="0.6" opacity="0.12" />
      </pattern>
    </>
  );
}

export default function Piece({ piece, isSelected, isCurrentPlayer, isCaptured, onClick }: PieceProps) {
  const cx = piece.position.col * CELL_SIZE + HALF;
  const cy = piece.position.row * CELL_SIZE + HALF;
  const isEven = piece.owner === 'even';

  // Engraving palette — high contrast, ink on paper
  const fill = isEven ? '#f0ebe0' : '#1a1612';
  const stroke = '#1a1612';
  const strokeW = isEven ? 2 : 2.5;
  const textColor = isEven ? '#1a1612' : '#f0ebe0';
  const hatchId = isEven ? HATCH_EVEN : HATCH_ODD;
  const selectRing = '#9e4a3a';

  // Font size scales with value length — serif italic like handwritten numbers
  const valueStr = String(piece.value);
  const fontSize = valueStr.length <= 2 ? 24 : valueStr.length === 3 ? 19 : 15;

  return (
    <g
      onClick={onClick}
      style={{
        cursor: isCurrentPlayer ? 'pointer' : 'default',
        transition: 'transform 250ms ease-out, opacity 200ms ease-out',
        transform: `translate(${cx - HALF}px, ${cy - HALF}px)`,
        opacity: isCaptured ? 0 : 1,
      }}
      role="button"
      aria-label={`${piece.owner} ${piece.shape} ${piece.value}`}
    >
      {/* Selection ring — pulsing rust accent */}
      {isSelected && (
        <circle cx={HALF} cy={HALF} r={PIECE_RADIUS + 5} fill="none" stroke={selectRing} strokeWidth={3} strokeDasharray="6 3">
          <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Piece shape with hatching overlay */}
      {piece.shape === 'circle' && (
        <>
          <circle cx={HALF} cy={HALF} r={PIECE_RADIUS - 2} fill={fill} stroke={stroke} strokeWidth={strokeW} />
          <circle cx={HALF} cy={HALF} r={PIECE_RADIUS - 2} fill={`url(#${hatchId})`} pointerEvents="none" />
          {/* Inner ring — engraving detail line */}
          <circle cx={HALF} cy={HALF} r={PIECE_RADIUS - 8} fill="none" stroke={stroke} strokeWidth={0.5} opacity={isEven ? 0.2 : 0.15} />
        </>
      )}

      {piece.shape === 'triangle' && (
        <>
          <polygon
            points={trianglePoints(HALF, HALF, PIECE_RADIUS - 2)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW}
            strokeLinejoin="miter"
          />
          <polygon
            points={trianglePoints(HALF, HALF, PIECE_RADIUS - 2)}
            fill={`url(#${hatchId})`}
            pointerEvents="none"
            strokeLinejoin="miter"
          />
          {/* Inner triangle — engraving detail */}
          <polygon
            points={trianglePoints(HALF, HALF, PIECE_RADIUS - 10)}
            fill="none"
            stroke={stroke}
            strokeWidth={0.5}
            strokeLinejoin="miter"
            opacity={isEven ? 0.2 : 0.15}
          />
        </>
      )}

      {piece.shape === 'square' && (
        <>
          <rect
            x={HALF - PIECE_RADIUS + 4}
            y={HALF - PIECE_RADIUS + 4}
            width={(PIECE_RADIUS - 4) * 2}
            height={(PIECE_RADIUS - 4) * 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeW}
          />
          <rect
            x={HALF - PIECE_RADIUS + 4}
            y={HALF - PIECE_RADIUS + 4}
            width={(PIECE_RADIUS - 4) * 2}
            height={(PIECE_RADIUS - 4) * 2}
            fill={`url(#${hatchId})`}
            pointerEvents="none"
          />
          {/* Inner square — engraving detail */}
          <rect
            x={HALF - PIECE_RADIUS + 10}
            y={HALF - PIECE_RADIUS + 10}
            width={(PIECE_RADIUS - 10) * 2}
            height={(PIECE_RADIUS - 10) * 2}
            fill="none"
            stroke={stroke}
            strokeWidth={0.5}
            opacity={isEven ? 0.2 : 0.15}
          />
        </>
      )}

      {piece.shape === 'pyramid' && (
        <PyramidShape cx={HALF} cy={HALF} isEven={isEven} fill={fill} stroke={stroke} strokeW={strokeW} hatchId={hatchId} />
      )}

      {/* Value label — serif italic like handwritten numbers in the engraving */}
      <text
        x={HALF}
        y={HALF + (piece.shape === 'triangle' ? 4 : 1)}
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={fontSize}
        fontWeight="500"
        fontFamily="var(--font-serif)"
        fontStyle="italic"
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

function PyramidShape({ cx, cy, isEven, fill, stroke, strokeW, hatchId }: {
  cx: number; cy: number; isEven: boolean; fill: string; stroke: string; strokeW: number; hatchId: string;
}) {
  const s = PIECE_RADIUS - 2;
  return (
    <>
      {/* Outer square with hatching */}
      <rect
        x={cx - s}
        y={cy - s}
        width={s * 2}
        height={s * 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeW}
      />
      <rect
        x={cx - s}
        y={cy - s}
        width={s * 2}
        height={s * 2}
        fill={`url(#${hatchId})`}
        pointerEvents="none"
      />
      {/* Inner triangle */}
      <polygon
        points={trianglePoints(cx, cy, s * 0.65)}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="miter"
        opacity={0.6}
      />
      {/* Inner circle */}
      <circle
        cx={cx}
        cy={cy + 2}
        r={s * 0.3}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        opacity={0.6}
      />
    </>
  );
}
