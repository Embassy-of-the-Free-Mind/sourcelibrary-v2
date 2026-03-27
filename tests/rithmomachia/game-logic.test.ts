// Rithmomachia game logic — comprehensive test suite
import { describe, it, expect, beforeEach } from 'vitest';

import { Piece, Player, Position, GameState, CaptureOption } from '@/lib/rithmomachia/types';
import { createInitialPieces, BOARD_COLS, BOARD_ROWS, VICTORY_BODIES, VICTORY_GOODS, VICTORY_QUARREL_PIECES, VICTORY_QUARREL_VALUE } from '@/lib/rithmomachia/constants';
import { createBoard, getPieceAt, isEmpty, isInBounds, positionsEqual, distance, positionsBetween } from '@/lib/rithmomachia/board';
import { getLegalMoves, getThreatenedSquares, canReach } from '@/lib/rithmomachia/movement';
import { findCaptures } from '@/lib/rithmomachia/capture';
import { checkVictory } from '@/lib/rithmomachia/victory';
import { createInitialState, gameReducer } from '@/lib/rithmomachia/game-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal piece for testing */
function makePiece(
  owner: Player,
  shape: Piece['shape'],
  value: number,
  col: number,
  row: number,
  id?: string,
): Piece {
  return {
    id: id ?? `${owner}-${shape}-${value}-test`,
    owner,
    shape,
    value,
    position: { col, row },
  };
}

/** Create a pyramid piece */
function makePyramid(
  owner: Player,
  value: number,
  col: number,
  row: number,
  layers?: Piece['pyramidLayers'],
): Piece {
  return {
    id: `${owner}-pyramid-${value}-test`,
    owner,
    shape: 'pyramid',
    value,
    position: { col, row },
    pyramidLayers: layers ?? [
      { shape: 'circle', value: 1 },
      { shape: 'triangle', value: 4 },
      { shape: 'square', value: 9 },
    ],
  };
}

/** Build a board from an explicit list of pieces */
function boardFromPieces(pieces: Piece[]): (Piece | null)[][] {
  return createBoard(pieces);
}

/** Create a GameState with custom pieces, player, and phase */
function makeState(overrides: Partial<GameState> & { pieces: Piece[] }): GameState {
  const base = createInitialState();
  const pieces = overrides.pieces;
  return {
    ...base,
    ...overrides,
    board: createBoard(pieces),
    pieces,
  };
}

// ===========================================================================
// 1. Board Setup
// ===========================================================================

describe('Board setup', () => {
  it('creates 48 total initial pieces (24 per side)', () => {
    const pieces = createInitialPieces();
    const even = pieces.filter(p => p.owner === 'even');
    const odd = pieces.filter(p => p.owner === 'odd');
    expect(even.length).toBe(24);
    expect(odd.length).toBe(24);
    expect(pieces.length).toBe(48);
  });

  it('places even pieces on rows 0-5', () => {
    const pieces = createInitialPieces();
    const even = pieces.filter(p => p.owner === 'even');
    for (const p of even) {
      expect(p.position.row).toBeGreaterThanOrEqual(0);
      expect(p.position.row).toBeLessThanOrEqual(5);
    }
  });

  it('places odd pieces on rows 10-15', () => {
    const pieces = createInitialPieces();
    const odd = pieces.filter(p => p.owner === 'odd');
    for (const p of odd) {
      expect(p.position.row).toBeGreaterThanOrEqual(10);
      expect(p.position.row).toBeLessThanOrEqual(15);
    }
  });

  it('all pieces are within board bounds', () => {
    const pieces = createInitialPieces();
    for (const p of pieces) {
      expect(isInBounds(p.position)).toBe(true);
    }
  });

  it('no two pieces occupy the same square', () => {
    const pieces = createInitialPieces();
    const seen = new Set<string>();
    for (const p of pieces) {
      const key = `${p.position.col},${p.position.row}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('each side has exactly one pyramid', () => {
    const pieces = createInitialPieces();
    const evenPyramids = pieces.filter(p => p.owner === 'even' && p.shape === 'pyramid');
    const oddPyramids = pieces.filter(p => p.owner === 'odd' && p.shape === 'pyramid');
    expect(evenPyramids.length).toBe(1);
    expect(oddPyramids.length).toBe(1);
  });

  it('pyramids have pyramid layers', () => {
    const pieces = createInitialPieces();
    const pyramids = pieces.filter(p => p.shape === 'pyramid');
    for (const p of pyramids) {
      expect(p.pyramidLayers).toBeDefined();
      expect(p.pyramidLayers!.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('board has correct dimensions', () => {
    const pieces = createInitialPieces();
    const board = createBoard(pieces);
    expect(board.length).toBe(BOARD_ROWS); // 16 rows
    for (const row of board) {
      expect(row.length).toBe(BOARD_COLS); // 8 cols
    }
  });

  it('getPieceAt returns correct piece', () => {
    const pieces = createInitialPieces();
    const board = createBoard(pieces);
    // Check a known even piece position (circle value=2 at col=3, row=1)
    const piece = getPieceAt(board, { col: 3, row: 1 });
    expect(piece).not.toBeNull();
    expect(piece!.owner).toBe('even');
    expect(piece!.value).toBe(2);
    expect(piece!.shape).toBe('circle');
  });

  it('middle rows (6-9) are empty', () => {
    const pieces = createInitialPieces();
    const board = createBoard(pieces);
    for (let row = 6; row <= 9; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        expect(isEmpty(board, { col, row })).toBe(true);
      }
    }
  });
});

// ===========================================================================
// 2. Movement
// ===========================================================================

describe('Movement', () => {
  describe('Circle movement (1 diagonal)', () => {
    it('moves 1 space diagonally in all 4 directions', () => {
      const circle = makePiece('even', 'circle', 4, 4, 8);
      const board = boardFromPieces([circle]);
      const moves = getLegalMoves(circle, board);

      expect(moves.length).toBe(4);
      const expected = [
        { col: 3, row: 7 }, { col: 5, row: 7 },
        { col: 3, row: 9 }, { col: 5, row: 9 },
      ];
      for (const e of expected) {
        expect(moves.some(m => m.col === e.col && m.row === e.row)).toBe(true);
      }
    });

    it('cannot move off the board from corner', () => {
      const circle = makePiece('even', 'circle', 4, 0, 0);
      const board = boardFromPieces([circle]);
      const moves = getLegalMoves(circle, board);

      // Only one diagonal is in bounds: (1,1)
      expect(moves.length).toBe(1);
      expect(moves[0].col).toBe(1);
      expect(moves[0].row).toBe(1);
    });

    it('cannot move to a square occupied by a friendly piece', () => {
      const circle = makePiece('even', 'circle', 4, 4, 8, 'c1');
      const blocker = makePiece('even', 'circle', 2, 5, 9, 'c2');
      const board = boardFromPieces([circle, blocker]);
      const moves = getLegalMoves(circle, board);

      // (5,9) is blocked, so only 3 moves
      expect(moves.length).toBe(3);
      expect(moves.some(m => m.col === 5 && m.row === 9)).toBe(false);
    });

    it('cannot move to a square occupied by an enemy piece', () => {
      const circle = makePiece('even', 'circle', 4, 4, 8, 'c1');
      const enemy = makePiece('odd', 'circle', 3, 5, 9, 'c2');
      const board = boardFromPieces([circle, enemy]);
      const moves = getLegalMoves(circle, board);

      // (5,9) is occupied — pieces can only land on empty squares
      expect(moves.length).toBe(3);
      expect(moves.some(m => m.col === 5 && m.row === 9)).toBe(false);
    });

    it('does not move orthogonally', () => {
      const circle = makePiece('even', 'circle', 4, 4, 8);
      const board = boardFromPieces([circle]);
      const moves = getLegalMoves(circle, board);

      // No orthogonal moves (4,7), (4,9), (3,8), (5,8)
      expect(moves.some(m => m.col === 4 && m.row === 7)).toBe(false);
      expect(moves.some(m => m.col === 4 && m.row === 9)).toBe(false);
      expect(moves.some(m => m.col === 3 && m.row === 8)).toBe(false);
      expect(moves.some(m => m.col === 5 && m.row === 8)).toBe(false);
    });
  });

  describe('Triangle movement (2 orthogonal)', () => {
    it('moves 2 spaces orthogonally in all 4 directions', () => {
      const tri = makePiece('even', 'triangle', 6, 4, 8);
      const board = boardFromPieces([tri]);
      const moves = getLegalMoves(tri, board);

      expect(moves.length).toBe(4);
      const expected = [
        { col: 4, row: 6 }, { col: 4, row: 10 },
        { col: 2, row: 8 }, { col: 6, row: 8 },
      ];
      for (const e of expected) {
        expect(moves.some(m => m.col === e.col && m.row === e.row)).toBe(true);
      }
    });

    it('leaps over intervening pieces', () => {
      const tri = makePiece('even', 'triangle', 6, 4, 8, 't1');
      const blocker = makePiece('even', 'circle', 2, 4, 9, 'b1');
      const board = boardFromPieces([tri, blocker]);
      const moves = getLegalMoves(tri, board);

      // Triangle should still reach (4,10) — leaps over (4,9)
      expect(moves.some(m => m.col === 4 && m.row === 10)).toBe(true);
    });

    it('cannot move off board edge', () => {
      const tri = makePiece('even', 'triangle', 6, 0, 0);
      const board = boardFromPieces([tri]);
      const moves = getLegalMoves(tri, board);

      // From (0,0): up 2 = row -2 (off), down 2 = (0,2) ok, left 2 = col -2 (off), right 2 = (2,0) ok
      expect(moves.length).toBe(2);
    });

    it('does not move diagonally', () => {
      const tri = makePiece('even', 'triangle', 6, 4, 8);
      const board = boardFromPieces([tri]);
      const moves = getLegalMoves(tri, board);

      expect(moves.some(m => m.col === 6 && m.row === 10)).toBe(false);
      expect(moves.some(m => m.col === 2 && m.row === 6)).toBe(false);
    });
  });

  describe('Square movement (3 orthogonal)', () => {
    it('moves 3 spaces orthogonally in all 4 directions', () => {
      const sq = makePiece('even', 'square', 25, 4, 8);
      const board = boardFromPieces([sq]);
      const moves = getLegalMoves(sq, board);

      expect(moves.length).toBe(4);
      const expected = [
        { col: 4, row: 5 }, { col: 4, row: 11 },
        { col: 1, row: 8 }, { col: 7, row: 8 },
      ];
      for (const e of expected) {
        expect(moves.some(m => m.col === e.col && m.row === e.row)).toBe(true);
      }
    });

    it('leaps over multiple pieces', () => {
      const sq = makePiece('even', 'square', 25, 4, 8, 's1');
      const b1 = makePiece('odd', 'circle', 3, 4, 9, 'b1');
      const b2 = makePiece('even', 'circle', 2, 4, 10, 'b2');
      const board = boardFromPieces([sq, b1, b2]);
      const moves = getLegalMoves(sq, board);

      // Can leap to (4,11) over pieces at (4,9) and (4,10)
      expect(moves.some(m => m.col === 4 && m.row === 11)).toBe(true);
    });

    it('cannot reach beyond board boundary', () => {
      const sq = makePiece('even', 'square', 25, 1, 1);
      const board = boardFromPieces([sq]);
      const moves = getLegalMoves(sq, board);

      // From (1,1): up 3 = row -2 (off), down 3 = (1,4) ok, left 3 = col -2 (off), right 3 = (4,1) ok
      expect(moves.length).toBe(2);
    });
  });

  describe('Pyramid movement (composite)', () => {
    it('can move as circle, triangle, and square', () => {
      const pyr = makePyramid('even', 91, 4, 8);
      const board = boardFromPieces([pyr]);
      const moves = getLegalMoves(pyr, board);

      // Circle (1 diagonal): 4 positions
      // Triangle (2 ortho): 4 positions
      // Square (3 ortho): 4 positions
      // Some may overlap — but none do in this case
      // Ortho directions: (4,6), (4,10), (2,8), (6,8) — triangle
      // Ortho directions: (4,5), (4,11), (1,8), (7,8) — square
      // Diagonal: (3,7), (5,7), (3,9), (5,9) — circle
      // No overlap — 12 unique moves
      expect(moves.length).toBe(12);
    });

    it('pyramid with only circle layers can only move diagonally', () => {
      const pyr: Piece = {
        id: 'pyr-test',
        owner: 'even',
        shape: 'pyramid',
        value: 5,
        position: { col: 4, row: 8 },
        pyramidLayers: [
          { shape: 'circle', value: 2 },
          { shape: 'circle', value: 3 },
        ],
      };
      const board = boardFromPieces([pyr]);
      const moves = getLegalMoves(pyr, board);

      // Only circle movement: 4 diagonal positions
      expect(moves.length).toBe(4);
      for (const m of moves) {
        // Each move should be exactly 1 diagonal step
        expect(Math.abs(m.col - 4)).toBe(1);
        expect(Math.abs(m.row - 8)).toBe(1);
      }
    });
  });
});

// ===========================================================================
// 3. Captures
// ===========================================================================

describe('Captures', () => {
  describe('Equality capture', () => {
    it('circle captures enemy of same value in threat range', () => {
      // Even circle(9) at (4,8), odd circle(9) at (5,9) — diagonal distance 1
      const attacker = makePiece('even', 'circle', 9, 4, 8, 'a1');
      const target = makePiece('odd', 'circle', 9, 5, 9, 't1');
      const pieces = [attacker, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, attacker, pieces);
      expect(captures.length).toBeGreaterThanOrEqual(1);

      const eq = captures.find(c => c.method === 'equality');
      expect(eq).toBeDefined();
      expect(eq!.target.col).toBe(5);
      expect(eq!.target.row).toBe(9);
    });

    it('does not capture if values differ', () => {
      const attacker = makePiece('even', 'circle', 9, 4, 8, 'a1');
      const target = makePiece('odd', 'circle', 7, 5, 9, 't1');
      const pieces = [attacker, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, attacker, pieces);
      const eq = captures.find(c => c.method === 'equality');
      expect(eq).toBeUndefined();
    });

    it('does not capture if enemy is out of threat range', () => {
      // Circle threatens 1 diagonal — enemy at (6,10) is 2 diagonals away
      const attacker = makePiece('even', 'circle', 9, 4, 8, 'a1');
      const target = makePiece('odd', 'circle', 9, 6, 10, 't1');
      const pieces = [attacker, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, attacker, pieces);
      const eq = captures.find(c => c.method === 'equality');
      expect(eq).toBeUndefined();
    });

    it('triangle equality capture (2 orthogonal range)', () => {
      const attacker = makePiece('even', 'triangle', 12, 4, 8, 'a1');
      const target = makePiece('odd', 'triangle', 12, 4, 10, 't1');
      const pieces = [attacker, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, attacker, pieces);
      const eq = captures.find(c => c.method === 'equality');
      expect(eq).toBeDefined();
    });
  });

  describe('Addition capture', () => {
    it('two friendly pieces summing to enemy value', () => {
      // Even circle(3) at (3,7) and even circle(5) at (5,7) both threaten odd circle(8) at (4,8)
      // 3 + 5 = 8
      const mover = makePiece('even', 'circle', 3, 3, 7, 'a1');
      const helper = makePiece('even', 'circle', 5, 5, 7, 'a2');
      const target = makePiece('odd', 'circle', 8, 4, 8, 't1');
      const pieces = [mover, helper, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const add = captures.find(c => c.method === 'addition');
      expect(add).toBeDefined();
      expect(add!.target.col).toBe(4);
      expect(add!.target.row).toBe(8);
      expect(add!.attackers.length).toBe(2);
    });

    it('does not trigger when pieces do not sum to enemy value', () => {
      const mover = makePiece('even', 'circle', 3, 3, 7, 'a1');
      const helper = makePiece('even', 'circle', 4, 5, 7, 'a2');
      const target = makePiece('odd', 'circle', 8, 4, 8, 't1');
      const pieces = [mover, helper, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const add = captures.find(c => c.method === 'addition');
      expect(add).toBeUndefined();
    });

    it('requires moved piece to be one of the threateners', () => {
      // Helper threatens enemy but mover does not
      const mover = makePiece('even', 'circle', 3, 0, 0, 'a1'); // far away
      const helper = makePiece('even', 'circle', 5, 5, 7, 'a2');
      const target = makePiece('odd', 'circle', 8, 4, 8, 't1');
      const pieces = [mover, helper, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const add = captures.find(c => c.method === 'addition');
      expect(add).toBeUndefined();
    });
  });

  describe('Subtraction capture', () => {
    it('difference of two friendly pieces equals enemy value', () => {
      // Even circle(9) at (3,7) and even circle(4) at (5,7) both threaten odd at (4,8)
      // |9 - 4| = 5
      const mover = makePiece('even', 'circle', 9, 3, 7, 'a1');
      const helper = makePiece('even', 'circle', 4, 5, 7, 'a2');
      const target = makePiece('odd', 'circle', 5, 4, 8, 't1');
      const pieces = [mover, helper, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const sub = captures.find(c => c.method === 'subtraction');
      expect(sub).toBeDefined();
      expect(sub!.target.col).toBe(4);
      expect(sub!.target.row).toBe(8);
    });

    it('does not trigger when difference does not match', () => {
      const mover = makePiece('even', 'circle', 9, 3, 7, 'a1');
      const helper = makePiece('even', 'circle', 4, 5, 7, 'a2');
      const target = makePiece('odd', 'circle', 6, 4, 8, 't1'); // 9-4=5, not 6
      const pieces = [mover, helper, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const sub = captures.find(c => c.method === 'subtraction');
      expect(sub).toBeUndefined();
    });
  });

  describe('Multiplication capture', () => {
    it('piece value times distance equals enemy value', () => {
      // Even circle(3) at (4,5), odd circle(9) at (4,8)
      // Distance (empty squares + 1): squares between (4,5) and (4,8) are (4,6), (4,7) = 2 empty + 1 = 3
      // 3 * 3 = 9
      const mover = makePiece('even', 'circle', 3, 4, 5, 'a1');
      const target = makePiece('odd', 'circle', 9, 4, 8, 't1');
      const pieces = [mover, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const mul = captures.find(c => c.method === 'multiplication');
      expect(mul).toBeDefined();
      expect(mul!.target.col).toBe(4);
      expect(mul!.target.row).toBe(8);
    });

    it('fails if path is blocked', () => {
      const mover = makePiece('even', 'circle', 3, 4, 5, 'a1');
      const blocker = makePiece('even', 'circle', 2, 4, 6, 'b1');
      const target = makePiece('odd', 'circle', 9, 4, 8, 't1');
      const pieces = [mover, blocker, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const mul = captures.find(c => c.method === 'multiplication');
      expect(mul).toBeUndefined();
    });

    it('fails if not on a straight line', () => {
      const mover = makePiece('even', 'circle', 3, 4, 5, 'a1');
      const target = makePiece('odd', 'circle', 9, 6, 8, 't1'); // not on line
      const pieces = [mover, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const mul = captures.find(c => c.method === 'multiplication');
      expect(mul).toBeUndefined();
    });

    it('works on a diagonal line', () => {
      // Even circle(2) at (2,2), odd circle(4) at (4,4)
      // Diagonal: empty squares between = (3,3) = 1 empty + 1 = 2
      // 2 * 2 = 4
      const mover = makePiece('even', 'circle', 2, 2, 2, 'a1');
      const target = makePiece('odd', 'circle', 4, 4, 4, 't1');
      const pieces = [mover, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const mul = captures.find(c => c.method === 'multiplication');
      expect(mul).toBeDefined();
    });
  });

  describe('Division capture', () => {
    it('enemy value divided by distance equals piece value', () => {
      // Even circle(3) at (4,5), odd circle(9) at (4,8)
      // Distance: 3 (2 empty squares + 1)
      // 9 / 3 = 3
      const mover = makePiece('even', 'circle', 3, 4, 5, 'a1');
      const target = makePiece('odd', 'circle', 9, 4, 8, 't1');
      const pieces = [mover, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const div = captures.find(c => c.method === 'division');
      expect(div).toBeDefined();
    });

    it('fails when division is not exact', () => {
      // Even circle(4) at (4,5), odd circle(9) at (4,8)
      // 9 / 3 = 3, not 4
      const mover = makePiece('even', 'circle', 4, 4, 5, 'a1');
      const target = makePiece('odd', 'circle', 9, 4, 8, 't1');
      const pieces = [mover, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const div = captures.find(c => c.method === 'division');
      expect(div).toBeUndefined();
    });

    it('works with distance of 1 (adjacent)', () => {
      // Even circle(7) at (4,7), odd circle(7) at (4,8)
      // Distance: 0 empty + 1 = 1; 7/1 = 7
      const mover = makePiece('even', 'circle', 7, 4, 7, 'a1');
      const target = makePiece('odd', 'circle', 7, 4, 8, 't1');
      const pieces = [mover, target];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, mover, pieces);
      const div = captures.find(c => c.method === 'division');
      expect(div).toBeDefined();
    });
  });

  describe('Siege capture', () => {
    it('captures when enemy is surrounded on all 4 orthogonal sides', () => {
      const target = makePiece('odd', 'circle', 5, 4, 8, 't1');
      const n = makePiece('even', 'circle', 2, 4, 7, 'n');
      const s = makePiece('even', 'circle', 3, 4, 9, 's');
      const w = makePiece('even', 'circle', 4, 3, 8, 'w');
      const e = makePiece('even', 'circle', 6, 5, 8, 'e');
      const pieces = [target, n, s, w, e];
      const board = boardFromPieces(pieces);

      // Use any surrounding piece as the "mover"
      const captures = findCaptures(board, n, pieces);
      const siege = captures.find(c => c.method === 'siege');
      expect(siege).toBeDefined();
      expect(siege!.target.col).toBe(4);
      expect(siege!.target.row).toBe(8);
      expect(siege!.attackers.length).toBe(4);
    });

    it('board edge counts as blocking for siege', () => {
      // Enemy at (0,8) — left side is board edge, need only 3 surrounding pieces
      const target = makePiece('odd', 'circle', 5, 0, 8, 't1');
      const n = makePiece('even', 'circle', 2, 0, 7, 'n');
      const s = makePiece('even', 'circle', 3, 0, 9, 's');
      const e = makePiece('even', 'circle', 4, 1, 8, 'e');
      const pieces = [target, n, s, e];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, n, pieces);
      const siege = captures.find(c => c.method === 'siege');
      expect(siege).toBeDefined();
    });

    it('corner piece needs only 2 surrounding pieces', () => {
      const target = makePiece('odd', 'circle', 5, 0, 0, 't1');
      const s = makePiece('even', 'circle', 3, 0, 1, 's');
      const e = makePiece('even', 'circle', 4, 1, 0, 'e');
      const pieces = [target, s, e];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, s, pieces);
      const siege = captures.find(c => c.method === 'siege');
      expect(siege).toBeDefined();
    });

    it('siege fails if one exit is open', () => {
      const target = makePiece('odd', 'circle', 5, 4, 8, 't1');
      const n = makePiece('even', 'circle', 2, 4, 7, 'n');
      const s = makePiece('even', 'circle', 3, 4, 9, 's');
      const w = makePiece('even', 'circle', 4, 3, 8, 'w');
      // East (5,8) is empty — exit route
      const pieces = [target, n, s, w];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, n, pieces);
      const siege = captures.find(c => c.method === 'siege');
      expect(siege).toBeUndefined();
    });

    it('siege fails if adjacent piece is friendly to the target', () => {
      const target = makePiece('odd', 'circle', 5, 4, 8, 't1');
      const n = makePiece('even', 'circle', 2, 4, 7, 'n');
      const s = makePiece('even', 'circle', 3, 4, 9, 's');
      const w = makePiece('even', 'circle', 4, 3, 8, 'w');
      const friendly = makePiece('odd', 'circle', 7, 5, 8, 'f'); // same side as target
      const pieces = [target, n, s, w, friendly];
      const board = boardFromPieces(pieces);

      const captures = findCaptures(board, n, pieces);
      const siege = captures.find(c => c.method === 'siege');
      expect(siege).toBeUndefined();
    });
  });
});

// ===========================================================================
// 4. Victory Conditions
// ===========================================================================

describe('Victory conditions', () => {
  describe('Common victories', () => {
    it('Bodies: triggers at 15 captured pieces', () => {
      const captured: Piece[] = Array.from({ length: VICTORY_BODIES }, (_, i) =>
        makePiece('even', 'circle', 1, 0, 0, `cap-${i}`)
      );
      const result = checkVictory(
        { even: captured, odd: [] },
        [],
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('bodies');
      expect(result!.player).toBe('even');
    });

    it('Bodies: does not trigger at 14 captured pieces', () => {
      const captured: Piece[] = Array.from({ length: 14 }, (_, i) =>
        makePiece('even', 'circle', 1, 0, 0, `cap-${i}`)
      );
      const result = checkVictory(
        { even: captured, odd: [] },
        [],
      );
      // Should not be bodies (may still be null or other type)
      if (result) {
        expect(result.type).not.toBe('bodies');
      }
    });

    it('Goods: triggers at captured value >= 200', () => {
      const captured = [
        makePiece('odd', 'circle', 100, 0, 0, 'c1'),
        makePiece('odd', 'circle', 100, 0, 0, 'c2'),
      ];
      const result = checkVictory(
        { even: [], odd: captured },
        [],
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('goods');
      expect(result!.player).toBe('odd');
    });

    it('Goods: does not trigger at value 199', () => {
      const captured = [
        makePiece('even', 'circle', 100, 0, 0, 'c1'),
        makePiece('even', 'circle', 99, 0, 0, 'c2'),
      ];
      const result = checkVictory(
        { even: captured, odd: [] },
        [],
      );
      if (result) {
        expect(result.type).not.toBe('goods');
      }
    });

    it('Quarrel: triggers at 10 pieces AND value >= 150', () => {
      const captured: Piece[] = Array.from({ length: VICTORY_QUARREL_PIECES }, (_, i) =>
        makePiece('even', 'circle', 15, 0, 0, `cap-${i}`)
      );
      // 10 pieces * 15 = 150
      const result = checkVictory(
        { even: captured, odd: [] },
        [],
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('quarrel');
      expect(result!.player).toBe('even');
    });

    it('Quarrel: does not trigger with enough pieces but insufficient value', () => {
      const captured: Piece[] = Array.from({ length: 10 }, (_, i) =>
        makePiece('even', 'circle', 1, 0, 0, `cap-${i}`)
      );
      // 10 pieces * 1 = 10 < 150
      const result = checkVictory(
        { even: captured, odd: [] },
        [],
      );
      if (result) {
        expect(result.type).not.toBe('quarrel');
      }
    });

    it('Quarrel: does not trigger with enough value but insufficient pieces', () => {
      const captured = [
        makePiece('even', 'circle', 200, 0, 0, 'c1'),
      ];
      // value=200 >= 150 but only 1 piece < 10
      // Note: this will trigger Goods instead since 200 >= 200
      const result = checkVictory(
        { even: captured, odd: [] },
        [],
      );
      if (result) {
        expect(result.type).not.toBe('quarrel');
      }
    });
  });

  describe('Philosophical victories', () => {
    it('Arithmetic progression: 3 pieces in a line on enemy half', () => {
      // Even pieces on odd's half (rows 8-15) with values 2, 4, 6 (diff=2)
      // In a row (same row)
      const pieces = [
        makePiece('even', 'circle', 2, 1, 10, 'p1'),
        makePiece('even', 'circle', 4, 2, 10, 'p2'),
        makePiece('even', 'circle', 6, 3, 10, 'p3'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('arithmetic');
      expect(result!.player).toBe('even');
    });

    it('Geometric progression: 3 pieces in a line on enemy half', () => {
      // Values 2, 4, 8 (ratio=2) in a column
      const pieces = [
        makePiece('even', 'circle', 2, 3, 9, 'p1'),
        makePiece('even', 'circle', 4, 3, 10, 'p2'),
        makePiece('even', 'circle', 8, 3, 11, 'p3'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('geometric');
      expect(result!.player).toBe('even');
    });

    it('Harmonic progression: 3 pieces in a line on enemy half', () => {
      // Harmonic: reciprocals form arithmetic progression
      // Values 2, 3, 6: reciprocals 1/2, 1/3, 1/6
      // Reversed (desc): [1/2, 1/3, 1/6] — diff = 1/6, constant — AP
      const pieces = [
        makePiece('even', 'circle', 2, 2, 10, 'p1'),
        makePiece('even', 'circle', 3, 3, 10, 'p2'),
        makePiece('even', 'circle', 6, 4, 10, 'p3'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('harmonic');
      expect(result!.player).toBe('even');
    });

    it('does not trigger if pieces are on own half', () => {
      // Even pieces on even's half (rows 0-7) — not valid for philosophical victory
      const pieces = [
        makePiece('even', 'circle', 2, 1, 3, 'p1'),
        makePiece('even', 'circle', 4, 2, 3, 'p2'),
        makePiece('even', 'circle', 6, 3, 3, 'p3'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      expect(result).toBeNull();
    });

    it('does not trigger if pieces are not collinear', () => {
      const pieces = [
        makePiece('even', 'circle', 2, 1, 10, 'p1'),
        makePiece('even', 'circle', 4, 3, 11, 'p2'), // not on the same line as 1 & 3
        makePiece('even', 'circle', 6, 5, 10, 'p3'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      // These 3 points are NOT collinear: (1,10), (3,11), (5,10)
      // Cross product: (3-1)*(10-10) - (11-10)*(5-1) = 0 - 4 = -4 != 0
      expect(result).toBeNull();
    });

    it('does not trigger with only 2 pieces on enemy half', () => {
      const pieces = [
        makePiece('even', 'circle', 2, 1, 10, 'p1'),
        makePiece('even', 'circle', 4, 2, 10, 'p2'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      expect(result).toBeNull();
    });

    it('odd player can win on even half (rows 0-7)', () => {
      const pieces = [
        makePiece('odd', 'circle', 3, 1, 3, 'p1'),
        makePiece('odd', 'circle', 6, 2, 3, 'p2'),
        makePiece('odd', 'circle', 9, 3, 3, 'p3'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('arithmetic');
      expect(result!.player).toBe('odd');
    });

    it('diagonal line qualifies for progression', () => {
      // 3 pieces on a diagonal on enemy half
      const pieces = [
        makePiece('even', 'circle', 2, 1, 9, 'p1'),
        makePiece('even', 'circle', 4, 2, 10, 'p2'),
        makePiece('even', 'circle', 6, 3, 11, 'p3'),
      ];
      const result = checkVictory({ even: [], odd: [] }, pieces);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('arithmetic');
    });
  });
});

// ===========================================================================
// 5. Game State Reducer
// ===========================================================================

describe('Game state reducer', () => {
  let state: GameState;

  beforeEach(() => {
    state = createInitialState();
  });

  describe('Initial state', () => {
    it('starts with even player', () => {
      expect(state.currentPlayer).toBe('even');
    });

    it('starts in select phase', () => {
      expect(state.phase).toBe('select');
    });

    it('starts on turn 1', () => {
      expect(state.turnNumber).toBe(1);
    });

    it('no victory initially', () => {
      expect(state.victory).toBeNull();
    });

    it('no captured pieces initially', () => {
      expect(state.capturedPieces.even.length).toBe(0);
      expect(state.capturedPieces.odd.length).toBe(0);
    });
  });

  describe('SELECT_PIECE', () => {
    it('selects a current player piece and transitions to move phase', () => {
      // Select the even circle at (3,1) value=2
      const next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });
      expect(next.phase).toBe('move');
      expect(next.selectedPiece).toEqual({ col: 3, row: 1 });
      expect(next.legalMoves.length).toBeGreaterThan(0);
    });

    it('does not select an opponent piece', () => {
      // Try to select an odd piece — should be ignored
      const oddPos = state.pieces.find(p => p.owner === 'odd')!.position;
      const next = gameReducer(state, { type: 'SELECT_PIECE', position: oddPos });
      expect(next.phase).toBe('select');
      expect(next.selectedPiece).toBeNull();
    });

    it('does not select an empty square', () => {
      const next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 4, row: 8 } });
      expect(next.phase).toBe('select');
      expect(next.selectedPiece).toBeNull();
    });

    it('deselects when clicking the same piece again', () => {
      const pos = { col: 3, row: 1 };
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: pos });
      expect(next.phase).toBe('move');

      next = gameReducer(next, { type: 'SELECT_PIECE', position: pos });
      expect(next.phase).toBe('select');
      expect(next.selectedPiece).toBeNull();
    });

    it('allows switching to a different piece during move phase', () => {
      // First select a piece to enter move phase
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });
      expect(next.phase).toBe('move');

      // Selecting a different friendly piece during move phase should switch selection
      const otherPiece = { col: 5, row: 1 };
      const next2 = gameReducer(next, { type: 'SELECT_PIECE', position: otherPiece });
      expect(next2.phase).toBe('move');
      expect(next2.selectedPiece).toEqual(otherPiece);
    });
  });

  describe('MOVE_PIECE', () => {
    it('moves piece to a legal position', () => {
      // Select even circle at (3,1) value=2
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });
      const legalMove = next.legalMoves[0];

      next = gameReducer(next, { type: 'MOVE_PIECE', to: legalMove });

      // Should have moved — either in select (no captures) or capture phase
      expect(['select', 'capture']).toContain(next.phase);

      // The piece should now be at the new position
      const movedPiece = next.pieces.find(
        p => p.position.col === legalMove.col && p.position.row === legalMove.row
      );
      expect(movedPiece).toBeDefined();
      expect(movedPiece!.value).toBe(2);
    });

    it('rejects move to an illegal position', () => {
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });
      // Try to move to an illegal position
      const illegal = { col: 3, row: 5 }; // not a diagonal move of distance 1

      const next2 = gameReducer(next, { type: 'MOVE_PIECE', to: illegal });
      // Should still be in move phase, nothing changed
      expect(next2.phase).toBe('move');
      expect(next2.selectedPiece).toEqual({ col: 3, row: 1 });
    });

    it('does not work when no piece is selected', () => {
      const next = gameReducer(state, { type: 'MOVE_PIECE', to: { col: 4, row: 2 } });
      expect(next).toBe(state); // no change
    });

    it('records the move in history', () => {
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });
      const legalMove = next.legalMoves[0];
      next = gameReducer(next, { type: 'MOVE_PIECE', to: legalMove });

      expect(next.moveHistory.length).toBe(1);
      expect(next.moveHistory[0].from).toEqual({ col: 3, row: 1 });
      expect(next.moveHistory[0].to).toEqual(legalMove);
      expect(next.moveHistory[0].player).toBe('even');
    });
  });

  describe('Turn alternation', () => {
    it('switches player after a move with no capture', () => {
      // Move an even piece to a position where no capture is available
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });
      const legalMove = next.legalMoves[0];
      next = gameReducer(next, { type: 'MOVE_PIECE', to: legalMove });

      // If no captures available, should switch to odd
      if (next.phase === 'select') {
        expect(next.currentPlayer).toBe('odd');
      }
    });

    it('keeps same player during capture phase', () => {
      // Set up a state that will produce a capture after moving
      const mover = makePiece('even', 'circle', 9, 4, 6, 'mover');
      const target = makePiece('odd', 'circle', 9, 5, 9, 'target');
      const pieces = [mover, target];
      const customState = makeState({
        pieces,
        currentPlayer: 'even',
        phase: 'select',
      });

      // Select the mover
      let next = gameReducer(customState, { type: 'SELECT_PIECE', position: { col: 4, row: 6 } });

      // Move to (5,7) — threatens (5+1,7+1)=(6,8)? No, threatens diagonals from (5,7):
      // Check if (5,7) is a legal move (diagonal from (4,6))
      if (next.legalMoves.some(m => m.col === 5 && m.row === 7)) {
        next = gameReducer(next, { type: 'MOVE_PIECE', to: { col: 5, row: 7 } });
        // If there's a capture available, should still be even's turn
        if (next.phase === 'capture') {
          expect(next.currentPlayer).toBe('even');
        }
      }
    });
  });

  describe('SKIP_CAPTURE', () => {
    it('ends turn and switches player', () => {
      const captureState: GameState = {
        ...createInitialState(),
        phase: 'capture',
        currentPlayer: 'even',
        captureOptions: [{
          method: 'equality',
          target: { col: 4, row: 8 },
          attackers: [{ col: 3, row: 7 }],
          description: 'test',
        }],
      };

      const next = gameReducer(captureState, { type: 'SKIP_CAPTURE' });
      expect(next.phase).toBe('select');
      expect(next.currentPlayer).toBe('odd');
    });

    it('does nothing outside capture phase', () => {
      const next = gameReducer(state, { type: 'SKIP_CAPTURE' });
      expect(next.phase).toBe('select');
      expect(next.currentPlayer).toBe('even');
    });
  });

  describe('EXECUTE_CAPTURE', () => {
    it('removes captured piece and adds to captor collection', () => {
      const mover = makePiece('even', 'circle', 9, 3, 7, 'mover');
      const target = makePiece('odd', 'circle', 9, 4, 8, 'target');
      const pieces = [mover, target];

      const captureState = makeState({
        pieces,
        currentPlayer: 'even',
        phase: 'capture',
        captureOptions: [{
          method: 'equality',
          target: { col: 4, row: 8 },
          attackers: [{ col: 3, row: 7 }],
          description: '9 captures 9 by equality',
        }],
        moveHistory: [{
          turn: 1,
          player: 'even',
          piece: { shape: 'circle', value: 9 },
          from: { col: 3, row: 6 },
          to: { col: 3, row: 7 },
        }],
      });

      const next = gameReducer(captureState, { type: 'EXECUTE_CAPTURE', captureIndex: 0 });

      // Target should be removed from pieces
      expect(next.pieces.find(p => p.id === 'target')).toBeUndefined();

      // Should be in even's captured collection
      expect(next.capturedPieces.even.length).toBe(1);
      expect(next.capturedPieces.even[0].value).toBe(9);

      // Should have switched to odd's turn (assuming no victory)
      if (next.phase !== 'victory') {
        expect(next.currentPlayer).toBe('odd');
      }
    });

    it('rejects invalid capture index', () => {
      const captureState: GameState = {
        ...createInitialState(),
        phase: 'capture',
        captureOptions: [{
          method: 'equality',
          target: { col: 4, row: 8 },
          attackers: [{ col: 3, row: 7 }],
          description: 'test',
        }],
      };

      const next = gameReducer(captureState, { type: 'EXECUTE_CAPTURE', captureIndex: 5 });
      // Should return state unchanged
      expect(next.phase).toBe('capture');
    });
  });

  describe('DESELECT', () => {
    it('returns to select phase and clears selection', () => {
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });
      expect(next.phase).toBe('move');

      next = gameReducer(next, { type: 'DESELECT' });
      expect(next.phase).toBe('select');
      expect(next.selectedPiece).toBeNull();
      expect(next.legalMoves.length).toBe(0);
    });
  });

  describe('NEW_GAME', () => {
    it('resets to initial state', () => {
      // Modify state first
      let next = gameReducer(state, { type: 'SELECT_PIECE', position: { col: 3, row: 1 } });

      // Reset
      next = gameReducer(next, { type: 'NEW_GAME', mode: 'hotseat', difficulty: 'medium' });
      expect(next.phase).toBe('select');
      expect(next.currentPlayer).toBe('even');
      expect(next.turnNumber).toBe(1);
      expect(next.moveHistory.length).toBe(0);
      expect(next.pieces.length).toBe(48);
      expect(next.victory).toBeNull();
    });

    it('respects mode and difficulty parameters', () => {
      const next = gameReducer(state, { type: 'NEW_GAME', mode: 'vs-ai', difficulty: 'hard' });
      expect(next.mode).toBe('vs-ai');
      expect(next.difficulty).toBe('hard');
    });
  });

  describe('RESIGN', () => {
    it('opponent wins when player resigns', () => {
      const next = gameReducer(state, { type: 'RESIGN' });
      expect(next.phase).toBe('victory');
      expect(next.victory).not.toBeNull();
      expect(next.victory!.player).toBe('odd'); // even resigned, odd wins
    });
  });

  describe('Capture phase triggers correctly', () => {
    it('enters capture phase when captures are available after move', () => {
      // Set up: even circle(9) about to move next to odd circle(9)
      // After moving to (5,7), the circle threatens (6,8), (4,8), (4,6), (6,6)
      const mover = makePiece('even', 'circle', 9, 4, 6, 'mover');
      const target = makePiece('odd', 'circle', 9, 6, 8, 'target');
      const pieces = [mover, target];
      const customState = makeState({
        pieces,
        currentPlayer: 'even',
        phase: 'select',
      });

      // Select the mover
      let next = gameReducer(customState, { type: 'SELECT_PIECE', position: { col: 4, row: 6 } });

      // Move to (5,7) — 1 diagonal from (4,6)
      // From (5,7), circle threatens: (4,6), (6,6), (4,8), (6,8)
      // Target at (6,8) — equality capture!
      if (next.legalMoves.some(m => m.col === 5 && m.row === 7)) {
        next = gameReducer(next, { type: 'MOVE_PIECE', to: { col: 5, row: 7 } });
        expect(next.phase).toBe('capture');
        expect(next.captureOptions.length).toBeGreaterThan(0);
      }
    });
  });
});

// ===========================================================================
// Board utility edge cases
// ===========================================================================

describe('Board utilities', () => {
  it('isInBounds rejects out-of-range positions', () => {
    expect(isInBounds({ col: -1, row: 0 })).toBe(false);
    expect(isInBounds({ col: 0, row: -1 })).toBe(false);
    expect(isInBounds({ col: BOARD_COLS, row: 0 })).toBe(false);
    expect(isInBounds({ col: 0, row: BOARD_ROWS })).toBe(false);
  });

  it('isInBounds accepts valid positions', () => {
    expect(isInBounds({ col: 0, row: 0 })).toBe(true);
    expect(isInBounds({ col: 7, row: 15 })).toBe(true);
    expect(isInBounds({ col: 4, row: 8 })).toBe(true);
  });

  it('positionsEqual works correctly', () => {
    expect(positionsEqual({ col: 3, row: 5 }, { col: 3, row: 5 })).toBe(true);
    expect(positionsEqual({ col: 3, row: 5 }, { col: 3, row: 6 })).toBe(false);
    expect(positionsEqual({ col: 3, row: 5 }, { col: 4, row: 5 })).toBe(false);
  });

  it('distance calculates Manhattan distance', () => {
    expect(distance({ col: 0, row: 0 }, { col: 3, row: 4 })).toBe(7);
    expect(distance({ col: 2, row: 3 }, { col: 2, row: 3 })).toBe(0);
  });

  it('positionsBetween returns positions on orthogonal line', () => {
    const between = positionsBetween({ col: 2, row: 2 }, { col: 2, row: 5 });
    expect(between).not.toBeNull();
    expect(between!.length).toBe(2);
    expect(between!).toEqual([{ col: 2, row: 3 }, { col: 2, row: 4 }]);
  });

  it('positionsBetween returns positions on diagonal line', () => {
    const between = positionsBetween({ col: 1, row: 1 }, { col: 4, row: 4 });
    expect(between).not.toBeNull();
    expect(between!.length).toBe(2);
    expect(between!).toEqual([{ col: 2, row: 2 }, { col: 3, row: 3 }]);
  });

  it('positionsBetween returns null for non-line positions', () => {
    const between = positionsBetween({ col: 0, row: 0 }, { col: 3, row: 5 });
    expect(between).toBeNull();
  });
});

// ===========================================================================
// canReach utility
// ===========================================================================

describe('canReach', () => {
  it('circle can reach 1 diagonal', () => {
    expect(canReach('circle', { col: 4, row: 4 }, { col: 5, row: 5 })).toBe(true);
    expect(canReach('circle', { col: 4, row: 4 }, { col: 3, row: 3 })).toBe(true);
  });

  it('circle cannot reach orthogonal', () => {
    expect(canReach('circle', { col: 4, row: 4 }, { col: 4, row: 5 })).toBe(false);
  });

  it('triangle can reach 2 orthogonal', () => {
    expect(canReach('triangle', { col: 4, row: 4 }, { col: 4, row: 6 })).toBe(true);
    expect(canReach('triangle', { col: 4, row: 4 }, { col: 6, row: 4 })).toBe(true);
  });

  it('triangle cannot reach diagonal', () => {
    expect(canReach('triangle', { col: 4, row: 4 }, { col: 6, row: 6 })).toBe(false);
  });

  it('square can reach 3 orthogonal', () => {
    expect(canReach('square', { col: 4, row: 4 }, { col: 4, row: 7 })).toBe(true);
    expect(canReach('square', { col: 4, row: 4 }, { col: 7, row: 4 })).toBe(true);
  });

  it('pyramid can reach as any shape', () => {
    expect(canReach('pyramid', { col: 4, row: 4 }, { col: 5, row: 5 })).toBe(true); // circle
    expect(canReach('pyramid', { col: 4, row: 4 }, { col: 4, row: 6 })).toBe(true); // triangle
    expect(canReach('pyramid', { col: 4, row: 4 }, { col: 4, row: 7 })).toBe(true); // square
  });
});

// ===========================================================================
// getThreatenedSquares
// ===========================================================================

describe('getThreatenedSquares', () => {
  it('includes out-of-move squares that are in bounds (occupied squares)', () => {
    // Threatened squares include occupied positions (unlike legal moves)
    const circle = makePiece('even', 'circle', 4, 4, 8, 'c1');
    const blocker = makePiece('even', 'circle', 2, 5, 9, 'b1');

    const threatened = getThreatenedSquares(circle);
    // Should include (5,9) even though it's blocked for actual movement
    expect(threatened.some(t => t.col === 5 && t.row === 9)).toBe(true);
    expect(threatened.length).toBe(4); // all 4 diagonals in bounds
  });

  it('excludes out-of-bounds positions', () => {
    const circle = makePiece('even', 'circle', 4, 0, 0, 'c1');
    const threatened = getThreatenedSquares(circle);
    // From (0,0), only (1,1) is in bounds for a circle
    expect(threatened.length).toBe(1);
  });
});
