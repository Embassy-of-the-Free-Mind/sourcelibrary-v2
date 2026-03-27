// Scenario game state — creates a GameState from a Scenario definition
// and checks success conditions

import { GameState, Piece, Player } from './types';
import { createBoard } from './board';
import { Scenario, ScenarioPiece, SuccessCondition } from './scenarios';
import { BOARD_ROWS } from './constants';

let nextId = 0;

function scenarioPieceToPiece(sp: ScenarioPiece): Piece {
  return {
    id: `scenario-${sp.owner}-${sp.shape}-${sp.value}-${nextId++}`,
    owner: sp.owner,
    shape: sp.shape,
    value: sp.value,
    position: sp.position,
  };
}

export function createScenarioState(scenario: Scenario): GameState {
  nextId = 0;
  const pieces = scenario.pieces.map(scenarioPieceToPiece);
  return {
    board: createBoard(pieces),
    pieces,
    currentPlayer: scenario.playerSide,
    phase: 'select',
    selectedPiece: null,
    legalMoves: [],
    captureOptions: [],
    capturedPieces: { even: [], odd: [] },
    moveHistory: [],
    turnNumber: 1,
    mode: 'hotseat',
    difficulty: 'medium',
    victory: null,
  };
}

/**
 * Check if a scenario's success condition is met.
 * Returns true if the player has achieved the goal.
 */
export function checkScenarioSuccess(
  condition: SuccessCondition,
  state: GameState,
  playerSide: Player,
): boolean {
  switch (condition.type) {
    case 'capture': {
      const captured = state.capturedPieces[playerSide];
      return captured.some(p => {
        const valueMatch = p.value === condition.targetValue;
        // method check requires looking at move history
        if (condition.method && state.moveHistory.length > 0) {
          const lastMove = state.moveHistory[state.moveHistory.length - 1];
          if (lastMove.capture) {
            return valueMatch && lastMove.capture.method === condition.method;
          }
        }
        return valueMatch;
      });
    }

    case 'victory-formation': {
      // Check if the player has pieces on the enemy half forming the required progression
      const enemyHalfStart = playerSide === 'even' ? 8 : 0;
      const enemyHalfEnd = playerSide === 'even' ? 15 : 7;

      const piecesOnEnemyHalf = state.pieces.filter(
        p => p.position.row >= enemyHalfStart && p.position.row <= enemyHalfEnd
      );

      if (piecesOnEnemyHalf.length < 3) return false;

      // Check all triples for the required progression type
      for (let i = 0; i < piecesOnEnemyHalf.length; i++) {
        for (let j = i + 1; j < piecesOnEnemyHalf.length; j++) {
          for (let k = j + 1; k < piecesOnEnemyHalf.length; k++) {
            const trio = [piecesOnEnemyHalf[i], piecesOnEnemyHalf[j], piecesOnEnemyHalf[k]];

            if (!areInLine(trio.map(p => p.position))) continue;

            const values = trio.map(p => p.value).sort((a, b) => a - b);

            if (condition.victoryType === 'arithmetic' && isArithmeticProgression(values)) return true;
            if (condition.victoryType === 'geometric' && isGeometricProgression(values)) return true;
            if (condition.victoryType === 'harmonic' && isHarmonicProgression(values)) return true;
          }
        }
      }
      return false;
    }

    case 'move-to': {
      // Check if any friendly piece occupies the target position
      return state.pieces.some(
        p => p.owner === playerSide &&
          p.position.col === condition.targetPosition.col &&
          p.position.row === condition.targetPosition.row
      );
    }

    default:
      return false;
  }
}

// --- Progression helpers (duplicated from victory.ts to avoid coupling) ---

function areInLine(positions: { col: number; row: number }[]): boolean {
  if (positions.length < 3) return false;
  const [a, b] = positions;
  const dRow = b.row - a.row;
  const dCol = b.col - a.col;
  for (let i = 2; i < positions.length; i++) {
    const dr = positions[i].row - a.row;
    const dc = positions[i].col - a.col;
    if (dRow * dc !== dCol * dr) return false;
  }
  return true;
}

function isArithmeticProgression(sorted: number[]): boolean {
  if (sorted.length < 3) return false;
  const diff = sorted[1] - sorted[0];
  if (diff === 0) return false;
  for (let i = 2; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] !== diff) return false;
  }
  return true;
}

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

function isHarmonicProgression(sorted: number[]): boolean {
  if (sorted.length < 3) return false;
  if (sorted.some(v => v === 0)) return false;
  const [a, b, c] = sorted;
  return (b - a) * c === (c - b) * a;
}
