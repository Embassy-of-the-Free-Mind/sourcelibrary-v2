// Cropped SVG board for the visual guide — renders a small region with pieces and highlights
// No interactivity — purely illustrative

import { Piece as PieceType, PieceShape, Player, Position } from '@/lib/rithmomachia/types';
import { CELL_SIZE } from '@/lib/rithmomachia/constants';
import { PieceDefs } from './Piece';

const HALF = CELL_SIZE / 2;
const PIECE_RADIUS = 38;

interface ViewRegion {
  colStart: number;
  colEnd: number;
  rowStart: number;
  rowEnd: number;
}

export interface MiniBoardPiece {
  shape: PieceShape;
  value: number;
  owner: Player;
  position: Position;
}

interface MiniBoardProps {
  pieces: MiniBoardPiece[];
  legalMoves?: Position[];
  captureTargets?: Position[];
  selectedPiece?: Position;
  /** Pieces that participate in a capture — highlighted with a subtle glow */
  attackers?: Position[];
  region: ViewRegion;
  /** Optional label shown below the board */
  label?: string;
}

function posKey(p: Position) {
  return `${p.col},${p.row}`;
}

export default function MiniBoard({
  pieces,
  legalMoves = [],
  captureTargets = [],
  selectedPiece,
  attackers = [],
  region,
  label,
}: MiniBoardProps) {
  const cols = region.colEnd - region.colStart;
  const rows = region.rowEnd - region.rowStart;
  const width = cols * CELL_SIZE;
  const height = rows * CELL_SIZE;
  const BORDER = 4;

  const legalSet = new Set(legalMoves.map(posKey));
  const captureSet = new Set(captureTargets.map(posKey));
  const attackerSet = new Set(attackers.map(posKey));

  return (
    <div>
      <svg
        viewBox={`${-BORDER} ${-BORDER} ${width + BORDER * 2} ${height + BORDER * 2}`}
        className="w-full max-w-[280px] select-none"
        style={{ backgroundColor: '#f5f0e8' }}
        role="img"
        aria-label={label || 'Board diagram'}
      >
        <defs>
          <pattern id="mini-board-hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#1a1612" strokeWidth="0.5" opacity="0.08" />
          </pattern>
          <PieceDefs />
        </defs>

        {/* Frame */}
        <rect
          x={-BORDER}
          y={-BORDER}
          width={width + BORDER * 2}
          height={height + BORDER * 2}
          fill="none"
          stroke="#1a1612"
          strokeWidth={2}
        />

        {/* Squares */}
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const boardRow = r + region.rowStart;
            const boardCol = c + region.colStart;
            const isDark = (boardRow + boardCol) % 2 === 1;
            return (
              <g key={`${c}-${r}`}>
                <rect
                  x={c * CELL_SIZE}
                  y={r * CELL_SIZE}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  fill={isDark ? '#2a2320' : '#f0ebe0'}
                />
                {!isDark && (
                  <rect
                    x={c * CELL_SIZE}
                    y={r * CELL_SIZE}
                    width={CELL_SIZE}
                    height={CELL_SIZE}
                    fill="url(#mini-board-hatch)"
                    pointerEvents="none"
                  />
                )}
              </g>
            );
          })
        )}

        {/* Legal move indicators */}
        {legalMoves.map(pos => {
          const x = (pos.col - region.colStart) * CELL_SIZE + HALF;
          const y = (pos.row - region.rowStart) * CELL_SIZE + HALF;
          return (
            <circle
              key={`move-${posKey(pos)}`}
              cx={x}
              cy={y}
              r={18}
              fill="var(--accent-sage)"
              opacity={0.45}
            />
          );
        })}

        {/* Capture target highlights */}
        {captureTargets.map(pos => {
          const x = (pos.col - region.colStart) * CELL_SIZE + 4;
          const y = (pos.row - region.rowStart) * CELL_SIZE + 4;
          return (
            <rect
              key={`cap-${posKey(pos)}`}
              x={x}
              y={y}
              width={CELL_SIZE - 8}
              height={CELL_SIZE - 8}
              rx={4}
              fill="var(--accent-gold)"
              opacity={0.2}
              stroke="var(--accent-gold)"
              strokeWidth={3}
              strokeOpacity={0.7}
            />
          );
        })}

        {/* Attacker highlights — subtle ring around pieces that contribute to a capture */}
        {attackers.map(pos => {
          const x = (pos.col - region.colStart) * CELL_SIZE + HALF;
          const y = (pos.row - region.rowStart) * CELL_SIZE + HALF;
          return (
            <circle
              key={`atk-${posKey(pos)}`}
              cx={x}
              cy={y}
              r={PIECE_RADIUS + 4}
              fill="none"
              stroke="var(--accent-sage)"
              strokeWidth={2.5}
              opacity={0.6}
            />
          );
        })}

        {/* Pieces — rendered inline (not using the interactive Piece component) */}
        {pieces.map(piece => {
          const localCol = piece.position.col - region.colStart;
          const localRow = piece.position.row - region.rowStart;
          const cx = localCol * CELL_SIZE + HALF;
          const cy = localRow * CELL_SIZE + HALF;

          const isEven = piece.owner === 'even';
          const isSelected = selectedPiece && piece.position.col === selectedPiece.col && piece.position.row === selectedPiece.row;

          const fill = isEven ? '#f0ebe0' : '#1a1612';
          const stroke = '#1a1612';
          const strokeW = isEven ? 2 : 2.5;
          const textColor = isEven ? '#1a1612' : '#f0ebe0';
          const hatchId = isEven ? 'piece-hatch-even' : 'piece-hatch-odd';
          const selectRing = '#9e4a3a';

          const valueStr = String(piece.value);
          const fontSize = valueStr.length <= 2 ? 24 : valueStr.length === 3 ? 19 : 15;

          return (
            <g key={`${piece.owner}-${piece.shape}-${piece.value}-${posKey(piece.position)}`}>
              {/* Selection ring */}
              {isSelected && (
                <circle cx={cx} cy={cy} r={PIECE_RADIUS + 5} fill="none" stroke={selectRing} strokeWidth={3} strokeDasharray="6 3" opacity={0.8} />
              )}

              {/* Shape */}
              {piece.shape === 'circle' && (
                <>
                  <circle cx={cx} cy={cy} r={PIECE_RADIUS - 2} fill={fill} stroke={stroke} strokeWidth={strokeW} />
                  <circle cx={cx} cy={cy} r={PIECE_RADIUS - 2} fill={`url(#${hatchId})`} pointerEvents="none" />
                  <circle cx={cx} cy={cy} r={PIECE_RADIUS - 8} fill="none" stroke={stroke} strokeWidth={0.5} opacity={isEven ? 0.2 : 0.15} />
                </>
              )}

              {piece.shape === 'triangle' && (() => {
                const r = PIECE_RADIUS - 2;
                const rInner = PIECE_RADIUS - 10;
                const pts = `${cx},${cy - r} ${cx + r * 0.866},${cy + r * 0.5} ${cx - r * 0.866},${cy + r * 0.5}`;
                const ptsInner = `${cx},${cy - rInner} ${cx + rInner * 0.866},${cy + rInner * 0.5} ${cx - rInner * 0.866},${cy + rInner * 0.5}`;
                return (
                  <>
                    <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={strokeW} strokeLinejoin="miter" />
                    <polygon points={pts} fill={`url(#${hatchId})`} pointerEvents="none" strokeLinejoin="miter" />
                    <polygon points={ptsInner} fill="none" stroke={stroke} strokeWidth={0.5} strokeLinejoin="miter" opacity={isEven ? 0.2 : 0.15} />
                  </>
                );
              })()}

              {piece.shape === 'square' && (
                <>
                  <rect
                    x={cx - PIECE_RADIUS + 4}
                    y={cy - PIECE_RADIUS + 4}
                    width={(PIECE_RADIUS - 4) * 2}
                    height={(PIECE_RADIUS - 4) * 2}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeW}
                  />
                  <rect
                    x={cx - PIECE_RADIUS + 4}
                    y={cy - PIECE_RADIUS + 4}
                    width={(PIECE_RADIUS - 4) * 2}
                    height={(PIECE_RADIUS - 4) * 2}
                    fill={`url(#${hatchId})`}
                    pointerEvents="none"
                  />
                  <rect
                    x={cx - PIECE_RADIUS + 10}
                    y={cy - PIECE_RADIUS + 10}
                    width={(PIECE_RADIUS - 10) * 2}
                    height={(PIECE_RADIUS - 10) * 2}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={0.5}
                    opacity={isEven ? 0.2 : 0.15}
                  />
                </>
              )}

              {/* Value label */}
              <text
                x={cx}
                y={cy + (piece.shape === 'triangle' ? 4 : 1)}
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
        })}
      </svg>
      {label && (
        <div className="text-center text-xs text-muted mt-1 italic font-serif">{label}</div>
      )}
    </div>
  );
}
