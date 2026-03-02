// Movement logic — calculating legal moves for each piece type

import { Piece, Position, PieceShape } from './types';
import { MOVE_DISTANCE, MOVE_DIRECTIONS, BOARD_COLS, BOARD_ROWS } from './constants';
import { isInBounds, isEmpty } from './board';

/**
 * Get all legal move destinations for a piece.
 *
 * Movement rules (Lever & Fulke, "first kind of play"):
 * - Circles move 1 space diagonally (like chess pawns, any direction)
 * - Triangles move 2 spaces orthogonally (leap — can jump over pieces)
 * - Squares move 3 spaces orthogonally (leap — can jump over pieces)
 * - Pyramid moves as any of its component shapes (1 diagonal, 2 ortho, 3 ortho)
 *
 * Pieces LEAP — they don't slide. Intervening pieces don't block movement.
 * A piece can only land on an empty square (captures happen separately).
 */
export function getLegalMoves(
  piece: Piece,
  board: (Piece | null)[][],
): Position[] {
  if (piece.shape === 'pyramid') {
    return getPyramidMoves(piece, board);
  }

  return getShapeMoves(piece.shape, piece.position, board);
}

function getShapeMoves(
  shape: Exclude<PieceShape, 'pyramid'>,
  position: Position,
  board: (Piece | null)[][],
): Position[] {
  const dist = MOVE_DISTANCE[shape];
  const directions = MOVE_DIRECTIONS[shape];
  const moves: Position[] = [];

  for (const dir of directions) {
    const target: Position = {
      col: position.col + dir.col * dist,
      row: position.row + dir.row * dist,
    };
    if (isInBounds(target) && isEmpty(board, target)) {
      moves.push(target);
    }
  }

  return moves;
}

/**
 * Pyramid can move as any of its component piece shapes.
 * This gives it circle movement (1 diagonal) + triangle movement (2 ortho) + square movement (3 ortho).
 */
function getPyramidMoves(
  piece: Piece,
  board: (Piece | null)[][],
): Position[] {
  const seen = new Set<string>();
  const moves: Position[] = [];

  // Pyramid has layers of circles, triangles, and squares — move as any shape present
  const shapes = new Set<Exclude<PieceShape, 'pyramid'>>();
  if (piece.pyramidLayers) {
    for (const layer of piece.pyramidLayers) {
      shapes.add(layer.shape);
    }
  } else {
    // Default: pyramid can always move as all three shapes
    shapes.add('circle');
    shapes.add('triangle');
    shapes.add('square');
  }

  for (const shape of shapes) {
    for (const move of getShapeMoves(shape, piece.position, board)) {
      const key = `${move.col},${move.row}`;
      if (!seen.has(key)) {
        seen.add(key);
        moves.push(move);
      }
    }
  }

  return moves;
}

/** Check if a piece could theoretically reach a target position (ignoring occupancy) */
export function canReach(
  shape: PieceShape,
  from: Position,
  to: Position,
): boolean {
  if (shape === 'pyramid') {
    // Pyramid can reach as any shape
    return canReach('circle', from, to) || canReach('triangle', from, to) || canReach('square', from, to);
  }

  const dist = MOVE_DISTANCE[shape];
  const directions = MOVE_DIRECTIONS[shape];

  for (const dir of directions) {
    const target: Position = {
      col: from.col + dir.col * dist,
      row: from.row + dir.row * dist,
    };
    if (target.col === to.col && target.row === to.row) {
      return true;
    }
  }
  return false;
}

/**
 * Get all squares a piece threatens (could move to if empty).
 * Used for capture detection — a piece "threatens" a square even if occupied.
 */
export function getThreatenedSquares(piece: Piece): Position[] {
  if (piece.shape === 'pyramid') {
    const shapes = new Set<Exclude<PieceShape, 'pyramid'>>();
    if (piece.pyramidLayers) {
      for (const layer of piece.pyramidLayers) shapes.add(layer.shape);
    } else {
      shapes.add('circle');
      shapes.add('triangle');
      shapes.add('square');
    }

    const seen = new Set<string>();
    const positions: Position[] = [];
    for (const shape of shapes) {
      for (const pos of getThreatenedByShape(shape, piece.position)) {
        const key = `${pos.col},${pos.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          positions.push(pos);
        }
      }
    }
    return positions;
  }

  return getThreatenedByShape(piece.shape, piece.position);
}

function getThreatenedByShape(
  shape: Exclude<PieceShape, 'pyramid'>,
  position: Position,
): Position[] {
  const dist = MOVE_DISTANCE[shape];
  const directions = MOVE_DIRECTIONS[shape];
  const positions: Position[] = [];

  for (const dir of directions) {
    const target: Position = {
      col: position.col + dir.col * dist,
      row: position.row + dir.row * dist,
    };
    if (isInBounds(target)) {
      positions.push(target);
    }
  }

  return positions;
}
