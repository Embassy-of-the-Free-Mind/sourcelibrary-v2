// Hard AI — minimax with alpha-beta pruning (depth 2-3)

import { GameState, GameAction, Player, Piece } from '../types';
import { getLegalMoves } from '../movement';
import { findCaptures } from '../capture';
import { createBoard } from '../board';
import { evaluateBoard } from './evaluate';
import { getHeuristicCaptureDecision } from './heuristic';

const MAX_DEPTH = 2; // Keep shallow for responsiveness
const MAX_MOVES_TO_CONSIDER = 15; // Prune low-value moves

interface ScoredMove {
  actions: GameAction[];
  score: number;
}

export function getMinimaxMove(state: GameState): GameAction[] {
  const myPieces = state.pieces.filter(p => p.owner === state.currentPlayer);
  const moves: ScoredMove[] = [];

  for (const piece of myPieces) {
    const legalMoves = getLegalMoves(piece, state.board);

    for (const target of legalMoves) {
      // Simulate move
      const newPieces = state.pieces.map(p =>
        p.id === piece.id ? { ...p, position: target } : p
      );
      const newBoard = createBoard(newPieces);
      const movedPiece = newPieces.find(p => p.id === piece.id)!;

      // Apply best capture if available
      const captures = findCaptures(newBoard, movedPiece, newPieces);
      let simPieces = newPieces;
      let simCaptured = { ...state.capturedPieces };

      if (captures.length > 0) {
        // Take the best capture by value
        let bestCapture = captures[0];
        let bestValue = 0;
        for (const cap of captures) {
          const tp = newPieces.find(
            p => p.position.col === cap.target.col && p.position.row === cap.target.row && p.owner !== state.currentPlayer
          );
          if (tp && tp.value > bestValue) {
            bestValue = tp.value;
            bestCapture = cap;
          }
        }

        const capturedPiece = newPieces.find(
          p => p.position.col === bestCapture.target.col && p.position.row === bestCapture.target.row && p.owner !== state.currentPlayer
        );
        if (capturedPiece) {
          simPieces = newPieces.filter(p => p.id !== capturedPiece.id);
          simCaptured = {
            ...simCaptured,
            [state.currentPlayer]: [
              ...simCaptured[state.currentPlayer],
              { ...capturedPiece, owner: state.currentPlayer },
            ],
          };
        }
      }

      const nextPlayer: Player = state.currentPlayer === 'even' ? 'odd' : 'even';
      const simState: GameState = {
        ...state,
        pieces: simPieces,
        board: createBoard(simPieces),
        currentPlayer: nextPlayer,
        capturedPieces: simCaptured,
      };

      const score = minimax(simState, MAX_DEPTH - 1, -Infinity, Infinity, false, state.currentPlayer);

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

  // Sort and pick best
  moves.sort((a, b) => b.score - a.score);

  // Add slight randomness among top moves to avoid being totally predictable
  const topScore = moves[0].score;
  const topMoves = moves.filter(m => m.score >= topScore - 5);
  return topMoves[Math.floor(Math.random() * topMoves.length)].actions;
}

function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  evaluatingPlayer: Player,
): number {
  if (depth === 0) {
    return evaluateBoard(state, evaluatingPlayer);
  }

  const myPieces = state.pieces.filter(p => p.owner === state.currentPlayer);

  // Generate all possible moves
  const allMoves: { piece: Piece; target: { col: number; row: number } }[] = [];
  for (const piece of myPieces) {
    const moves = getLegalMoves(piece, state.board);
    for (const target of moves) {
      allMoves.push({ piece, target });
    }
  }

  if (allMoves.length === 0) {
    return evaluateBoard(state, evaluatingPlayer);
  }

  // Limit moves considered for performance
  const movesToConsider = allMoves.slice(0, MAX_MOVES_TO_CONSIDER);

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of movesToConsider) {
      const newPieces = state.pieces.map(p =>
        p.id === move.piece.id ? { ...p, position: move.target } : p
      );

      const nextPlayer: Player = state.currentPlayer === 'even' ? 'odd' : 'even';
      const simState: GameState = {
        ...state,
        pieces: newPieces,
        board: createBoard(newPieces),
        currentPlayer: nextPlayer,
      };

      const evalScore = minimax(simState, depth - 1, alpha, beta, false, evaluatingPlayer);
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of movesToConsider) {
      const newPieces = state.pieces.map(p =>
        p.id === move.piece.id ? { ...p, position: move.target } : p
      );

      const nextPlayer: Player = state.currentPlayer === 'even' ? 'odd' : 'even';
      const simState: GameState = {
        ...state,
        pieces: newPieces,
        board: createBoard(newPieces),
        currentPlayer: nextPlayer,
      };

      const evalScore = minimax(simState, depth - 1, alpha, beta, true, evaluatingPlayer);
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

export { getHeuristicCaptureDecision as getMinimaxCaptureDecision };
