// Game state management — pure reducer for all game logic

import { GameState, GameAction, Player, Piece, Position, MoveRecord, GamePhase } from './types';
import { createInitialPieces } from './constants';
import { createBoard, getPieceAt, positionsEqual } from './board';
import { getLegalMoves } from './movement';
import { findCaptures } from './capture';
import { checkVictory } from './victory';

export function createInitialState(
  mode: GameState['mode'] = 'hotseat',
  difficulty: GameState['difficulty'] = 'medium',
): GameState {
  const pieces = createInitialPieces();
  return {
    board: createBoard(pieces),
    pieces,
    currentPlayer: 'even', // Even (White) moves first
    phase: 'select',
    selectedPiece: null,
    legalMoves: [],
    captureOptions: [],
    capturedPieces: { even: [], odd: [] },
    moveHistory: [],
    turnNumber: 1,
    mode,
    difficulty,
    victory: null,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SELECT_PIECE':
      return handleSelectPiece(state, action.position);
    case 'DESELECT':
      return { ...state, phase: 'select', selectedPiece: null, legalMoves: [] };
    case 'MOVE_PIECE':
      return handleMovePiece(state, action.to);
    case 'EXECUTE_CAPTURE':
      return handleExecuteCapture(state, action.captureIndex);
    case 'SKIP_CAPTURE':
      return handleSkipCapture(state);
    case 'NEW_GAME':
      return createInitialState(action.mode, action.difficulty);
    case 'UNDO':
      return handleUndo(state);
    case 'RESIGN':
      return handleResign(state);
    default:
      return state;
  }
}

function handleSelectPiece(state: GameState, position: Position): GameState {
  if (state.phase !== 'select' && state.phase !== 'move') return state;

  // If clicking the same piece, deselect
  if (state.selectedPiece && positionsEqual(state.selectedPiece, position)) {
    return { ...state, phase: 'select', selectedPiece: null, legalMoves: [] };
  }

  const piece = getPieceAt(state.board, position);
  if (!piece || piece.owner !== state.currentPlayer) return state;

  const moves = getLegalMoves(piece, state.board);

  return {
    ...state,
    phase: 'move',
    selectedPiece: position,
    legalMoves: moves,
  };
}

function handleMovePiece(state: GameState, to: Position): GameState {
  if (state.phase !== 'move' || !state.selectedPiece) return state;

  // Verify the move is legal
  if (!state.legalMoves.some(m => positionsEqual(m, to))) return state;

  const from = state.selectedPiece;
  const pieceIndex = state.pieces.findIndex(
    p => positionsEqual(p.position, from) && p.owner === state.currentPlayer
  );
  if (pieceIndex === -1) return state;

  const piece = state.pieces[pieceIndex];

  // Move the piece
  const newPieces = [...state.pieces];
  const movedPiece: Piece = { ...piece, position: to };
  newPieces[pieceIndex] = movedPiece;

  const newBoard = createBoard(newPieces);

  // Check for captures
  const captures = findCaptures(newBoard, movedPiece, newPieces);

  // Record the move (captures will be added when executed)
  const moveRecord: MoveRecord = {
    turn: state.turnNumber,
    player: state.currentPlayer,
    piece: { shape: piece.shape, value: piece.value },
    from,
    to,
  };

  if (captures.length > 0) {
    return {
      ...state,
      board: newBoard,
      pieces: newPieces,
      phase: 'capture',
      selectedPiece: null,
      legalMoves: [],
      captureOptions: captures,
      moveHistory: [...state.moveHistory, moveRecord],
    };
  }

  // No captures — end turn
  const nextPlayer: Player = state.currentPlayer === 'even' ? 'odd' : 'even';
  return {
    ...state,
    board: newBoard,
    pieces: newPieces,
    phase: 'select',
    selectedPiece: null,
    legalMoves: [],
    captureOptions: [],
    moveHistory: [...state.moveHistory, moveRecord],
    currentPlayer: nextPlayer,
    turnNumber: state.currentPlayer === 'odd' ? state.turnNumber + 1 : state.turnNumber,
  };
}

function handleExecuteCapture(state: GameState, captureIndex: number): GameState {
  if (state.phase !== 'capture') return state;
  if (captureIndex < 0 || captureIndex >= state.captureOptions.length) return state;

  const capture = state.captureOptions[captureIndex];
  const targetPos = capture.target;

  const capturedPiece = state.pieces.find(
    p => positionsEqual(p.position, targetPos) && p.owner !== state.currentPlayer
  );
  if (!capturedPiece) return state;

  // Remove captured piece from board
  const newPieces = state.pieces.filter(p => p.id !== capturedPiece.id);
  const newBoard = createBoard(newPieces);

  // Add to captor's collection (color-flipped per Lever & Fulke)
  const flippedPiece: Piece = { ...capturedPiece, owner: state.currentPlayer };
  const newCaptured = { ...state.capturedPieces };
  newCaptured[state.currentPlayer] = [...newCaptured[state.currentPlayer], flippedPiece];

  // Update last move record with capture info
  const newHistory = [...state.moveHistory];
  if (newHistory.length > 0) {
    const lastMove = { ...newHistory[newHistory.length - 1] };
    lastMove.capture = {
      method: capture.method,
      captured: [{ shape: capturedPiece.shape, value: capturedPiece.value, position: capturedPiece.position }],
    };
    newHistory[newHistory.length - 1] = lastMove;
  }

  // Check victory
  const victory = checkVictory(newCaptured, newPieces);
  if (victory) {
    return {
      ...state,
      board: newBoard,
      pieces: newPieces,
      phase: 'victory',
      captureOptions: [],
      capturedPieces: newCaptured,
      moveHistory: newHistory,
      victory,
    };
  }

  // End turn
  const nextPlayer: Player = state.currentPlayer === 'even' ? 'odd' : 'even';
  return {
    ...state,
    board: newBoard,
    pieces: newPieces,
    phase: 'select',
    selectedPiece: null,
    legalMoves: [],
    captureOptions: [],
    capturedPieces: newCaptured,
    moveHistory: newHistory,
    currentPlayer: nextPlayer,
    turnNumber: state.currentPlayer === 'odd' ? state.turnNumber + 1 : state.turnNumber,
  };
}

function handleSkipCapture(state: GameState): GameState {
  if (state.phase !== 'capture') return state;

  const nextPlayer: Player = state.currentPlayer === 'even' ? 'odd' : 'even';
  return {
    ...state,
    phase: 'select',
    selectedPiece: null,
    legalMoves: [],
    captureOptions: [],
    currentPlayer: nextPlayer,
    turnNumber: state.currentPlayer === 'odd' ? state.turnNumber + 1 : state.turnNumber,
  };
}

function handleUndo(state: GameState): GameState {
  // Simple undo — restart the game (full undo would require state history)
  // TODO: implement proper undo with state stack
  return state;
}

function handleResign(state: GameState): GameState {
  const winner: Player = state.currentPlayer === 'even' ? 'odd' : 'even';
  return {
    ...state,
    phase: 'victory',
    victory: {
      type: 'bodies',
      player: winner,
      description: `${state.currentPlayer === 'even' ? 'Even (White)' : 'Odd (Black)'} resigned. ${winner === 'even' ? 'Even (White)' : 'Odd (Black)'} wins!`,
    },
  };
}
