// Board utilities — creating and querying the 8x16 grid

import { Piece, Position } from './types';
import { BOARD_COLS, BOARD_ROWS } from './constants';

export function createBoard(pieces: Piece[]): (Piece | null)[][] {
  const board: (Piece | null)[][] = Array.from({ length: BOARD_ROWS }, () =>
    Array.from({ length: BOARD_COLS }, () => null)
  );
  for (const piece of pieces) {
    const { row, col } = piece.position;
    if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
      board[row][col] = piece;
    }
  }
  return board;
}

export function isInBounds(pos: Position): boolean {
  return pos.col >= 0 && pos.col < BOARD_COLS && pos.row >= 0 && pos.row < BOARD_ROWS;
}

export function getPieceAt(board: (Piece | null)[][], pos: Position): Piece | null {
  if (!isInBounds(pos)) return null;
  return board[pos.row][pos.col];
}

export function isEmpty(board: (Piece | null)[][], pos: Position): boolean {
  if (!isInBounds(pos)) return false;
  return board[pos.row][pos.col] === null;
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.col === b.col && a.row === b.row;
}

export function positionKey(pos: Position): string {
  return `${pos.col},${pos.row}`;
}

/** Manhattan distance between two positions */
export function distance(a: Position, b: Position): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/** Chebyshev distance (diagonal = 1) */
export function chebyshevDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/** Check if two positions are on the same rank, file, or diagonal */
export function isOnLine(a: Position, b: Position): 'orthogonal' | 'diagonal' | null {
  if (a.row === b.row || a.col === b.col) return 'orthogonal';
  if (Math.abs(a.row - b.row) === Math.abs(a.col - b.col)) return 'diagonal';
  return null;
}

/** Get all positions between a and b (exclusive), only if they're on a straight line */
export function positionsBetween(a: Position, b: Position): Position[] | null {
  const line = isOnLine(a, b);
  if (!line) return null;

  const dRow = Math.sign(b.row - a.row);
  const dCol = Math.sign(b.col - a.col);
  const positions: Position[] = [];

  let r = a.row + dRow;
  let c = a.col + dCol;
  while (r !== b.row || c !== b.col) {
    positions.push({ col: c, row: r });
    r += dRow;
    c += dCol;
  }
  return positions;
}

/** Count empty squares between two positions on a line (exclusive of endpoints) */
export function emptySquaresBetween(board: (Piece | null)[][], a: Position, b: Position): number | null {
  const between = positionsBetween(a, b);
  if (between === null) return null;
  // All squares between must be empty for this to be valid
  if (between.some(pos => !isEmpty(board, pos))) return null;
  return between.length;
}
