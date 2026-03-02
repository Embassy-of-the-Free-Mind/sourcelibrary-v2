// Board evaluation function for AI

import { GameState, Player, Piece } from '../types';
import { BOARD_ROWS } from '../constants';

/**
 * Evaluate the board position from the perspective of the given player.
 * Returns a score where positive = good for player, negative = bad.
 */
export function evaluateBoard(state: GameState, player: Player): number {
  let score = 0;
  const opponent: Player = player === 'even' ? 'odd' : 'even';

  // 1. Material advantage: total piece values on board
  const myPieces = state.pieces.filter(p => p.owner === player);
  const enemyPieces = state.pieces.filter(p => p.owner === opponent);
  const myValue = myPieces.reduce((sum, p) => sum + p.value, 0);
  const enemyValue = enemyPieces.reduce((sum, p) => sum + p.value, 0);
  score += (myValue - enemyValue) * 0.1;

  // 2. Piece count advantage
  score += (myPieces.length - enemyPieces.length) * 10;

  // 3. Captured piece value
  const myCaptured = state.capturedPieces[player];
  const enemyCaptured = state.capturedPieces[opponent];
  const myCapturedValue = myCaptured.reduce((sum, p) => sum + p.value, 0);
  const enemyCapturedValue = enemyCaptured.reduce((sum, p) => sum + p.value, 0);
  score += (myCapturedValue - enemyCapturedValue) * 0.5;

  // 4. Advancement: pieces pushed toward enemy territory
  for (const piece of myPieces) {
    score += advancementScore(piece, player) * 2;
  }

  // 5. Center control
  for (const piece of myPieces) {
    score += centerScore(piece) * 1.5;
  }

  // 6. Pyramid safety (pyramids are extremely valuable)
  for (const piece of myPieces) {
    if (piece.shape === 'pyramid') {
      score += 50; // having your pyramid is valuable
    }
  }
  for (const piece of enemyPieces) {
    if (piece.shape === 'pyramid') {
      score -= 50;
    }
  }

  return score;
}

/** Score for how far a piece has advanced into enemy territory */
function advancementScore(piece: Piece, player: Player): number {
  if (player === 'even') {
    // Even advances toward row 15
    return piece.position.row;
  } else {
    // Odd advances toward row 0
    return BOARD_ROWS - 1 - piece.position.row;
  }
}

/** Score for center control (columns 3-4 are center) */
function centerScore(piece: Piece): number {
  const colDist = Math.abs(piece.position.col - 3.5);
  return Math.max(0, 4 - colDist);
}
