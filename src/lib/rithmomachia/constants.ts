// Rithmomachia constants — piece values and starting positions
// All 5 primary sources (1496-1616) agree on these values.

import { Piece, Player, PieceShape, Position, PyramidLayer } from './types';

export const BOARD_COLS = 8;
export const BOARD_ROWS = 16;
export const CELL_SIZE = 100; // SVG units per cell

// Movement distances by shape (inclusive counting — matches vertex count minus 1)
// Circle=1, Triangle=2, Square=3
export const MOVE_DISTANCE: Record<Exclude<PieceShape, 'pyramid'>, number> = {
  circle: 1,
  triangle: 2,
  square: 3,
};

// Direction vectors for movement
// Circles: diagonal only (per Lever & Fulke, "like pawns in chess")
// Triangles: orthogonal only
// Squares: orthogonal only
export const MOVE_DIRECTIONS: Record<Exclude<PieceShape, 'pyramid'>, Position[]> = {
  circle: [
    { col: -1, row: -1 }, { col: 1, row: -1 },
    { col: -1, row: 1 }, { col: 1, row: 1 },
  ],
  triangle: [
    { col: 0, row: -1 }, { col: 0, row: 1 },
    { col: -1, row: 0 }, { col: 1, row: 0 },
  ],
  square: [
    { col: 0, row: -1 }, { col: 0, row: 1 },
    { col: -1, row: 0 }, { col: 1, row: 0 },
  ],
};

// --- Piece definitions ---

interface PieceDef {
  shape: PieceShape;
  value: number;
  col: number;
  row: number; // row relative to the player's side (0 = front rank)
  pyramidLayers?: PyramidLayer[];
}

// Even (White) pieces — rows 0-7, facing toward row 15
// Row mapping: relative row 0 → board row 1 (front), row 1 → board row 0 (back)
// For circles and triangles: front=closer to center, back=further
const EVEN_PIECES: PieceDef[] = [
  // Circles front rank (row 1)
  { shape: 'circle', value: 2,  col: 3, row: 1 },
  { shape: 'circle', value: 4,  col: 5, row: 1 },
  { shape: 'circle', value: 6,  col: 7, row: 1 },
  { shape: 'circle', value: 8,  col: 1, row: 1 },
  // Circles back rank (row 0)
  { shape: 'circle', value: 4,  col: 2, row: 0 },
  { shape: 'circle', value: 16, col: 4, row: 0 },
  { shape: 'circle', value: 36, col: 6, row: 0 },
  { shape: 'circle', value: 64, col: 0, row: 0 },
  // Triangles front rank (row 3)
  { shape: 'triangle', value: 6,  col: 2, row: 3 },
  { shape: 'triangle', value: 20, col: 4, row: 3 },
  { shape: 'triangle', value: 42, col: 6, row: 3 },
  { shape: 'triangle', value: 72, col: 0, row: 3 },
  // Triangles back rank (row 2)
  { shape: 'triangle', value: 9,  col: 3, row: 2 },
  { shape: 'triangle', value: 25, col: 5, row: 2 },
  { shape: 'triangle', value: 49, col: 7, row: 2 },
  { shape: 'triangle', value: 81, col: 1, row: 2 },
  // Squares front rank (row 5)
  { shape: 'square', value: 15,  col: 3, row: 5 },
  { shape: 'square', value: 45,  col: 5, row: 5 },
  { shape: 'square', value: 91,  col: 7, row: 5 },
  { shape: 'square', value: 153, col: 1, row: 5 },
  // Squares back rank (row 4)
  { shape: 'square', value: 25,  col: 2, row: 4 },
  { shape: 'square', value: 81,  col: 4, row: 4 },
  { shape: 'square', value: 169, col: 6, row: 4 },
  // Pyramid (replaces 4th square on back rank)
  {
    shape: 'pyramid', value: 91, col: 0, row: 4,
    pyramidLayers: [
      { shape: 'square', value: 36 },
      { shape: 'square', value: 25 },
      { shape: 'triangle', value: 16 },
      { shape: 'triangle', value: 9 },
      { shape: 'circle', value: 4 },
      { shape: 'circle', value: 1 },
    ],
  },
];

// Odd (Black) pieces — rows 8-15, facing toward row 0
// Row mapping: relative row 0 → board row 14 (front), row 1 → board row 15 (back)
const ODD_PIECES: PieceDef[] = [
  // Circles front rank (row 14)
  { shape: 'circle', value: 3,  col: 4, row: 0 },
  { shape: 'circle', value: 5,  col: 2, row: 0 },
  { shape: 'circle', value: 7,  col: 0, row: 0 },
  { shape: 'circle', value: 9,  col: 6, row: 0 },
  // Circles back rank (row 15)
  { shape: 'circle', value: 9,  col: 5, row: 1 },
  { shape: 'circle', value: 25, col: 3, row: 1 },
  { shape: 'circle', value: 49, col: 1, row: 1 },
  { shape: 'circle', value: 81, col: 7, row: 1 },
  // Triangles front rank (row 12)
  { shape: 'triangle', value: 12, col: 5, row: 2 },
  { shape: 'triangle', value: 30, col: 3, row: 2 },
  { shape: 'triangle', value: 56, col: 1, row: 2 },
  { shape: 'triangle', value: 90, col: 7, row: 2 },
  // Triangles back rank (row 13)
  { shape: 'triangle', value: 16,  col: 4, row: 3 },
  { shape: 'triangle', value: 36,  col: 2, row: 3 },
  { shape: 'triangle', value: 64,  col: 0, row: 3 },
  { shape: 'triangle', value: 100, col: 6, row: 3 },
  // Squares front rank (row 10)
  { shape: 'square', value: 28,  col: 4, row: 4 },
  { shape: 'square', value: 66,  col: 2, row: 4 },
  { shape: 'square', value: 120, col: 0, row: 4 },
  { shape: 'square', value: 190, col: 6, row: 4 },
  // Squares back rank (row 11)
  { shape: 'square', value: 49,  col: 5, row: 5 },
  { shape: 'square', value: 121, col: 3, row: 5 },
  { shape: 'square', value: 225, col: 1, row: 5 },
  // Pyramid (replaces 4th square on back rank)
  {
    shape: 'pyramid', value: 190, col: 7, row: 5,
    pyramidLayers: [
      { shape: 'square', value: 64 },
      { shape: 'square', value: 49 },
      { shape: 'triangle', value: 36 },
      { shape: 'triangle', value: 25 },
      { shape: 'circle', value: 16 },
    ],
  },
];

function mapPosition(def: PieceDef, owner: Player): Position {
  if (owner === 'even') {
    return { col: def.col, row: def.row };
  }
  // Odd pieces: mirror vertically — row 0 (front) → board row 14, row 5 (back) → board row 15 - row offset
  return { col: def.col, row: BOARD_ROWS - 1 - def.row };
}

let nextId = 0;

function createPiece(def: PieceDef, owner: Player): Piece {
  return {
    id: `${owner}-${def.shape}-${def.value}-${nextId++}`,
    owner,
    shape: def.shape,
    value: def.value,
    position: mapPosition(def, owner),
    ...(def.pyramidLayers ? { pyramidLayers: def.pyramidLayers } : {}),
  };
}

export function createInitialPieces(): Piece[] {
  nextId = 0;
  const pieces: Piece[] = [];
  for (const def of EVEN_PIECES) {
    pieces.push(createPiece(def, 'even'));
  }
  for (const def of ODD_PIECES) {
    pieces.push(createPiece(def, 'odd'));
  }
  return pieces;
}

// Victory thresholds for "common" victories
export const VICTORY_BODIES = 15;     // capture 15 pieces
export const VICTORY_GOODS = 200;     // capture pieces worth >= 200
export const VICTORY_QUARREL_PIECES = 10;
export const VICTORY_QUARREL_VALUE = 150;
