// Easy AI — picks a random legal move

import { GameState, GameAction, Position } from '../types';
import { getLegalMoves } from '../movement';

export function getRandomMove(state: GameState): GameAction[] {
  const myPieces = state.pieces.filter(p => p.owner === state.currentPlayer);

  // Shuffle pieces to avoid predictable behavior
  const shuffled = [...myPieces].sort(() => Math.random() - 0.5);

  for (const piece of shuffled) {
    const moves = getLegalMoves(piece, state.board);
    if (moves.length > 0) {
      const target = moves[Math.floor(Math.random() * moves.length)];
      return [
        { type: 'SELECT_PIECE', position: piece.position },
        { type: 'MOVE_PIECE', to: target },
      ];
    }
  }

  // No legal moves (shouldn't happen in practice)
  return [];
}

/** After moving, randomly decide whether to capture */
export function getRandomCaptureDecision(state: GameState): GameAction {
  if (state.captureOptions.length === 0) {
    return { type: 'SKIP_CAPTURE' };
  }
  // Always capture if possible (even easy AI should capture)
  const index = Math.floor(Math.random() * state.captureOptions.length);
  return { type: 'EXECUTE_CAPTURE', captureIndex: index };
}
