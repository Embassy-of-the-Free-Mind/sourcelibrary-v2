// Move commentary for demo/spectator mode
// Generates human-readable explanations of each move with primary source citations

import { GameState, MoveRecord, CaptureMethod, PieceShape, Player } from './types';
import { CONCEPT_SOURCES, sourceUrl, sourceLabel, SourceKey } from './sources';

interface Commentary {
  text: string;           // Plain text explanation
  sourceRef?: {           // Optional primary source citation
    label: string;        // e.g. "Barozzi (1572), p. 31"
    url: string;          // Link to specific page
  };
  highlight?: string;     // Optional rule highlight
}

const SHAPE_NAMES: Record<PieceShape, string> = {
  circle: 'circle',
  triangle: 'triangle',
  square: 'square',
  pyramid: 'pyramid',
};

const PLAYER_NAMES: Record<Player, string> = {
  even: 'Even (White)',
  odd: 'Odd (Black)',
};

function colName(col: number): string {
  return String.fromCharCode(97 + col); // a-h
}

function posName(col: number, row: number): string {
  return `${colName(col)}${row + 1}`;
}

// Pick a random source for a given concept
function pickSource(conceptKey: string): { label: string; url: string } | undefined {
  const concept = CONCEPT_SOURCES[conceptKey];
  if (!concept || concept.refs.length === 0) return undefined;
  const ref = concept.refs[Math.floor(Math.random() * concept.refs.length)];
  return {
    label: `${sourceLabel(ref.source)}${ref.page ? `, p. ${ref.page}` : ''}`,
    url: sourceUrl(ref.source, ref.page),
  };
}

// Commentary for a movement
function commentOnMovement(move: MoveRecord): Commentary {
  const shape = SHAPE_NAMES[move.piece.shape];
  const from = posName(move.from.col, move.from.row);
  const to = posName(move.to.col, move.to.row);
  const player = PLAYER_NAMES[move.player];
  const value = move.piece.value;

  // Shape-specific flavor text
  let movementNote = '';
  let conceptKey = '';

  switch (move.piece.shape) {
    case 'circle':
      movementNote = 'Circles move one space diagonally — the shortest and most constrained movement on the board.';
      conceptKey = 'circleMovement';
      break;
    case 'triangle':
      movementNote = 'Triangles leap exactly two spaces orthogonally, jumping over any intervening pieces.';
      conceptKey = 'triangleMovement';
      break;
    case 'square':
      movementNote = 'Squares leap three spaces orthogonally — the longest reach of any basic piece.';
      conceptKey = 'squareMovement';
      break;
    case 'pyramid':
      movementNote = 'The pyramid, built from stacked layers, can move as any piece type — one diagonal, two orthogonal, or three orthogonal.';
      conceptKey = 'pyramid';
      break;
  }

  return {
    text: `${player}'s ${shape} ${value} moves from ${from} to ${to}. ${movementNote}`,
    sourceRef: pickSource(conceptKey),
  };
}

// Commentary for a capture
function commentOnCapture(move: MoveRecord): Commentary | null {
  if (!move.capture) return null;

  const player = PLAYER_NAMES[move.player];
  const capturedValues = move.capture.captured.map(c => c.value);
  const method = move.capture.method;

  const conceptMap: Record<CaptureMethod, string> = {
    equality: 'equalityCapture',
    addition: 'additionCapture',
    subtraction: 'subtractionCapture',
    multiplication: 'multiplicationCapture',
    division: 'divisionCapture',
    siege: 'siegeCapture',
  };

  const explanations: Record<CaptureMethod, string> = {
    equality: `${player} captures by equality — the attacker and defender have the same value (${capturedValues[0]}). The simplest and most common form of capture.`,
    addition: `${player} captures by addition — multiple attacking pieces' values sum to the defender's value (${capturedValues[0]}). A coordinated assault.`,
    subtraction: `${player} captures by subtraction — the difference between two attacking pieces equals the defender's value (${capturedValues[0]}).`,
    multiplication: `${player} captures by multiplication — the attacker's value times its distance to the defender equals the defender's value (${capturedValues[0]}). Geometry meets arithmetic.`,
    division: `${player} captures by division — the defender's value divided by the distance equals the attacker's value. The inverse of multiplication capture.`,
    siege: `${player} captures by siege — the defender (${capturedValues[0]}) is surrounded on all sides with no escape route. A medieval strategy made mathematical.`,
  };

  return {
    text: explanations[method],
    sourceRef: pickSource(conceptMap[method]),
    highlight: `Capture: ${method}`,
  };
}

// Opening commentary
export function getOpeningCommentary(): Commentary {
  return {
    text: 'The Battle of Numbers begins. Even (White) always moves first. All five primary sources — from Jordanus (1496) to Selenus (1616) — agree on this starting position, piece values, and the fundamental rules. Watch as two mathematical armies clash using arithmetic as their weapon.',
    sourceRef: pickSource('evenOddCosmology'),
  };
}

// Commentary for the current move
export function getMoveCommentary(move: MoveRecord, _state: GameState, moveIndex: number): Commentary[] {
  const comments: Commentary[] = [];

  // First few moves get extra context
  if (moveIndex === 0) {
    comments.push({
      text: 'The game opens. In Rithmomachia, piece values follow Pythagorean mathematics: circles hold simple digits and their squares, triangles hold sums of circle pairs, and squares hold sums of triangle pairs.',
      sourceRef: pickSource('pieceValues'),
    });
  }

  // Movement commentary
  comments.push(commentOnMovement(move));

  // Capture commentary
  const captureComment = commentOnCapture(move);
  if (captureComment) {
    comments.push(captureComment);
  }

  // Occasional flavor about specific piece values
  if (moveIndex > 0 && moveIndex % 5 === 0) {
    const flavorComments = [
      {
        text: `The board's number system is pure Pythagorean philosophy: even numbers represent the finite and determinate, odd numbers the infinite and indeterminate.`,
        sourceRef: pickSource('evenOddCosmology'),
      },
      {
        text: `Each piece's value is mathematically derived — circles hold digits and their squares, triangles sum adjacent circles, squares sum adjacent triangles. Nothing is arbitrary.`,
        sourceRef: pickSource('pieceValues'),
      },
      {
        text: `Rithmomachia was played across Europe for six centuries — from medieval university students to Renaissance aristocrats. Selenus (1616) even includes copper engravings of the board.`,
        sourceRef: pickSource('board'),
      },
    ];
    comments.push(flavorComments[Math.floor(Math.random() * flavorComments.length)]);
  }

  return comments;
}

// Victory commentary
export function getVictoryCommentary(type: string, player: Player): Commentary {
  const playerName = PLAYER_NAMES[player];

  if (['arithmetic', 'geometric', 'harmonic'].includes(type)) {
    return {
      text: `${playerName} achieves a philosophical victory — the highest form of triumph in Rithmomachia. Three or more pieces form a ${type} progression on the enemy's half of the board. As Selenus wrote in 1616: "In those numbers all the harmonies are contained."`,
      sourceRef: pickSource('philosophicalVictory'),
    };
  }

  return {
    text: `${playerName} wins by ${type} — a common victory achieved through sheer force of captures. The philosophical victories (arithmetic, geometric, harmonic progressions) remain the game's highest aspiration.`,
    sourceRef: pickSource('commonVictory'),
  };
}
