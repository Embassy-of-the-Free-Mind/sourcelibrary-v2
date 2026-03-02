// SVG piece renderer — circle, triangle, square, or pyramid with copperplate engraving images
// Uses AI-generated 3D copperplate engravings (Wan2.6-t2i), v3 shadow-free variants
// Light pieces: circle v0, triangle v3, square v3 (f20 fuzz)
// Dark pieces: circle v3, triangle v0, square v1

import { Piece as PieceType } from '@/lib/rithmomachia/types';
import { CELL_SIZE } from '@/lib/rithmomachia/constants';

interface PieceProps {
  piece: PieceType;
  isSelected: boolean;
  isCurrentPlayer: boolean;
  isCaptured?: boolean;
  onClick: () => void;
}

const HALF = CELL_SIZE / 2;
const PIECE_SIZE = 72; // image display size within cell
const PIECE_OFFSET = (CELL_SIZE - PIECE_SIZE) / 2;

const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/rithmomachia/pieces';

// Copperplate engraving piece images (transparent PNGs, 200x200)
const PIECE_IMAGES = {
  even: {
    circle: `${BLOB}/v3_circle_light.png`,
    triangle: `${BLOB}/v3_triangle_light.png`,
    square: `${BLOB}/v3_square_light.png`,
  },
  odd: {
    circle: `${BLOB}/v3_circle_dark.png`,
    triangle: `${BLOB}/v3_triangle_dark.png`,
    square: `${BLOB}/v3_square_dark.png`,
  },
} as const;

/** Shared SVG defs — render once inside the Board's <svg> */
export function PieceDefs() {
  // No patterns needed with image-based pieces, but keep the export for Board.tsx compatibility
  return null;
}

export default function Piece({ piece, isSelected, isCurrentPlayer, isCaptured, onClick }: PieceProps) {
  const cx = piece.position.col * CELL_SIZE + HALF;
  const cy = piece.position.row * CELL_SIZE + HALF;
  const isEven = piece.owner === 'even';

  const selectRing = '#9e4a3a';
  const textColor = isEven ? '#1a1612' : '#e8dfd0';
  const textShadow = isEven ? '#f0ebe0' : '#1a1612';

  // Font size scales with value length
  const valueStr = String(piece.value);
  const fontSize = valueStr.length <= 2 ? 22 : valueStr.length === 3 ? 17 : 14;

  // For pyramids, use the square image (they contain all shapes visually)
  const shapeKey = piece.shape === 'pyramid' ? 'square' : piece.shape;
  const imageUrl = PIECE_IMAGES[isEven ? 'even' : 'odd'][shapeKey];

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
      {/* Selection ring */}
      {isSelected && (
        <circle cx={HALF} cy={HALF} r={PIECE_SIZE / 2 + 5} fill="none" stroke={selectRing} strokeWidth={3} strokeDasharray="6 3">
          <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Dark background for odd pieces so cream lines are visible */}
      {!isEven && (
        <rect
          x={PIECE_OFFSET}
          y={PIECE_OFFSET}
          width={PIECE_SIZE}
          height={PIECE_SIZE}
          rx={piece.shape === 'circle' ? PIECE_SIZE / 2 : 4}
          fill="#2a1e12"
        />
      )}

      {/* Copperplate engraving image */}
      <image
        href={imageUrl}
        x={PIECE_OFFSET}
        y={PIECE_OFFSET}
        width={PIECE_SIZE}
        height={PIECE_SIZE}
      />

      {/* Pyramid indicator — small nested shapes badge */}
      {piece.shape === 'pyramid' && (
        <>
          <circle cx={HALF} cy={PIECE_OFFSET + 10} r={5} fill="none" stroke={textColor} strokeWidth={1} opacity={0.6} />
          <polygon
            points={`${HALF},${PIECE_OFFSET + 3} ${HALF + 5},${PIECE_OFFSET + 12} ${HALF - 5},${PIECE_OFFSET + 12}`}
            fill="none"
            stroke={textColor}
            strokeWidth={0.8}
            opacity={0.4}
          />
        </>
      )}

      {/* Value label — serif with shadow for legibility over engraving */}
      <text
        x={HALF}
        y={HALF + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={textShadow}
        fontSize={fontSize + 1}
        fontWeight="700"
        fontFamily="var(--font-serif)"
        fontStyle="italic"
        opacity={0.7}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {piece.value}
      </text>
      <text
        x={HALF}
        y={HALF + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fill={textColor}
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="var(--font-serif)"
        fontStyle="italic"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        {piece.value}
      </text>
    </g>
  );
}
