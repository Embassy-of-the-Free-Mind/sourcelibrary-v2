// Primary source references for Rithmomachia rules
// Links to specific pages in the 5 treatises held by Source Library (1496–1616)

export interface SourceRef {
  author: string;
  shortTitle: string;
  year: number;
  language: string;
  slug: string;
  page?: number;
  quote?: string;
}

// The five primary sources, ordered chronologically
export const SOURCES = {
  jordanus: {
    author: 'Jordanus / Lefèvre',
    shortTitle: 'Rithmimachie Ludus',
    year: 1496,
    language: 'Latin',
    slug: 'arithmetica-decem-libris-demonstrata-with-rithmimachie-ludus-stapulensis',
  },
  boissiere: {
    author: 'Boissière',
    shortTitle: 'Le Jeu Pythagorique',
    year: 1554,
    language: 'French',
    slug: 'le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere',
  },
  lever: {
    author: 'Lever & Fulke',
    shortTitle: 'The Learned Playe',
    year: 1563,
    language: 'English',
    slug: 'the-most-noble-auncient-and-learned-playe-called-the-fulke',
  },
  barozzi: {
    author: 'Barozzi',
    shortTitle: 'Il Giuoco Pythagoreo',
    year: 1572,
    language: 'Italian',
    slug: 'il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi',
  },
  selenus: {
    author: 'Selenus',
    shortTitle: 'Das Schach-Spiel',
    year: 1616,
    language: 'German',
    slug: 'the-game-of-chess-gustavus-selenus',
  },
} as const;

export type SourceKey = keyof typeof SOURCES;

export function sourceUrl(key: SourceKey, page?: number): string {
  const src = SOURCES[key];
  const base = `https://sourcelibrary.org/book/${src.slug}`;
  return page ? `${base}?page=${page}` : base;
}

export function sourceLabel(key: SourceKey): string {
  const src = SOURCES[key];
  return `${src.author} (${src.year})`;
}

// Concept-to-source mappings: each game concept links to specific pages across all 5 books
// Page numbers reference the book's internal pagination as displayed in Source Library

export interface ConceptSources {
  concept: string;
  description: string;
  refs: { source: SourceKey; page?: number; detail?: string }[];
}

export const CONCEPT_SOURCES: Record<string, ConceptSources> = {
  board: {
    concept: 'The Board',
    description: '8 columns wide by 16 rows tall — "two chessboards joined end to end"',
    refs: [
      { source: 'jordanus', page: 143, detail: 'Board dimensions described' },
      { source: 'boissiere', page: 37, detail: 'Woodcut diagram of board' },
      { source: 'lever', page: 8, detail: 'Board description' },
      { source: 'barozzi', page: 26, detail: 'Woodcut diagram showing full board' },
      { source: 'selenus', page: 498, detail: 'Full-page copperplate engraving of board' },
    ],
  },
  pieceValues: {
    concept: 'Piece Values',
    description: 'Every piece bears a number derived from Pythagorean mathematics',
    refs: [
      { source: 'jordanus', page: 144, detail: 'Number derivation in Latin' },
      { source: 'boissiere', page: 14, detail: 'Number table for piece values' },
      { source: 'lever', page: 9, detail: 'Value derivation in English' },
      { source: 'barozzi', page: 15, detail: 'Piece value derivation' },
      { source: 'selenus', page: 499, detail: 'Perspective view showing numbered pieces' },
    ],
  },
  circleMovement: {
    concept: 'Circle Movement',
    description: 'Circles move 1 space diagonally',
    refs: [
      { source: 'jordanus', page: 146, detail: 'Movement rules' },
      { source: 'boissiere', page: 42, detail: 'Circle movement' },
      { source: 'lever', page: 12, detail: '"Rounds" move diagonally' },
      { source: 'barozzi', page: 30, detail: 'Circle movement' },
      { source: 'selenus', page: 503, detail: 'Circle movement' },
    ],
  },
  triangleMovement: {
    concept: 'Triangle Movement',
    description: 'Triangles leap 2 spaces orthogonally',
    refs: [
      { source: 'jordanus', page: 146, detail: '"Unto the third place"' },
      { source: 'lever', page: 12, detail: 'Triangle movement' },
      { source: 'barozzi', page: 31, detail: 'Triangle movement' },
      { source: 'selenus', page: 504, detail: 'Triangle movement' },
    ],
  },
  squareMovement: {
    concept: 'Square Movement',
    description: 'Squares leap 3 spaces orthogonally',
    refs: [
      { source: 'jordanus', page: 146, detail: '"Unto the fourth place"' },
      { source: 'lever', page: 13, detail: 'Square movement' },
      { source: 'barozzi', page: 31, detail: 'Square movement' },
      { source: 'selenus', page: 504, detail: 'Square movement' },
    ],
  },
  pyramid: {
    concept: 'The Pyramid',
    description: 'White pyramid = 91 (6 layers to unity), Black pyramid = 190 (5 layers)',
    refs: [
      { source: 'lever', page: 10, detail: 'Pyramid as stacked layers' },
      { source: 'barozzi', page: 18, detail: 'Pyramid construction' },
      { source: 'selenus', page: 502, detail: '"Tower" with removable screw-fastened levels' },
    ],
  },
  equalityCapture: {
    concept: 'Equality Capture',
    description: 'Capture a piece of equal value that your piece could reach',
    refs: [
      { source: 'jordanus', page: 147, detail: 'Equality capture' },
      { source: 'lever', page: 14, detail: 'Equality capture in English' },
      { source: 'barozzi', page: 34, detail: 'Equality capture' },
      { source: 'selenus', page: 510, detail: 'Equality capture' },
    ],
  },
  additionCapture: {
    concept: 'Addition Capture',
    description: 'Two or more pieces threaten an enemy whose value equals their sum',
    refs: [
      { source: 'lever', page: 15, detail: 'Addition and subtraction' },
      { source: 'barozzi', page: 35, detail: 'Arithmetic captures' },
      { source: 'selenus', page: 512, detail: 'Addition capture' },
    ],
  },
  subtractionCapture: {
    concept: 'Subtraction Capture',
    description: 'Two pieces threaten an enemy whose value equals their difference',
    refs: [
      { source: 'lever', page: 15, detail: 'Subtraction capture' },
      { source: 'barozzi', page: 36, detail: 'Subtraction capture' },
      { source: 'selenus', page: 513, detail: 'Subtraction capture' },
    ],
  },
  multiplicationCapture: {
    concept: 'Multiplication Capture',
    description: 'Your piece value times its distance equals the enemy value',
    refs: [
      { source: 'lever', page: 16, detail: 'Multiplication capture' },
      { source: 'barozzi', page: 37, detail: 'Multiplication capture' },
      { source: 'selenus', page: 514, detail: 'Multiplication capture' },
    ],
  },
  divisionCapture: {
    concept: 'Division Capture',
    description: 'Enemy value divided by distance equals your piece value',
    refs: [
      { source: 'lever', page: 16, detail: 'Division capture' },
      { source: 'barozzi', page: 37, detail: 'Division capture' },
      { source: 'selenus', page: 515, detail: 'Division capture' },
    ],
  },
  siegeCapture: {
    concept: 'Siege',
    description: 'Enemy surrounded on all four orthogonal sides — no escape',
    refs: [
      { source: 'lever', page: 17, detail: 'Siege capture' },
      { source: 'barozzi', page: 38, detail: 'Siege capture' },
      { source: 'selenus', page: 516, detail: 'Siege capture' },
    ],
  },
  commonVictory: {
    concept: 'Common Victories',
    description: 'Win by force: Bodies (15+ pieces), Goods (200+ value), or Quarrel (10 pieces + 150 value)',
    refs: [
      { source: 'lever', page: 18, detail: 'Three common victories' },
      { source: 'barozzi', page: 40, detail: 'Common victories' },
      { source: 'selenus', page: 520, detail: 'Common victories' },
    ],
  },
  philosophicalVictory: {
    concept: 'Philosophical Victories',
    description: '3+ pieces in arithmetic, geometric, or harmonic progression on the enemy half',
    refs: [
      { source: 'lever', page: 19, detail: 'Philosophical victories in English' },
      { source: 'barozzi', page: 42, detail: 'Philosophical victories' },
      { source: 'selenus', page: 536, detail: '"In those numbers all the harmonies are contained"' },
    ],
  },
  evenOddCosmology: {
    concept: 'Even and Odd',
    description: 'The two sides represent the Pythagorean duality of even and odd numbers',
    refs: [
      { source: 'jordanus', page: 146, detail: 'Even/odd cosmology' },
      { source: 'lever', page: 6, detail: 'Dedicatory poem attributing game to Pythagoras' },
      { source: 'selenus', page: 248, detail: 'Copperplate of two aristocratic players' },
    ],
  },
};

// Illustrations from the primary sources that can be shown in the game UI
export interface SourceIllustration {
  source: SourceKey;
  page: number;
  description: string;
  // Approximate aspect ratio for layout (width/height)
  aspect?: number;
}

export const KEY_ILLUSTRATIONS: SourceIllustration[] = [
  { source: 'selenus', page: 498, description: 'Board engraving with numbered pieces', aspect: 0.7 },
  { source: 'selenus', page: 499, description: 'Perspective view of the board', aspect: 0.7 },
  { source: 'selenus', page: 248, description: 'Two aristocratic men at the game', aspect: 0.7 },
  { source: 'barozzi', page: 26, description: 'Woodcut diagram of the game board', aspect: 0.8 },
  { source: 'boissiere', page: 37, description: 'Game board diagram', aspect: 0.8 },
  { source: 'boissiere', page: 39, description: 'Board with pieces in starting position', aspect: 0.8 },
  { source: 'boissiere', page: 14, description: 'Number table for piece values', aspect: 0.8 },
];
