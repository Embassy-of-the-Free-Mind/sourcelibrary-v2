// Tutorial step definitions for Rithmomachia
// Each step has a title, explanatory text, and optional board highlight info

export interface TutorialStep {
  title: string;
  text: string;
  // Optional: which section of rules this belongs to
  section: 'intro' | 'movement' | 'capture' | 'victory';
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // --- Introduction ---
  {
    section: 'intro',
    title: 'Welcome to Rithmomachia',
    text: 'Rithmomachia ("The Battle of Numbers") is a mathematical board game played across Europe from the 10th to the 17th century. Scholars, mathematicians, and students played it as both entertainment and education. These rules follow Lever & Fulke\'s 1563 English treatise.',
  },
  {
    section: 'intro',
    title: 'The Board',
    text: 'The board is 8 columns wide and 16 rows tall — like two chessboards joined end to end. Even (White) starts at the bottom, Odd (Black) at the top. Each side has 24 pieces: 8 circles, 8 triangles, 7 squares, and 1 pyramid.',
  },
  {
    section: 'intro',
    title: 'Piece Values',
    text: 'Every piece has a number — its value. These aren\'t random: they follow Pythagorean mathematics. Circles hold simple digits and their squares. Triangles hold sums of circle pairs. Squares hold sums of triangle pairs. The pyramid combines all layers.',
  },

  // --- Movement ---
  {
    section: 'movement',
    title: 'Circle Movement',
    text: 'Circles move exactly 1 space diagonally, in any direction. Like a chess king\'s diagonal moves. They cannot move orthogonally (up/down/left/right). Click a circle to see its legal moves highlighted in green.',
  },
  {
    section: 'movement',
    title: 'Triangle Movement',
    text: 'Triangles leap exactly 2 spaces orthogonally (up, down, left, or right). They jump over any pieces in the way — nothing blocks a triangle\'s leap. They cannot move diagonally.',
  },
  {
    section: 'movement',
    title: 'Square Movement',
    text: 'Squares leap exactly 3 spaces orthogonally. Like triangles, they jump over intervening pieces. The larger leap distance makes squares powerful for reaching across the board.',
  },
  {
    section: 'movement',
    title: 'The Pyramid',
    text: 'Each side has one pyramid (White: 91, Black: 190). The pyramid is built from stacked layers of circles, triangles, and squares. It can move as any of those shapes — 1 diagonal, 2 orthogonal, or 3 orthogonal. This makes it the most mobile piece on the board.',
  },

  // --- Captures ---
  {
    section: 'capture',
    title: 'How Captures Work',
    text: 'After you move a piece, you may capture an enemy piece if the right arithmetic condition is met. Captures are optional — you can always skip. Captured pieces are removed from the board and added to your collection.',
  },
  {
    section: 'capture',
    title: 'Equality Capture',
    text: 'The simplest capture: if your piece could move to a square occupied by an enemy of equal value, you capture it. Example: your 25 threatens an enemy 25.',
  },
  {
    section: 'capture',
    title: 'Addition & Subtraction',
    text: 'Addition: two or more of your pieces threaten the same enemy, and their values add up to the enemy\'s value. Example: your 6 and 9 both threaten an enemy 15. Subtraction: the difference of two threatening pieces equals the enemy\'s value.',
  },
  {
    section: 'capture',
    title: 'Multiplication & Division',
    text: 'Multiplication: your piece\'s value times its distance to the enemy equals the enemy\'s value. Must be on a straight line with clear path. Division: the enemy\'s value divided by the distance equals your piece\'s value.',
  },
  {
    section: 'capture',
    title: 'Siege',
    text: 'If an enemy piece is completely surrounded — all four orthogonal neighbors are your pieces or the board edge — it is captured by siege. The enemy has no escape route.',
  },

  // --- Victory ---
  {
    section: 'victory',
    title: 'Common Victories',
    text: 'Three ways to win by force: Bodies (capture 15+ pieces), Goods (capture pieces worth 200+ total), or Quarrel (capture 10+ pieces worth 150+ total). Progress bars in the sidebar track your approach to each.',
  },
  {
    section: 'victory',
    title: 'Philosophical Victories',
    text: 'The highest achievement: place 3 or more of your pieces in a straight line on the enemy\'s half of the board, with values forming a mathematical progression — arithmetic (constant difference), geometric (constant ratio), or harmonic (reciprocals in arithmetic progression). "In those numbers all the harmonies are contained." — Selenus, 1616',
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
