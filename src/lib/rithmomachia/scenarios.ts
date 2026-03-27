// Strategy scenarios — pre-set board positions with guided steps
// Each scenario is grounded in specific passages from the five primary sources (1496-1616)

import { Player, PieceShape, Position, CaptureMethod, VictoryType } from './types';
import { SourceKey } from './sources';

export type ScenarioCategory = 'capture' | 'victory' | 'strategy';

export interface ScenarioPiece {
  shape: PieceShape;
  value: number;
  owner: Player;
  position: Position;
}

export interface ScenarioSource {
  source: SourceKey;
  page?: number;
  detail?: string;
}

export type SuccessCondition =
  | { type: 'capture'; targetValue: number; method?: CaptureMethod }
  | { type: 'victory-formation'; victoryType: VictoryType }
  | { type: 'move-to'; targetPosition: Position };

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  subtitle: string;
  difficulty: 1 | 2 | 3;
  description: string;
  hints: string[];
  pieces: ScenarioPiece[];
  playerSide: Player;
  successCondition: SuccessCondition;
  sourceRefs: ScenarioSource[];
  explanation: string; // shown after success
}

// ---------------------------------------------------------------------------
// Capture Puzzles
// ---------------------------------------------------------------------------

const captureEquality: Scenario = {
  id: 'capture-equality',
  category: 'capture',
  title: 'Capture by Equality',
  subtitle: 'The simplest capture',
  difficulty: 1,
  description: 'Your white triangle (25) has just moved. The black circle (25) is within reach. Capture it by equality.',
  hints: [
    'A piece captures an enemy of equal value that it could move to.',
    'Triangles threaten squares 2 spaces away orthogonally.',
    'Select your triangle, then move it — the capture prompt will appear.',
  ],
  pieces: [
    { shape: 'triangle', value: 25, owner: 'even', position: { col: 2, row: 5 } },
    { shape: 'circle', value: 25, owner: 'odd', position: { col: 2, row: 3 } },
  ],
  playerSide: 'even',
  successCondition: { type: 'capture', targetValue: 25, method: 'equality' },
  sourceRefs: [
    { source: 'lever', page: 40, detail: '9 triangle espieth 9 round — him may he take up' },
    { source: 'barozzi', page: 30, detail: '25 triangle captures 25 round by numbering' },
    { source: 'selenus', page: 510, detail: 'Capture by counting (Zehlen)' },
  ],
  explanation: 'Equality is the most common capture. All five sources list the same capturable values: 9, 16, 25, 36, 49, 64, 81 — numbers that appear on both sides.',
};

const captureAddition: Scenario = {
  id: 'capture-addition',
  category: 'capture',
  title: 'Capture by Addition',
  subtitle: 'Two against one',
  difficulty: 1,
  description: 'Your white circle (16) and white triangle (9) both threaten the black circle (25). Together they sum to 25. Capture it by addition.',
  hints: [
    'Two pieces whose values add up to an enemy\'s value can capture it.',
    'Both attacking pieces must be able to reach the enemy\'s square.',
    'Move your triangle to threaten the 25, then execute the addition capture.',
  ],
  pieces: [
    { shape: 'circle', value: 16, owner: 'even', position: { col: 3, row: 4 } },
    { shape: 'triangle', value: 9, owner: 'even', position: { col: 1, row: 3 } },
    { shape: 'circle', value: 25, owner: 'odd', position: { col: 3, row: 3 } },
  ],
  playerSide: 'even',
  successCondition: { type: 'capture', targetValue: 25, method: 'addition' },
  sourceRefs: [
    { source: 'lever', page: 42, detail: '6 + 6 = 12 — two sixes capture a twelve' },
    { source: 'barozzi', page: 30, detail: '16 + 9 = 25, both can reach the black round' },
    { source: 'selenus', page: 511, detail: 'Capture by adding (Zusammen-rechnen)' },
  ],
  explanation: 'Addition capture is a coordinated assault. Lever & Fulke call it the most useful capture after equality, because many piece combinations sum to enemy values.',
};

const captureSubtraction: Scenario = {
  id: 'capture-subtraction',
  category: 'capture',
  title: 'Capture by Subtraction',
  subtitle: 'The difference captures',
  difficulty: 1,
  description: 'Your white square (15) and white circle (6) both threaten the black circle (9). Their difference is 15 - 6 = 9. Capture it by subtraction.',
  hints: [
    'The difference between two of your pieces equals the enemy\'s value.',
    'Both pieces must be able to reach the target square.',
    'Move your circle into position, then subtract.',
  ],
  pieces: [
    { shape: 'square', value: 15, owner: 'even', position: { col: 4, row: 6 } },
    { shape: 'circle', value: 6, owner: 'even', position: { col: 2, row: 2 } },
    { shape: 'circle', value: 9, owner: 'odd', position: { col: 3, row: 3 } },
  ],
  playerSide: 'even',
  successCondition: { type: 'capture', targetValue: 9, method: 'subtraction' },
  sourceRefs: [
    { source: 'lever', page: 43, detail: '2 out of 9 remaineth 7 — captures the 7' },
    { source: 'barozzi', page: 32, detail: '15 - 6 = 9, both whites can reach the 9 black' },
  ],
  explanation: 'Subtraction is the inverse of addition. Lever & Fulke note it uses the same positioning but different arithmetic — a player scanning the board must check both operations simultaneously.',
};

const captureMultiplication: Scenario = {
  id: 'capture-multiplication',
  category: 'capture',
  title: 'Capture by Multiplication',
  subtitle: 'Value times distance',
  difficulty: 2,
  description: 'Your white circle (4) is on a straight line with the black triangle (12), with 2 empty squares between them. 4 × 3 (distance) = 12. Move to set up the multiplication capture.',
  hints: [
    'Your piece\'s value multiplied by its distance to the enemy equals the enemy\'s value.',
    'Distance counts the empty squares between them plus 1 (the enemy\'s square).',
    'The path must be clear — no pieces blocking the line.',
  ],
  pieces: [
    { shape: 'circle', value: 4, owner: 'even', position: { col: 3, row: 7 } },
    { shape: 'triangle', value: 12, owner: 'odd', position: { col: 3, row: 4 } },
  ],
  playerSide: 'even',
  successCondition: { type: 'capture', targetValue: 12, method: 'multiplication' },
  sourceRefs: [
    { source: 'lever', page: 44, detail: '3 standeth in D, and 5 standeth in C — three times five is 15' },
    { source: 'barozzi', page: 33, detail: '4 × 3 empty squares = 12, the minor wins by multiplication' },
    { source: 'selenus', page: 513, detail: 'Capture by multiplying (Vermehren)' },
  ],
  explanation: 'Multiplication capture is where geometry meets arithmetic. Barozzi explains that whoever moves first wins: the smaller piece captures by multiplication, the larger by division. "Whoever makes the first attack is the victor."',
};

const captureDivision: Scenario = {
  id: 'capture-division',
  category: 'capture',
  title: 'Capture by Division',
  subtitle: 'The inverse of multiplication',
  difficulty: 2,
  description: 'Your white triangle (20) is on a straight line with the black circle (5), with 3 empty squares between them. 20 ÷ 4 (distance) = 5. Capture by division.',
  hints: [
    'The enemy\'s value divided by the distance equals your piece\'s value — wait, it\'s the reverse: YOUR piece / distance is not right.',
    'Actually: enemy value / distance = your value. So 20 / 4 is not 5. Try: your position lets distance work.',
    'The distance is empty squares + 1. With 3 empty squares, distance = 4. Check: 20 / 4 = 5.',
  ],
  pieces: [
    { shape: 'triangle', value: 20, owner: 'even', position: { col: 2, row: 8 } },
    { shape: 'circle', value: 5, owner: 'odd', position: { col: 2, row: 4 } },
  ],
  playerSide: 'even',
  successCondition: { type: 'capture', targetValue: 5, method: 'division' },
  sourceRefs: [
    { source: 'lever', page: 45, detail: '4 in 20 is contained 5 times — captures the 5' },
    { source: 'barozzi', page: 33, detail: 'Division is the inverse of multiplication' },
  ],
  explanation: 'Division and multiplication are mirror images. Barozzi notes that if two opposing pieces are positioned for either capture, whoever moves first wins — making the relative position a loaded trigger.',
};

const captureSiege: Scenario = {
  id: 'capture-siege',
  category: 'capture',
  title: 'Capture by Siege',
  subtitle: 'Surround and conquer',
  difficulty: 2,
  description: 'The black square (153) can ONLY be captured by siege — no arithmetic combination of white pieces can reach the value 153. Three white pieces already surround it. Move your fourth piece to complete the siege.',
  hints: [
    'Siege requires blocking all 4 orthogonal exits (up, down, left, right).',
    'The board edge counts as blocking — pieces near the edge need fewer besiegers.',
    'The south side is still open. Move a piece there.',
  ],
  pieces: [
    { shape: 'circle', value: 8, owner: 'even', position: { col: 3, row: 2 } }, // north
    { shape: 'triangle', value: 9, owner: 'even', position: { col: 2, row: 3 } }, // west
    { shape: 'circle', value: 6, owner: 'even', position: { col: 4, row: 3 } }, // east
    { shape: 'circle', value: 4, owner: 'even', position: { col: 3, row: 5 } }, // moveable - needs to go to row 4
    { shape: 'square', value: 153, owner: 'odd', position: { col: 3, row: 3 } }, // target
  ],
  playerSide: 'even',
  successCondition: { type: 'capture', targetValue: 153, method: 'siege' },
  sourceRefs: [
    { source: 'barozzi', page: 37, detail: '153 white square and 190 black pyramid can ONLY be captured by siege' },
    { source: 'lever', page: 41, detail: 'By oblivion any man may be taken, even the king' },
    { source: 'selenus', page: 515, detail: 'Capture by besieging (Einsperren)' },
  ],
  explanation: 'Barozzi reveals that 153 and 190 are mathematically uncapturable — no combination of opposing pieces can sum, subtract, multiply, or divide to reach these values. Siege is the only option, making positional play essential.',
};

// ---------------------------------------------------------------------------
// Victory Formation Puzzles
// ---------------------------------------------------------------------------

const victoryArithmetic: Scenario = {
  id: 'victory-arithmetic',
  category: 'victory',
  title: 'Arithmetic Progression',
  subtitle: 'The Small Victory',
  difficulty: 2,
  description: 'Place three pieces with values in arithmetic progression (equal differences) in a line on the enemy\'s half of the board. You have pieces valued 2, 4, and 6. Move the 6 into position to complete the line.',
  hints: [
    'Arithmetic progression: the difference between consecutive values is constant.',
    '2, 4, 6 — the difference is always 2.',
    'The pieces must be on the enemy half (rows 8-15 for Even/White) and in a straight line.',
  ],
  pieces: [
    { shape: 'circle', value: 2, owner: 'even', position: { col: 3, row: 9 } },
    { shape: 'circle', value: 4, owner: 'even', position: { col: 4, row: 10 } },
    { shape: 'circle', value: 6, owner: 'even', position: { col: 4, row: 12 } }, // needs to move to col 5, row 11
  ],
  playerSide: 'even',
  successCondition: { type: 'victory-formation', victoryType: 'arithmetic' },
  sourceRefs: [
    { source: 'lever', page: 52, detail: '2, 4, 6 — here two is the distance' },
    { source: 'barozzi', page: 40, detail: 'Arithmetic proportion: equal differences' },
    { source: 'selenus', page: 521, detail: 'Victory by Zahl-Kunst (arithmetic)' },
  ],
  explanation: 'Selenus calls the arithmetic progression the most basic of the three victory types. All five sources list extensive tables of valid progressions — Lever & Fulke alone enumerate over 40 valid triples.',
};

const victoryGeometric: Scenario = {
  id: 'victory-geometric',
  category: 'victory',
  title: 'Geometric Progression',
  subtitle: 'Constant ratio',
  difficulty: 2,
  description: 'Place three pieces with values in geometric progression (constant ratio) in a line on the enemy\'s half. You have pieces valued 2, 4, and 8. Move the 8 to complete the diagonal.',
  hints: [
    'Geometric progression: each value is the same multiple of the previous.',
    '2, 4, 8 — each is doubled. The ratio is 2.',
    'A diagonal line counts — the pieces don\'t have to be in the same row or column.',
  ],
  pieces: [
    { shape: 'circle', value: 2, owner: 'even', position: { col: 2, row: 10 } },
    { shape: 'circle', value: 4, owner: 'even', position: { col: 3, row: 11 } },
    { shape: 'circle', value: 8, owner: 'even', position: { col: 3, row: 13 } }, // needs to move to col 4, row 12
  ],
  playerSide: 'even',
  successCondition: { type: 'victory-formation', victoryType: 'geometric' },
  sourceRefs: [
    { source: 'lever', page: 55, detail: '2, 4, 8 — as 4 exceedeth 2 by 2, so 8 exceedeth 4 by 4' },
    { source: 'barozzi', page: 42, detail: 'Geometric proportion: constant ratio' },
  ],
  explanation: 'The geometric progression represents Meß-Kunst (the art of measurement) in Selenus\'s framework. Where arithmetic is about counting, geometry is about proportional relationships.',
};

const victoryHarmonic: Scenario = {
  id: 'victory-harmonic',
  category: 'victory',
  title: 'Harmonic Progression',
  subtitle: 'Playing a chord',
  difficulty: 3,
  description: 'The harmonic progression is the game\'s deepest victory. Place pieces valued 3, 4, and 6 in a line on the enemy\'s half. These numbers encode the musical intervals of the fourth and the fifth — a chord.',
  hints: [
    'Harmonic progression: the reciprocals form an arithmetic progression.',
    '1/6, 1/4, 1/3 — the differences between consecutive reciprocals are equal (1/12 each).',
    'Selenus: "In those numbers all the harmonies are contained."',
  ],
  pieces: [
    { shape: 'circle', value: 3, owner: 'odd', position: { col: 4, row: 5 } },
    { shape: 'circle', value: 4, owner: 'even', position: { col: 3, row: 5 } }, // captured piece, playing for odd
    { shape: 'triangle', value: 6, owner: 'odd', position: { col: 4, row: 7 } }, // needs to move to col 2, row 5
  ],
  playerSide: 'odd',
  successCondition: { type: 'victory-formation', victoryType: 'harmonic' },
  sourceRefs: [
    { source: 'lever', page: 58, detail: '3, 4, 6 — between 3 and 4 is 1; between 4 and 6 is 2; the whole is 3' },
    { source: 'barozzi', page: 43, detail: 'Musical proportion: reciprocals form arithmetic' },
    { source: 'selenus', page: 523, detail: 'Singe-Kunst table lists 3, 4, 6 as harmonic proportion' },
  ],
  explanation: 'Selenus demonstrates that 3, 4, 6 encodes the musical fifth (3:2), fourth (4:3), and octave (6:3). Buxerius confirms: "These ratios, if examined by weight or measured in strings, always provide Musical Harmony." You don\'t just win — you play a chord.',
};

// ---------------------------------------------------------------------------
// Barozzi's Strategic Lessons
// ---------------------------------------------------------------------------

const strategyUseEnemyPieces: Scenario = {
  id: 'strategy-use-enemy',
  category: 'strategy',
  title: 'Use the Enemy\'s Pieces',
  subtitle: 'Barozzi\'s Third Rule',
  difficulty: 3,
  description: 'Barozzi\'s third rule: "Make victories as much as possible with the adversary\'s pieces." An enemy piece valued 4 sits on the enemy half. You have a 2 and a 6. Move the 6 into line with the enemy 4 and your 2 to form the arithmetic progression 2, 4, 6.',
  hints: [
    'You don\'t need to capture the enemy 4 — it counts for your victory formation while it sits there.',
    'Arrange your pieces so all three form a straight line on the enemy half.',
    'The progression 2, 4, 6 has a constant difference of 2.',
  ],
  pieces: [
    { shape: 'circle', value: 2, owner: 'even', position: { col: 2, row: 9 } },
    { shape: 'circle', value: 4, owner: 'odd', position: { col: 3, row: 10 } }, // enemy piece on enemy half
    { shape: 'circle', value: 6, owner: 'even', position: { col: 5, row: 12 } }, // needs to move to col 4, row 11
  ],
  playerSide: 'even',
  successCondition: { type: 'victory-formation', victoryType: 'arithmetic' },
  sourceRefs: [
    { source: 'barozzi', page: 51, detail: 'Third rule: use the adversary\'s pieces for victories' },
    { source: 'selenus', page: 530, detail: 'Arrange your pieces near the enemy\'s to make victories together' },
  ],
  explanation: 'This is Barozzi\'s most cunning rule. Buxerius (via Selenus) goes further: "It is much more expedient to achieve harmony from the enemy\'s pieces than from transferring our own into foreign positions." The enemy builds your victory for you.',
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  captureEquality,
  captureAddition,
  captureSubtraction,
  captureMultiplication,
  captureDivision,
  captureSiege,
  victoryArithmetic,
  victoryGeometric,
  victoryHarmonic,
  strategyUseEnemyPieces,
];

export const SCENARIO_CATEGORIES: { key: ScenarioCategory; label: string; description: string }[] = [
  { key: 'capture', label: 'Capture Puzzles', description: 'Learn the six methods of arithmetic combat' },
  { key: 'victory', label: 'Victory Formations', description: 'Arrange pieces in mathematical progressions' },
  { key: 'strategy', label: 'Strategic Lessons', description: 'Tactics from Barozzi\'s seven rules' },
];
