// Capture logic — all 6 methods from Lever & Fulke's "first kind of play"
//
// Captures happen AFTER a move. The moving player checks if their piece
// (in its new position) or any combination of their pieces can capture
// an enemy piece.

import { Piece, Player, Position, CaptureOption } from './types';
import { isInBounds, getPieceAt, positionKey, isOnLine, emptySquaresBetween } from './board';
import { getThreatenedSquares } from './movement';
import { BOARD_COLS, BOARD_ROWS } from './constants';

/**
 * Find all available captures for the current player after their move.
 * Returns a list of capture options — the player can execute one or skip.
 */
export function findCaptures(
  board: (Piece | null)[][],
  movedPiece: Piece,
  allPieces: Piece[],
): CaptureOption[] {
  const options: CaptureOption[] = [];
  const player = movedPiece.owner;
  const seen = new Set<string>(); // avoid duplicate captures

  // Get all friendly pieces (including the moved one)
  const friendlyPieces = allPieces.filter(p => p.owner === player);
  const enemyPieces = allPieces.filter(p => p.owner !== player);

  for (const enemy of enemyPieces) {
    // 1. Equality capture (moved piece only)
    const eqCapture = checkEquality(movedPiece, enemy);
    if (eqCapture) {
      const key = `equality-${positionKey(enemy.position)}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push(eqCapture);
      }
    }

    // 2. Addition capture
    const addCaptures = checkAddition(friendlyPieces, enemy, movedPiece);
    for (const cap of addCaptures) {
      const key = `addition-${positionKey(enemy.position)}-${cap.attackers.map(positionKey).sort().join('+')}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push(cap);
      }
    }

    // 3. Subtraction capture
    const subCaptures = checkSubtraction(friendlyPieces, enemy, movedPiece);
    for (const cap of subCaptures) {
      const key = `subtraction-${positionKey(enemy.position)}-${cap.attackers.map(positionKey).sort().join('+')}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push(cap);
      }
    }

    // 4. Multiplication capture (moved piece only)
    const mulCapture = checkMultiplication(board, movedPiece, enemy);
    if (mulCapture) {
      const key = `multiplication-${positionKey(enemy.position)}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push(mulCapture);
      }
    }

    // 5. Division capture (moved piece only)
    const divCapture = checkDivision(board, movedPiece, enemy);
    if (divCapture) {
      const key = `division-${positionKey(enemy.position)}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push(divCapture);
      }
    }

    // 6. Siege capture
    const siegeCapture = checkSiege(board, enemy, friendlyPieces);
    if (siegeCapture) {
      const key = `siege-${positionKey(enemy.position)}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push(siegeCapture);
      }
    }
  }

  return options;
}

/**
 * Equality: the moved piece threatens an enemy of equal value.
 */
function checkEquality(mover: Piece, enemy: Piece): CaptureOption | null {
  if (mover.value !== enemy.value) return null;

  const threatened = getThreatenedSquares(mover);
  const threatens = threatened.some(
    t => t.col === enemy.position.col && t.row === enemy.position.row
  );

  if (!threatens) return null;

  return {
    method: 'equality',
    target: enemy.position,
    attackers: [mover.position],
    description: `${mover.value} captures ${enemy.value} by equality`,
  };
}

/**
 * Addition: 2+ friendly pieces threaten the same enemy, and their values sum to the enemy's value.
 * At least one must be the moved piece.
 */
function checkAddition(
  friendlies: Piece[],
  enemy: Piece,
  movedPiece: Piece,
): CaptureOption[] {
  const captures: CaptureOption[] = [];

  // Find all friendly pieces that threaten the enemy
  const threateners = friendlies.filter(p => {
    const threatened = getThreatenedSquares(p);
    return threatened.some(
      t => t.col === enemy.position.col && t.row === enemy.position.row
    );
  });

  // Must include the moved piece
  const movedThreatens = threateners.some(
    p => p.id === movedPiece.id
  );
  if (!movedThreatens) return captures;

  // Try all pairs that include the moved piece
  for (let i = 0; i < threateners.length; i++) {
    if (threateners[i].id === movedPiece.id) continue;
    const sum = movedPiece.value + threateners[i].value;
    if (sum === enemy.value) {
      captures.push({
        method: 'addition',
        target: enemy.position,
        attackers: [movedPiece.position, threateners[i].position],
        description: `${movedPiece.value} + ${threateners[i].value} = ${enemy.value} (addition)`,
      });
    }
  }

  // Try triples that include the moved piece
  for (let i = 0; i < threateners.length; i++) {
    if (threateners[i].id === movedPiece.id) continue;
    for (let j = i + 1; j < threateners.length; j++) {
      if (threateners[j].id === movedPiece.id) continue;
      const sum = movedPiece.value + threateners[i].value + threateners[j].value;
      if (sum === enemy.value) {
        captures.push({
          method: 'addition',
          target: enemy.position,
          attackers: [movedPiece.position, threateners[i].position, threateners[j].position],
          description: `${movedPiece.value} + ${threateners[i].value} + ${threateners[j].value} = ${enemy.value} (addition)`,
        });
      }
    }
  }

  return captures;
}

/**
 * Subtraction: 2 friendly pieces threaten the same enemy, difference = enemy's value.
 * At least one must be the moved piece.
 */
function checkSubtraction(
  friendlies: Piece[],
  enemy: Piece,
  movedPiece: Piece,
): CaptureOption[] {
  const captures: CaptureOption[] = [];

  const threateners = friendlies.filter(p => {
    const threatened = getThreatenedSquares(p);
    return threatened.some(
      t => t.col === enemy.position.col && t.row === enemy.position.row
    );
  });

  const movedThreatens = threateners.some(p => p.id === movedPiece.id);
  if (!movedThreatens) return captures;

  for (const other of threateners) {
    if (other.id === movedPiece.id) continue;
    const diff = Math.abs(movedPiece.value - other.value);
    if (diff === enemy.value) {
      captures.push({
        method: 'subtraction',
        target: enemy.position,
        attackers: [movedPiece.position, other.position],
        description: `|${Math.max(movedPiece.value, other.value)} - ${Math.min(movedPiece.value, other.value)}| = ${enemy.value} (subtraction)`,
      });
    }
  }

  return captures;
}

/**
 * Multiplication: piece's value * number of empty squares to enemy = enemy's value.
 * Must be on a straight line (orthogonal or diagonal) with clear path.
 * Only the moved piece can do this.
 */
function checkMultiplication(
  board: (Piece | null)[][],
  mover: Piece,
  enemy: Piece,
): CaptureOption | null {
  const line = isOnLine(mover.position, enemy.position);
  if (!line) return null;

  const emptyCount = emptySquaresBetween(board, mover.position, enemy.position);
  if (emptyCount === null) return null; // not clear path

  // Distance = empty squares + 1 (counting the enemy's square)
  const dist = emptyCount + 1;
  if (dist <= 0) return null;

  if (mover.value * dist === enemy.value) {
    return {
      method: 'multiplication',
      target: enemy.position,
      attackers: [mover.position],
      description: `${mover.value} x ${dist} = ${enemy.value} (multiplication)`,
    };
  }

  return null;
}

/**
 * Division: enemy's value / distance = mover's value.
 * Must be on a straight line with clear path.
 * Only the moved piece can do this.
 */
function checkDivision(
  board: (Piece | null)[][],
  mover: Piece,
  enemy: Piece,
): CaptureOption | null {
  const line = isOnLine(mover.position, enemy.position);
  if (!line) return null;

  const emptyCount = emptySquaresBetween(board, mover.position, enemy.position);
  if (emptyCount === null) return null;

  const dist = emptyCount + 1;
  if (dist <= 0) return null;

  if (enemy.value / dist === mover.value && enemy.value % dist === 0) {
    return {
      method: 'division',
      target: enemy.position,
      attackers: [mover.position],
      description: `${enemy.value} / ${dist} = ${mover.value} (division)`,
    };
  }

  return null;
}

/**
 * Siege: an enemy is completely surrounded — all squares it could legally move to
 * are occupied by friendly pieces or are off the board.
 */
function checkSiege(
  board: (Piece | null)[][],
  enemy: Piece,
  friendlies: Piece[],
): CaptureOption | null {
  // Get all squares adjacent to the enemy (orthogonal only for siege)
  const adjacentDirs = [
    { col: 0, row: -1 }, { col: 0, row: 1 },
    { col: -1, row: 0 }, { col: 1, row: 0 },
  ];

  const surrounders: Position[] = [];
  for (const dir of adjacentDirs) {
    const pos: Position = {
      col: enemy.position.col + dir.col,
      row: enemy.position.row + dir.row,
    };

    if (!isInBounds(pos)) {
      // Board edge counts as blocking
      continue;
    }

    const occupant = getPieceAt(board, pos);
    if (occupant && occupant.owner !== enemy.owner) {
      surrounders.push(pos);
    } else {
      // There's an escape route (empty or friendly piece) — no siege
      return null;
    }
  }

  if (surrounders.length === 0) return null;

  return {
    method: 'siege',
    target: enemy.position,
    attackers: surrounders,
    description: `${enemy.value} is besieged — all exits blocked`,
  };
}
