import { Metadata } from 'next';
import Link from 'next/link';
import MiniBoard, { MiniBoardPiece } from '@/components/rithmomachia/MiniBoard';
import { Position } from '@/lib/rithmomachia/types';

export const metadata: Metadata = {
  title: 'Rithmomachia Visual Guide | Source Library',
  description: 'Learn to play Rithmomachia with illustrated board diagrams — movement, captures, and strategy explained visually.',
};

// --- Example board setups ---

// 1. Circle movement: 1 space diagonal
const circleMovePieces: MiniBoardPiece[] = [
  { shape: 'circle', value: 8, owner: 'even', position: { col: 2, row: 2 } },
];
const circleMoves: Position[] = [
  { col: 1, row: 1 }, { col: 3, row: 1 },
  { col: 1, row: 3 }, { col: 3, row: 3 },
];

// 2. Triangle movement: 2 spaces orthogonal
const triangleMovePieces: MiniBoardPiece[] = [
  { shape: 'triangle', value: 25, owner: 'even', position: { col: 2, row: 2 } },
];
const triangleMoves: Position[] = [
  { col: 2, row: 0 }, { col: 2, row: 4 },
  { col: 0, row: 2 }, { col: 4, row: 2 },
];

// 3. Square movement: 3 spaces orthogonal
const squareMovePieces: MiniBoardPiece[] = [
  { shape: 'square', value: 81, owner: 'even', position: { col: 3, row: 3 } },
];
const squareMoves: Position[] = [
  { col: 3, row: 0 }, { col: 3, row: 6 },
  { col: 0, row: 3 }, { col: 6, row: 3 },
];

// 4. Equality capture: white 25 adjacent to black 25
const equalityPieces: MiniBoardPiece[] = [
  { shape: 'triangle', value: 25, owner: 'even', position: { col: 1, row: 2 } },
  { shape: 'circle', value: 25, owner: 'odd', position: { col: 3, row: 2 } },
];

// 5. Addition capture: white 9 + white 16 flank black 25
const additionPieces: MiniBoardPiece[] = [
  { shape: 'circle', value: 9, owner: 'even', position: { col: 1, row: 2 } },
  { shape: 'circle', value: 16, owner: 'even', position: { col: 3, row: 2 } },
  { shape: 'circle', value: 25, owner: 'odd', position: { col: 2, row: 2 } },
];

// 6. Siege: black piece surrounded on all 4 sides
const siegePieces: MiniBoardPiece[] = [
  { shape: 'circle', value: 4, owner: 'even', position: { col: 2, row: 1 } },
  { shape: 'circle', value: 6, owner: 'even', position: { col: 2, row: 3 } },
  { shape: 'circle', value: 8, owner: 'even', position: { col: 1, row: 2 } },
  { shape: 'triangle', value: 9, owner: 'even', position: { col: 3, row: 2 } },
  { shape: 'triangle', value: 36, owner: 'odd', position: { col: 2, row: 2 } },
];

// --- Section component ---

function GuideSection({
  title,
  children,
  board,
  reverse = false,
}: {
  title: string;
  children: React.ReactNode;
  board: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className={`grid md:grid-cols-[280px_1fr] gap-6 items-start ${reverse ? 'md:grid-cols-[1fr_280px]' : ''}`}>
      {reverse ? (
        <>
          <div className="space-y-2 order-2 md:order-1">{children}</div>
          <div className="order-1 md:order-2">{board}</div>
        </>
      ) : (
        <>
          <div className="order-1">{board}</div>
          <div className="space-y-2 order-2">{children}</div>
        </>
      )}
    </div>
  );
}

export default function RithmomachiaGuidePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <Link href="/rithmomachia" className="text-sm text-accent-rust hover:underline">
          &larr; Back to game
        </Link>
        <h1 className="font-serif text-3xl md:text-4xl text-primary mt-3 mb-2">
          Visual Guide
        </h1>
        <p className="text-muted">
          Rithmomachia looks complicated at first glance. These diagrams break it down
          move by move. Green dots show where a piece can go; gold highlights show captures.
        </p>
      </div>

      <div className="space-y-12">
        {/* --- Movement --- */}
        <div>
          <h2 className="font-serif text-xl text-secondary mb-1">Movement</h2>
          <p className="text-muted text-sm mb-6">
            Each piece shape moves a fixed number of squares. Pieces cannot jump over others.
          </p>

          {/* Circle */}
          <div className="space-y-8">
            <GuideSection
              title="Circles"
              board={
                <MiniBoard
                  pieces={circleMovePieces}
                  legalMoves={circleMoves}
                  selectedPiece={{ col: 2, row: 2 }}
                  region={{ colStart: 0, colEnd: 5, rowStart: 0, rowEnd: 5 }}
                  label="Circle: 1 space, diagonals only"
                />
              }
            >
              <h3 className="font-serif text-lg text-secondary">Circles &mdash; 1 diagonal</h3>
              <p className="text-muted text-sm leading-relaxed">
                Circles are the simplest piece. They move <strong>one space diagonally</strong> in
                any direction &mdash; like a bishop taking a single step. In the original sources,
                Lever &amp; Fulke (1563) describe them as moving &ldquo;like pawns in chess.&rdquo;
              </p>
              <p className="text-muted text-sm leading-relaxed">
                Each side has <strong>8 circles</strong> with values based on the number series.
                White circles: 2, 4, 4, 6, 8, 16, 36, 64.
              </p>
            </GuideSection>

            {/* Triangle */}
            <GuideSection
              title="Triangles"
              reverse
              board={
                <MiniBoard
                  pieces={triangleMovePieces}
                  legalMoves={triangleMoves}
                  selectedPiece={{ col: 2, row: 2 }}
                  region={{ colStart: 0, colEnd: 5, rowStart: 0, rowEnd: 5 }}
                  label="Triangle: 2 spaces, orthogonal"
                />
              }
            >
              <h3 className="font-serif text-lg text-secondary">Triangles &mdash; 2 orthogonal</h3>
              <p className="text-muted text-sm leading-relaxed">
                Triangles leap <strong>exactly 2 squares</strong> in a straight line &mdash; up, down,
                left, or right. They skip over any piece in the way (like a knight&rsquo;s range, but
                straight).
              </p>
              <p className="text-muted text-sm leading-relaxed">
                The distance matches the shape: a triangle has 3 vertices, and moves
                3 &minus; 1 = 2 squares. Each side has <strong>8 triangles</strong>.
              </p>
            </GuideSection>

            {/* Square */}
            <GuideSection
              title="Squares"
              board={
                <MiniBoard
                  pieces={squareMovePieces}
                  legalMoves={squareMoves}
                  selectedPiece={{ col: 3, row: 3 }}
                  region={{ colStart: 0, colEnd: 7, rowStart: 0, rowEnd: 7 }}
                  label="Square: 3 spaces, orthogonal"
                />
              }
            >
              <h3 className="font-serif text-lg text-secondary">Squares &mdash; 3 orthogonal</h3>
              <p className="text-muted text-sm leading-relaxed">
                Squares leap <strong>exactly 3 squares</strong> in a straight line. With 4 vertices,
                they move 4 &minus; 1 = 3 spaces. These are your long-range pieces.
              </p>
              <p className="text-muted text-sm leading-relaxed">
                Each side has <strong>7 squares</strong> plus one <strong>pyramid</strong> (which
                moves as any of the three shapes, using the value of its top layer).
              </p>
            </GuideSection>
          </div>
        </div>

        {/* --- Captures --- */}
        <div>
          <h2 className="font-serif text-xl text-secondary mb-1">Captures</h2>
          <p className="text-muted text-sm mb-6">
            The key rule: <strong>you never land on an enemy piece.</strong> Instead, after moving,
            the game checks whether your pieces can capture an adjacent enemy by matching its
            numerical value. There are several ways to match.
          </p>

          {/* Equality */}
          <div className="space-y-8">
            <GuideSection
              title="Equality"
              reverse
              board={
                <MiniBoard
                  pieces={equalityPieces}
                  captureTargets={[{ col: 3, row: 2 }]}
                  attackers={[{ col: 1, row: 2 }]}
                  region={{ colStart: 0, colEnd: 5, rowStart: 0, rowEnd: 5 }}
                  label="Equality: 25 captures 25"
                />
              }
            >
              <h3 className="font-serif text-lg text-secondary">Equality</h3>
              <p className="text-muted text-sm leading-relaxed">
                The simplest capture. If your piece&rsquo;s value <strong>equals</strong> an
                adjacent enemy&rsquo;s value, you can take it. Here, white&rsquo;s triangle (25)
                threatens the black circle (25).
              </p>
              <p className="text-muted text-sm leading-relaxed">
                &ldquo;Adjacent&rdquo; means the target is within one move&rsquo;s reach of the
                attacking piece &mdash; one diagonal for circles, two orthogonal for triangles, etc.
              </p>
            </GuideSection>

            {/* Addition */}
            <GuideSection
              title="Addition"
              board={
                <MiniBoard
                  pieces={additionPieces}
                  captureTargets={[{ col: 2, row: 2 }]}
                  attackers={[{ col: 1, row: 2 }, { col: 3, row: 2 }]}
                  region={{ colStart: 0, colEnd: 5, rowStart: 0, rowEnd: 5 }}
                  label="Addition: 9 + 16 = 25"
                />
              }
            >
              <h3 className="font-serif text-lg text-secondary">Addition</h3>
              <p className="text-muted text-sm leading-relaxed">
                Two (or more) of your pieces whose values <strong>add up</strong> to an enemy&rsquo;s
                value can capture it. Here, white 9 + white 16 = 25, so they capture black 25.
              </p>
              <p className="text-muted text-sm leading-relaxed">
                The attacking pieces must each be within their movement range of the target.
                Subtraction, multiplication, and division work the same way with different arithmetic.
              </p>
            </GuideSection>

            {/* Siege */}
            <GuideSection
              title="Siege"
              reverse
              board={
                <MiniBoard
                  pieces={siegePieces}
                  captureTargets={[{ col: 2, row: 2 }]}
                  attackers={[
                    { col: 2, row: 1 }, { col: 2, row: 3 },
                    { col: 1, row: 2 }, { col: 3, row: 2 },
                  ]}
                  region={{ colStart: 0, colEnd: 5, rowStart: 0, rowEnd: 5 }}
                  label="Siege: surrounded on all 4 sides"
                />
              }
            >
              <h3 className="font-serif text-lg text-secondary">Siege</h3>
              <p className="text-muted text-sm leading-relaxed">
                If an enemy piece is <strong>surrounded on all four orthogonal sides</strong> by your
                pieces (regardless of values), it&rsquo;s captured by siege. No arithmetic needed &mdash;
                just close the trap.
              </p>
              <p className="text-muted text-sm leading-relaxed">
                Siege is the only capture that ignores numbers entirely. It rewards positional play
                and is especially effective against high-value pieces you can&rsquo;t match arithmetically.
              </p>
            </GuideSection>
          </div>
        </div>

        {/* --- Victory --- */}
        <div>
          <h2 className="font-serif text-xl text-secondary mb-1">Victory</h2>
          <div className="bg-warm rounded-lg border border-border-light p-4 space-y-3">
            <div>
              <h3 className="font-serif text-base text-secondary">Common Victories</h3>
              <ul className="text-muted text-sm leading-relaxed space-y-1 mt-1">
                <li><strong>Bodies:</strong> Capture 15 enemy pieces</li>
                <li><strong>Goods:</strong> Capture pieces totaling 200+ points</li>
                <li><strong>Quarrel:</strong> Capture 10 pieces <em>and</em> 150+ points</li>
              </ul>
            </div>
            <div>
              <h3 className="font-serif text-base text-secondary">Proper Victories</h3>
              <p className="text-muted text-sm leading-relaxed">
                The highest form of victory: arrange 3 or more of your pieces on the enemy&rsquo;s
                half of the board in an <strong>arithmetic</strong>, <strong>geometric</strong>, or{' '}
                <strong>harmonic</strong> progression. These &ldquo;proper victories&rdquo; reflect
                the game&rsquo;s Boethian roots &mdash; victory through mathematical harmony.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer links */}
      <div className="mt-12 pt-6 border-t border-border-light flex flex-wrap gap-4 text-sm">
        <Link href="/rithmomachia" className="text-accent-rust hover:underline">
          Play the game &rarr;
        </Link>
        <Link href="/blog/rithmomachia" className="text-accent-rust hover:underline">
          Full rules with primary sources &rarr;
        </Link>
      </div>
    </div>
  );
}
