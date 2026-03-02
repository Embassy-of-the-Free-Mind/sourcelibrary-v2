// Victory condition checking — common and philosophical victories

import { Player, Piece, Position, VictoryCondition } from './types';
import { BOARD_ROWS, VICTORY_BODIES, VICTORY_GOODS, VICTORY_QUARREL_PIECES, VICTORY_QUARREL_VALUE } from './constants';

/**
 * Check all victory conditions after a capture.
 * Returns the first victory found, or null.
 */
export function checkVictory(
  capturedPieces: { even: Piece[]; odd: Piece[] },
  pieces: Piece[],
): VictoryCondition | null {
  // Check common victories for both players
  for (const player of ['even', 'odd'] as Player[]) {
    const captured = player === 'even' ? capturedPieces.even : capturedPieces.odd;

    // Bodies: capture enough pieces
    if (captured.length >= VICTORY_BODIES) {
      return {
        type: 'bodies',
        player,
        description: `${player === 'even' ? 'Even (White)' : 'Odd (Black)'} wins by Bodies — captured ${captured.length} pieces`,
      };
    }

    // Goods: capture enough total value
    const totalValue = captured.reduce((sum, p) => sum + p.value, 0);
    if (totalValue >= VICTORY_GOODS) {
      return {
        type: 'goods',
        player,
        description: `${player === 'even' ? 'Even (White)' : 'Odd (Black)'} wins by Goods — captured value ${totalValue}`,
      };
    }

    // Quarrel: combined threshold
    if (captured.length >= VICTORY_QUARREL_PIECES && totalValue >= VICTORY_QUARREL_VALUE) {
      return {
        type: 'quarrel',
        player,
        description: `${player === 'even' ? 'Even (White)' : 'Odd (Black)'} wins by Quarrel — ${captured.length} pieces worth ${totalValue}`,
      };
    }

    // Philosophical victories: pieces on opponent's half in mathematical progressions
    const philosophical = checkPhilosophicalVictory(player, pieces);
    if (philosophical) return philosophical;
  }

  return null;
}

/**
 * Check philosophical (progression) victories.
 * Player must have 3+ pieces on the opponent's half of the board
 * in a straight line forming an arithmetic, geometric, or harmonic progression.
 */
function checkPhilosophicalVictory(
  player: Player,
  pieces: Piece[],
): VictoryCondition | null {
  // Opponent's half: for 'even' player (starts rows 0-7), opponent's half is rows 8-15
  // For 'odd' player (starts rows 8-15), opponent's half is rows 0-7
  const enemyHalfStart = player === 'even' ? 8 : 0;
  const enemyHalfEnd = player === 'even' ? 15 : 7;

  // Find player's pieces on enemy half
  const piecesOnEnemyHalf = pieces.filter(
    p => p.owner === player && p.position.row >= enemyHalfStart && p.position.row <= enemyHalfEnd
  );

  if (piecesOnEnemyHalf.length < 3) return null;

  // Check all combinations of 3+ pieces for progressions
  // For now, check triples — the most common philosophical victory
  for (let i = 0; i < piecesOnEnemyHalf.length; i++) {
    for (let j = i + 1; j < piecesOnEnemyHalf.length; j++) {
      for (let k = j + 1; k < piecesOnEnemyHalf.length; k++) {
        const trio = [piecesOnEnemyHalf[i], piecesOnEnemyHalf[j], piecesOnEnemyHalf[k]];

        // Must be in a straight line (row, column, or diagonal)
        if (!areInLine(trio.map(p => p.position))) continue;

        const values = trio.map(p => p.value).sort((a, b) => a - b);

        if (isArithmeticProgression(values)) {
          return {
            type: 'arithmetic',
            player,
            pieces: trio.map(p => p.position),
            description: `${player === 'even' ? 'Even (White)' : 'Odd (Black)'} achieves Arithmetic Victory — ${values.join(', ')} in progression`,
          };
        }

        if (isGeometricProgression(values)) {
          return {
            type: 'geometric',
            player,
            pieces: trio.map(p => p.position),
            description: `${player === 'even' ? 'Even (White)' : 'Odd (Black)'} achieves Geometric Victory — ${values.join(', ')} in progression`,
          };
        }

        if (isHarmonicProgression(values)) {
          return {
            type: 'harmonic',
            player,
            pieces: trio.map(p => p.position),
            description: `${player === 'even' ? 'Even (White)' : 'Odd (Black)'} achieves Harmonic Victory — ${values.join(', ')} in progression`,
          };
        }
      }
    }
  }

  return null;
}

/** Check if 3+ positions are collinear (same row, column, or diagonal) */
function areInLine(positions: Position[]): boolean {
  if (positions.length < 3) return false;

  const [a, b] = positions;
  const dRow = b.row - a.row;
  const dCol = b.col - a.col;

  for (let i = 2; i < positions.length; i++) {
    const dr = positions[i].row - a.row;
    const dc = positions[i].col - a.col;
    // Cross product must be zero for collinearity
    if (dRow * dc !== dCol * dr) return false;
  }

  return true;
}

/** Arithmetic progression: constant difference. e.g. 2, 4, 6 */
function isArithmeticProgression(sorted: number[]): boolean {
  if (sorted.length < 3) return false;
  const diff = sorted[1] - sorted[0];
  if (diff === 0) return false;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== diff) return false;
  }
  return true;
}

/** Geometric progression: constant ratio. e.g. 2, 4, 8 */
function isGeometricProgression(sorted: number[]): boolean {
  if (sorted.length < 3) return false;
  if (sorted[0] === 0) return false;
  const ratio = sorted[1] / sorted[0];
  if (ratio <= 1 || !Number.isFinite(ratio)) return false;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i] / sorted[i - 1] !== ratio) return false;
  }
  return true;
}

/** Harmonic progression: reciprocals form arithmetic progression. e.g. 3, 4, 6 */
function isHarmonicProgression(sorted: number[]): boolean {
  if (sorted.length < 3) return false;
  if (sorted.some(v => v === 0)) return false;
  const reciprocals = sorted.map(v => 1 / v);
  // Check if reciprocals (in reverse — largest reciprocal first) form AP
  reciprocals.reverse();
  return isArithmeticProgression(reciprocals);
}
