// Tutorial step definitions for Rithmomachia
// Each step references specific pages across all 5 primary sources (1496–1616)

import { SourceKey } from './sources';

export interface TutorialSourceRef {
  source: SourceKey;
  page?: number;
  detail?: string;
}

export interface TutorialIllustration {
  source: SourceKey;
  page: number;
  caption: string;
  /** Direct image URL (archived Vercel Blob) */
  imageUrl: string;
}

export interface TutorialStep {
  title: string;
  text: string;
  section: 'intro' | 'movement' | 'capture' | 'victory';
  // Primary source references for this step
  sources?: TutorialSourceRef[];
  // Featured illustration from a primary source
  illustration?: TutorialIllustration;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // --- Introduction ---
  {
    section: 'intro',
    title: 'Welcome to Rithmomachia',
    text: 'Rithmomachia ("The Battle of Numbers") is a mathematical board game played across Europe from the 10th to the 17th century. Source Library holds five complete treatises on this game — in Latin, French, English, Italian, and German — spanning 1496 to 1616. These rules are synthesized from all five sources.',
    sources: [
      { source: 'jordanus', detail: 'Earliest printed treatise (Latin, 1496)' },
      { source: 'boissiere', detail: 'French treatise (1554)' },
      { source: 'lever', detail: 'English treatise (1563)' },
      { source: 'barozzi', detail: 'Italian treatise (1572)' },
      { source: 'selenus', detail: 'German treatise (1616)' },
    ],
    illustration: {
      source: 'selenus',
      page: 248,
      caption: 'Two aristocrats playing Rithmomachia (Selenus, 1616)',
      imageUrl: 'https://images.sourcelibrary.org/archived/699fcd499ff0f1d2c4518062/248.jpg',
    },
  },
  {
    section: 'intro',
    title: 'The Board',
    text: 'The board is 8 columns wide and 16 rows tall — like two chessboards joined end to end. Even (White) starts at the bottom, Odd (Black) at the top. All five sources agree on this layout. Barozzi (1572) and Boissière (1554) include woodcut diagrams; Selenus (1616) has a magnificent copperplate engraving.',
    sources: [
      { source: 'barozzi', page: 26, detail: 'Woodcut diagram of board' },
      { source: 'boissiere', page: 37, detail: 'Board diagram' },
      { source: 'selenus', page: 498, detail: 'Copperplate engraving of board' },
      { source: 'selenus', page: 499, detail: 'Perspective view' },
    ],
    illustration: {
      source: 'selenus',
      page: 498,
      caption: 'Copperplate engraving of the board (Selenus, 1616)',
      imageUrl: 'https://images.sourcelibrary.org/archived/699fcd499ff0f1d2c4518062/498.jpg',
    },
  },
  {
    section: 'intro',
    title: 'Piece Values',
    text: 'Every piece has a number derived from Pythagorean mathematics. Circles hold simple digits and their squares. Triangles hold sums of circle pairs. Squares hold sums of triangle pairs. The pyramid combines all layers. All five sources agree on every value — remarkable stability across 120 years and 5 languages.',
    sources: [
      { source: 'boissiere', page: 14, detail: 'Number table for values' },
      { source: 'lever', page: 9, detail: 'Value derivation in English' },
      { source: 'barozzi', page: 15, detail: 'Value derivation' },
      { source: 'jordanus', page: 144, detail: 'Values in Latin' },
    ],
    illustration: {
      source: 'boissiere',
      page: 14,
      caption: 'Number table for piece values (Boissière, 1554)',
      imageUrl: 'https://images.sourcelibrary.org/archived/699fcd509ff0f1d2c4518280/14.jpg',
    },
  },

  // --- Movement ---
  {
    section: 'movement',
    title: 'Circle Movement',
    text: 'Circles move exactly 1 space diagonally, in any direction. Like a chess king\'s diagonal moves. They cannot move orthogonally (up/down/left/right). Click a circle to see its legal moves highlighted in green.',
    sources: [
      { source: 'lever', page: 12, detail: '"Rounds" move diagonally' },
      { source: 'barozzi', page: 30, detail: 'Circle movement' },
      { source: 'selenus', page: 503, detail: 'Circle movement' },
    ],
  },
  {
    section: 'movement',
    title: 'Triangle Movement',
    text: 'Triangles leap exactly 2 spaces orthogonally (up, down, left, or right). They jump over any pieces in the way — nothing blocks a triangle\'s leap. The sources say "unto the third place" (inclusive counting: 1=start, 2=intermediate, 3=destination).',
    sources: [
      { source: 'jordanus', page: 146, detail: '"Unto the third place"' },
      { source: 'lever', page: 12, detail: 'Triangle movement' },
      { source: 'selenus', page: 504, detail: 'Triangle movement' },
    ],
  },
  {
    section: 'movement',
    title: 'Square Movement',
    text: 'Squares leap exactly 3 spaces orthogonally. Like triangles, they jump over intervening pieces. The sources say "unto the fourth place." The longer range makes squares powerful for reaching across the board.',
    sources: [
      { source: 'jordanus', page: 146, detail: '"Unto the fourth place"' },
      { source: 'lever', page: 13, detail: 'Square movement' },
      { source: 'selenus', page: 504, detail: 'Square movement' },
    ],
  },
  {
    section: 'movement',
    title: 'The Pyramid',
    text: 'Each side has one pyramid (White: 91, Black: 190). The pyramid is built from stacked layers — Selenus describes it as a "Tower" with removable screw-fastened levels. It can move as any shape: 1 diagonal, 2 orthogonal, or 3 orthogonal.',
    sources: [
      { source: 'lever', page: 10, detail: 'Pyramid as stacked layers' },
      { source: 'barozzi', page: 18, detail: 'Pyramid construction' },
      { source: 'selenus', page: 502, detail: '"Tower" with screw-fastened levels' },
    ],
    illustration: {
      source: 'selenus',
      page: 499,
      caption: 'Perspective view with pyramid "towers" (Selenus, 1616)',
      imageUrl: 'https://images.sourcelibrary.org/archived/699fcd499ff0f1d2c4518062/499.jpg',
    },
  },

  // --- Captures ---
  {
    section: 'capture',
    title: 'How Captures Work',
    text: 'After you move a piece, you may capture an enemy piece if the right arithmetic condition is met. Captures are optional — you can always skip. Captured pieces change color and join your collection. All five sources describe the same six capture methods.',
    sources: [
      { source: 'lever', page: 14, detail: 'Capture rules in English' },
      { source: 'barozzi', page: 34, detail: 'Capture rules' },
      { source: 'selenus', page: 510, detail: 'Capture rules' },
    ],
  },
  {
    section: 'capture',
    title: 'Equality Capture',
    text: 'The simplest capture: if your piece could move to a square occupied by an enemy of equal value, you capture it. Example: your 25 threatens an enemy 25.',
    sources: [
      { source: 'jordanus', page: 147, detail: 'Equality capture' },
      { source: 'lever', page: 14, detail: 'Equality capture' },
      { source: 'selenus', page: 510, detail: 'Equality capture' },
    ],
  },
  {
    section: 'capture',
    title: 'Addition & Subtraction',
    text: 'Addition: two or more of your pieces threaten the same enemy, and their values add up to the enemy\'s value. Subtraction: the difference of two threatening pieces equals the enemy\'s value.',
    sources: [
      { source: 'lever', page: 15, detail: 'Addition and subtraction' },
      { source: 'barozzi', page: 35, detail: 'Arithmetic captures' },
      { source: 'selenus', page: 512, detail: 'Addition capture' },
    ],
  },
  {
    section: 'capture',
    title: 'Multiplication & Division',
    text: 'Multiplication: your piece\'s value times its distance to the enemy equals the enemy\'s value. Must be on a straight line. Division: the enemy\'s value divided by the distance equals your piece\'s value.',
    sources: [
      { source: 'lever', page: 16, detail: 'Multiplication & division' },
      { source: 'barozzi', page: 37, detail: 'Multiplication & division' },
      { source: 'selenus', page: 514, detail: 'Multiplication capture' },
    ],
  },
  {
    section: 'capture',
    title: 'Siege',
    text: 'If an enemy piece is completely surrounded — all four orthogonal neighbors are your pieces or the board edge — it is captured by siege. The enemy has no escape route.',
    sources: [
      { source: 'lever', page: 17, detail: 'Siege capture' },
      { source: 'barozzi', page: 38, detail: 'Siege capture' },
      { source: 'selenus', page: 516, detail: 'Siege capture' },
    ],
  },

  // --- Victory ---
  {
    section: 'victory',
    title: 'Common Victories',
    text: 'Three ways to win by force: Bodies (capture 15+ pieces), Goods (capture pieces worth 200+ total), or Quarrel (capture 10+ pieces worth 150+ total). Progress bars in the sidebar track your approach to each.',
    sources: [
      { source: 'lever', page: 18, detail: 'Three common victories' },
      { source: 'barozzi', page: 40, detail: 'Common victories' },
      { source: 'selenus', page: 520, detail: 'Common victories' },
    ],
  },
  {
    section: 'victory',
    title: 'Philosophical Victories',
    text: 'The highest achievement: place 3 or more of your pieces in a straight line on the enemy\'s half, with values forming an arithmetic, geometric, or harmonic progression. Selenus (1616) calls this the supreme triumph: "In those numbers all the harmonies are contained."',
    sources: [
      { source: 'lever', page: 19, detail: 'Philosophical victories' },
      { source: 'barozzi', page: 42, detail: 'Philosophical victories' },
      { source: 'selenus', page: 536, detail: '"All harmonies are contained"' },
    ],
  },
];

/** Get the section label for display */
export function getSectionLabel(section: TutorialStep['section']): string {
  switch (section) {
    case 'intro': return 'Introduction';
    case 'movement': return 'Movement';
    case 'capture': return 'Captures';
    case 'victory': return 'Victory';
  }
}
