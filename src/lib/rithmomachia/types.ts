// Rithmomachia — "The Battle of Numbers"
// Type definitions for the playable game

export type Player = 'even' | 'odd';
export type PieceShape = 'circle' | 'triangle' | 'square' | 'pyramid';
export type GamePhase = 'select' | 'move' | 'capture' | 'victory' | 'gameover';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type GameMode = 'vs-ai' | 'hotseat';

export interface Position {
  col: number; // 0-7
  row: number; // 0-15
}

export interface PyramidLayer {
  shape: 'circle' | 'triangle' | 'square';
  value: number;
}

export interface Piece {
  id: string;
  owner: Player;
  shape: PieceShape;
  value: number;
  position: Position;
  pyramidLayers?: PyramidLayer[]; // only for pyramids
}

export type CaptureMethod =
  | 'equality'
  | 'addition'
  | 'subtraction'
  | 'multiplication'
  | 'division'
  | 'siege';

export interface CaptureOption {
  method: CaptureMethod;
  target: Position;
  attackers: Position[]; // pieces involved in the capture
  description: string;   // human-readable explanation
}

export type VictoryType =
  | 'bodies'       // capture N pieces
  | 'goods'        // capture value sum >= N
  | 'quarrel'      // capture N pieces AND value sum >= N
  | 'arithmetic'   // 3+ pieces in arithmetic progression on enemy half
  | 'geometric'    // 3+ pieces in geometric progression on enemy half
  | 'harmonic';    // 3+ pieces in harmonic progression on enemy half

export interface VictoryCondition {
  type: VictoryType;
  player: Player;
  pieces?: Position[];
  description: string;
}

export interface MoveRecord {
  turn: number;
  player: Player;
  piece: { shape: PieceShape; value: number };
  from: Position;
  to: Position;
  capture?: {
    method: CaptureMethod;
    captured: { shape: PieceShape; value: number; position: Position }[];
  };
}

export interface GameState {
  board: (Piece | null)[][]; // board[row][col]
  pieces: Piece[];
  currentPlayer: Player;
  phase: GamePhase;
  selectedPiece: Position | null;
  legalMoves: Position[];
  captureOptions: CaptureOption[];
  capturedPieces: { even: Piece[]; odd: Piece[] };
  moveHistory: MoveRecord[];
  turnNumber: number;
  mode: GameMode;
  difficulty: Difficulty;
  victory: VictoryCondition | null;
}

export type GameAction =
  | { type: 'SELECT_PIECE'; position: Position }
  | { type: 'DESELECT' }
  | { type: 'MOVE_PIECE'; to: Position }
  | { type: 'EXECUTE_CAPTURE'; captureIndex: number }
  | { type: 'SKIP_CAPTURE' }
  | { type: 'NEW_GAME'; mode: GameMode; difficulty: Difficulty; playerSide?: Player }
  | { type: 'UNDO' }
  | { type: 'RESIGN' };
