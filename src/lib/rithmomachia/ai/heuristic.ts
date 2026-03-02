// Medium AI — score each move by heuristic evaluation

import { GameState, GameAction, Player } from '../types';
import { getLegalMoves } from '../movement';
import { findCaptures } from '../capture';
import { createBoard } from '../board';
import { evaluateBoard } from './evaluate';

interface ScoredMove {
  actions: GameAction[];
  score: number;
}

export function getHeuristicMove(state: GameState): GameAction[] {
  const myPieces = state.pieces.filter(p => p.owner === state.currentPlayer);
  const moves: ScoredMove[] = [];

  for (const piece of myPieces) {
    const legalMoves = getLegalMoves(piece, state.board);

    for (const target of legalMoves) {
      // Simulate the move
      const newPieces = state.pieces.map(p =>
        p.id === piece.id ? { ...p, position: target } : p
      );
      const newBoard = createBoard(newPieces);
      const movedPiece = newPieces.find(p => p.id === piece.id)!;

      let score = 0;

      // Check for captures
      const captures = findCaptures(newBoard, movedPiece, newPieces);
      if (captures.length > 0) {
        // Score the best capture
        const bestCapture = captures.reduce((best, cap) => {
          const targetPiece = state.pieces.find(
            p => p.position.col === cap.target.col && p.position.row === cap.target.row
          );
          const capValue = targetPiece ? targetPiece.value : 0;
          return capValue > best.value ? { capture: cap, value: capValue } : best;
        }, { capture: captures[0], value: 0 });
        score += bestCapture.value * 2;
      }

      // Evaluate resulting position
      const simState: GameState = {
        ...state,
        pieces: newPieces,
        board: newBoard,
      };
      score += evaluateBoard(simState, state.currentPlayer) * 0.3;

      // Small random factor to avoid predictability
      score += Math.random() * 5;

      moves.push({
        actions: [
          { type: 'SELECT_PIECE', position: piece.position },
          { type: 'MOVE_PIECE', to: target },
        ],
        score,
      });
    }
  }

  if (moves.length === 0) return [];

  // Pick the best move
  moves.sort((a, b) => b.score - a.score);
  return moves[0].actions;
}

/** Pick the highest-value capture */
export function getHeuristicCaptureDecision(state: GameState): GameAction {
  if (state.captureOptions.length === 0) {
    return { type: 'SKIP_CAPTURE' };
  }

  let bestIndex = 0;
  let bestValue = 0;

  for (let i = 0; i < state.captureOptions.length; i++) {
    const cap = state.captureOptions[i];
    const targetPiece = state.pieces.find(
      p => p.position.col === cap.target.col && p.position.row === cap.target.row
    );
    const value = targetPiece ? targetPiece.value : 0;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = i;
    }
  }

  return { type: 'EXECUTE_CAPTURE', captureIndex: bestIndex };
}
