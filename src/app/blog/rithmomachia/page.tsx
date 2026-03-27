import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';

export const metadata: Metadata = {
  title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras - Research Notes - Source Library',
  description: 'Five primary sources in five languages document Rithmomachia, the "Battle of Numbers" — a mathematical board game played across Europe for six centuries. Now translated for the first time.',
  openGraph: {
    title: 'Rithmomachia: The Forgotten Game That Taught Europe to Think Like Pythagoras',
    description: 'Five primary sources in five languages document Rithmomachia, the "Battle of Numbers" — a mathematical board game played across Europe for six centuries.',
    images: [
      {
        url: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg',
        width: 1200,
        height: 630,
      },
    ],
  },
  alternates: {
    canonical: '/blog/rithmomachia',
  },
};

export default function RithmomachiaPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Rithmomachia"
          subtitle="The Forgotten Game That Taught Europe to Think Like Pythagoras"
        >
          <p className="text-stone-400 text-sm mt-4">2 March 2026 &middot; 18 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">

        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Before chess conquered Europe, scholars played a different game. It was played on a double-length
          chessboard. Its pieces bore numbers instead of ranks. You captured opponents not through positional
          strategy but through arithmetic — addition, subtraction, multiplication, and the elegant proportions
          of Pythagorean number theory. You won by arranging captured pieces into mathematical harmonies.
          Its name was Rithmomachia, the &ldquo;Battle of Numbers,&rdquo; and for six centuries it was the
          game of the educated mind.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Source Library now holds the five major printed treatises on Rithmomachia, spanning 1496 to 1616,
          written in Latin, French, English, Italian, and German — all translated into English for the
          first time as a complete collection. Together they document one of the most remarkable intellectual
          games ever invented, and its slow disappearance from European culture.
        </p>

        {/* Hero image — Selenus game board engraving */}
        <figure className="my-10">
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/498.jpg"
            alt="Full-page copperplate engraving of a Rithmomachia game board with 24 numbered pieces arranged in starting position, from Selenus, Das Schach- oder König-Spiel, 1616"
            className="w-full max-w-2xl mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Rithmomachia game board with pieces in starting position. Copperplate engraving from Selenus, <em>Das Schach- oder König-Spiel</em>, 1616.{' '}
            <Link href="/book/the-game-of-chess-gustavus-selenus?page=498" className="text-accent-rust hover:text-accent-rust not-italic">Read &rarr;</Link>
          </figcaption>
        </figure>

        <hr className="border-border-light my-12" />

        {/* The Ancient Roots */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Ancient Roots
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Every Renaissance author who wrote about Rithmomachia attributed it to Pythagoras. The
          English treatise by Lever and Fulke (1563) opens with a dedicatory poem that states the
          case plainly:
        </p>

        <div className="border-l-4 border-accent-rust pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;Pythagoras, therefore, I say, to make redress in this: first found out this same game,
            in which no evil is.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/the-most-noble-auncient-and-learned-playe-called-the-fulke?page=6" className="text-accent-rust hover:text-accent-rust">
              Lever & Fulke, <em>The Philosophers Game</em>, 1563, p. 6
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Pythagoras almost certainly did not invent Rithmomachia. The game first appears in the historical
          record around 1030 CE, in the monastic schools of southern Germany, where a monk named Asilo of
          Würzburg devised it as a teaching tool. But the attribution is not mere flattery — the mathematics
          are genuinely Pythagorean. The game&rsquo;s pieces, captures, and victory conditions are all built
          from the theory of ratios and proportions laid out in Boethius&rsquo;s <em>De Institutione
          Arithmetica</em> (c. 500 CE), which itself transmitted Pythagorean number theory to the medieval West.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          So while Rithmomachia is medieval in origin, it is Pythagorean in substance. To play it is
          to inhabit the Pythagorean worldview: a universe where numbers are not abstractions but living
          forces, where mathematical ratios generate musical harmonies, and where understanding
          proportion is understanding the structure of reality itself.
        </p>

        <hr className="border-border-light my-12" />

        {/* The Board and Pieces */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Board and the Pieces
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The board is a double chessboard — 8 squares wide and 16 long, &ldquo;as if two chessboards
          were joined together,&rdquo; as Lever and Fulke describe it. Each side commands 24 pieces in
          three shapes: circles, triangles, and squares. Every piece bears a number.
        </p>

        <div className="grid md:grid-cols-2 gap-6 my-10">
          <figure>
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd369ff0f1d2c4517fbb/26.jpg"
              alt="Woodcut diagram of a Rithmomachia game board from Barozzi's 1572 Italian treatise, showing an 8x16 grid with numbered pieces in starting positions"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Game board, Barozzi (1572).{' '}
              <Link href="/book/il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi?page=26" className="text-accent-rust hover:text-accent-rust not-italic">Read &rarr;</Link>
            </figcaption>
          </figure>
          <figure>
            <img
              src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd509ff0f1d2c4518280/37.jpg"
              alt="Diagram of a Rithmomachia game board from Boissiere's 1554 French treatise, showing an 8x16 grid divided into two 8x8 squares"
              className="w-full rounded-lg shadow-md"
            />
            <figcaption className="text-center text-sm text-muted mt-3 italic">
              Game board, Boissiere (1554).{' '}
              <Link href="/book/le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere?page=37" className="text-accent-rust hover:text-accent-rust not-italic">Read &rarr;</Link>
            </figcaption>
          </figure>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The two sides are not symmetric. One side plays the even numbers, the other the odd — a
          fundamental Pythagorean distinction. Barozzi describes how the numbers on each piece are
          derived from the first four even or odd integers through multiplication:
        </p>

        <div className="border-l-4 border-accent-violet pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;Wishing then to determine the numbers that should be written upon the 8 white rounds,
            we shall first take the first four even numbers, one after the other, beginning from 2 —
            which shall be 2, 4, 6, and 8. Beneath the 3, we shall mark 9; beneath the 5, 25; beneath
            the 7, 49; and beneath the 9, 81. For from 3 multiplied by itself is born 9; from 5, 25;
            from 7, 49; and from 9, 81.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi?page=15" className="text-accent-rust hover:text-accent-rust">
              Barozzi, 1572, pp. 15&ndash;16
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The shapes determine how pieces move. Circles move one space diagonally, &ldquo;no differently than
          the soldiers of Mars&rdquo; (pawns in chess), as Selenus puts it. Triangles leap two spaces.
          Squares leap three. Each side also has a king — a pyramid of stacked pieces whose combined
          value represents the pinnacle of the army.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And here is a detail that reveals the game&rsquo;s spirit: the underside of every piece is
          painted in the opponent&rsquo;s color. When you capture a piece, it changes sides. Lever and
          Fulke explain: &ldquo;the bottom or lower part of every piece must be marked with its
          adversary&rsquo;s color, so that when it is captured, it may change its coat and serve the
          one to whom it is a prisoner.&rdquo;
        </p>

        <hr className="border-border-light my-12" />

        {/* Capture by Arithmetic */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          Capture by Arithmetic
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This is what makes Rithmomachia unique among board games: you don&rsquo;t capture by
          landing on an opponent&rsquo;s square. You capture through mathematical relationships
          between your pieces and theirs.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Barozzi lists the methods: &ldquo;In seven ways: counting, summing, subtracting,
          multiplying, dividing, and siege.&rdquo; Lever and Fulke give the clearest English account:
        </p>

        <div className="bg-warm rounded-xl p-6 border border-border-light my-10">
          <p className="text-sm font-medium text-stone-800 mb-4">Methods of capture</p>
          <div className="space-y-3 text-secondary font-body">
            <p><strong className="text-stone-800">Equality</strong> — A piece that can reach an enemy
            of the same value captures it.</p>
            <p><strong className="text-stone-800">Addition</strong> — Two of your pieces whose values
            sum to an enemy&rsquo;s value capture it. Barozzi gives the example: white triangle 9 plus
            white triangle 16 equals black circle 25.</p>
            <p><strong className="text-stone-800">Subtraction</strong> — Two of your pieces whose
            difference equals an enemy&rsquo;s value capture it.</p>
            <p><strong className="text-stone-800">Multiplication</strong> — A piece&rsquo;s value
            multiplied by the number of empty squares between it and an enemy equals the enemy&rsquo;s
            value.</p>
            <p><strong className="text-stone-800">Division</strong> — The reverse: the enemy&rsquo;s
            value divided by the distance equals your piece&rsquo;s value.</p>
            <p><strong className="text-stone-800">Siege</strong> — Surround a piece so that &ldquo;its
            lawful movement is blocked,&rdquo; and it falls when you place the fourth surrounding piece.</p>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Every capture requires mental arithmetic. You don&rsquo;t just see the board — you calculate it.
          A player scanning for captures is simultaneously running addition, subtraction, multiplication,
          and division in their head, checking whether any combination of their pieces relates arithmetically
          to any reachable opponent. This is not a game you can play by intuition. It is a game that
          trains the mathematical mind.
        </p>

        <figure className="my-10">
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd509ff0f1d2c4518280/39.jpg"
            alt="Diagram from Boissiere's 1554 treatise showing a Rithmomachia game board with pieces of various shapes including circles, triangles and squares bearing numbers"
            className="w-full max-w-xl mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Game board with pieces in starting position — circles, triangles, and squares bearing numerical values. Boissiere, 1554.{' '}
            <Link href="/book/le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere?page=39" className="text-accent-rust hover:text-accent-rust not-italic">Read &rarr;</Link>
          </figcaption>
        </figure>

        <hr className="border-border-light my-12" />

        {/* Victory Through Harmony */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          Victory Through Harmony
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Rithmomachia&rsquo;s victory conditions are its most extraordinary feature. You don&rsquo;t
          win by eliminating the opponent. You win by arranging your captured pieces on the
          opponent&rsquo;s side of the board in mathematical progressions — arithmetic, geometric, or
          harmonic.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Selenus&rsquo;s treatise gives the fullest account. There are three levels of victory, each
          more demanding than the last:
        </p>

        <div className="bg-warm rounded-xl p-6 border border-border-light my-10">
          <div className="space-y-4 text-secondary font-body">
            <div>
              <p className="font-medium text-stone-800">The Small Victory</p>
              <p>Arrange three captured pieces in a single proportion — arithmetic (e.g., 2, 4, 6),
              geometric (e.g., 2, 4, 8), or harmonic (e.g., 3, 4, 6).</p>
            </div>
            <div>
              <p className="font-medium text-stone-800">The Great Victory</p>
              <p>Arrange four pieces satisfying two different proportions simultaneously.</p>
            </div>
            <div>
              <p className="font-medium text-stone-800">The Greatest Victory</p>
              <p>Arrange four pieces satisfying all three proportions at once — arithmetic, geometric,
              and harmonic.</p>
            </div>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Selenus writes that the Greatest Victory yields &ldquo;a singular delight,&rdquo; because
          in those four numbers &ldquo;all the harmonies are contained.&rdquo; He connects the
          proportions explicitly to musical intervals: the ratio 2:1 produces the octave (diapason),
          2:3 produces the fifth (diapente), 3:4 the fourth (diatessaron). The winning arrangement
          is, literally, a chord.
        </p>

        <div className="border-l-4 border-accent-gold pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;Just as in the Great Victory, there are three simple ones — namely those of
            Arithmetic, Geometry, and Music — [representing] the Quadrivium, the mathematical
            sciences of the Middle Ages.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/the-game-of-chess-gustavus-selenus?page=536" className="text-accent-rust hover:text-accent-rust">
              Selenus, <em>Das Schach- oder König-Spiel</em>, 1616, p. 536
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This is a game where you win by creating beauty. Not by destroying the opponent, but by
          demonstrating mastery of the mathematical harmonies that — in the Pythagorean worldview —
          govern the cosmos.
        </p>

        <hr className="border-border-light my-12" />

        {/* Five Languages, One Game */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          Five Languages, One Game
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The five treatises in our collection span 120 years and five languages. Each was written for
          a different national audience, and each reveals something different about the game&rsquo;s
          meaning in Renaissance culture.
        </p>

        {/* Jordanus/Lefevre */}
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
          <div className="md:flex">
            <div className="md:w-48 shrink-0">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcdd19ff0f1d2c45182ec/1.jpg"
                alt="Title page of Arithmetica decem libris demonstrata, printed in Paris, 1496"
                className="w-full h-48 md:h-full object-cover"
              />
            </div>
            <div className="p-5 md:p-6">
              <Link href="/book/arithmetica-decem-libris-demonstrata-with-rithmimachie-ludus-stapulensis" className="text-accent-rust hover:text-accent-rust underline font-medium">
                Jordanus de Nemore &amp; Jacques Lefèvre d&rsquo;Étaples, <em>Arithmetica decem libris demonstrata (with Rithmimachie ludus)</em>
              </Link>
              <p className="text-sm text-muted mt-1 mb-3">Paris, 1496 &middot; Latin &middot; 152 pages</p>
              <p className="text-secondary text-sm leading-relaxed font-body">
                The earliest printed source. Jordanus&rsquo;s 13th-century arithmetic treatise, edited by the great
                humanist Lefèvre d&rsquo;Étaples, with a Rithmomachia appendix presented as a Pythagorean dialogue.
                Students learn the game by questioning a master, in the tradition of philosophical pedagogy.
                &ldquo;Before we encounter Pythagoras among the hundreds of his followers, we wish to be somewhat
                prepared in the basics.&rdquo;
              </p>
            </div>
          </div>
        </div>

        {/* Boissiere */}
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
          <div className="md:flex">
            <div className="md:w-48 shrink-0">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd509ff0f1d2c4518280/10.jpg"
                alt="Title page of Le tres excellent et ancien Jeu Pythagorique by Claude de Boissiere, 1554"
                className="w-full h-48 md:h-full object-cover"
              />
            </div>
            <div className="p-5 md:p-6">
              <Link href="/book/le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere" className="text-accent-rust hover:text-accent-rust underline font-medium">
                Claude de Boissiere, <em>Le tres excellent et ancien Jeu Pythagorique, dit Rithmomachie</em>
              </Link>
              <p className="text-sm text-muted mt-1 mb-3">Paris, 1554 &middot; French &middot; 106 pages</p>
              <p className="text-secondary text-sm leading-relaxed font-body">
                The French treatise is the most diagram-rich, with 10 board diagrams and mathematical tables.
                Boissiere frames the game as a recovery of ancient wisdom: &ldquo;Many men of great learning,
                seeking solace for spirits burdened by excessive labors, in times past sought and invented many fine
                recreations and games — which today, through the negligence of some and the injury of time, have perished.&rdquo;
              </p>
            </div>
          </div>
        </div>

        {/* Lever & Fulke */}
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
          <div className="md:flex">
            <div className="md:w-48 shrink-0">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd429ff0f1d2c4517fff/3.jpg"
                alt="Title page of The Most Noble, Auncient, and Learned Playe by Lever and Fulke, 1563"
                className="w-full h-48 md:h-full object-cover"
              />
            </div>
            <div className="p-5 md:p-6">
              <Link href="/book/the-most-noble-auncient-and-learned-playe-called-the-fulke" className="text-accent-rust hover:text-accent-rust underline font-medium">
                Ralph Lever &amp; William Fulke, <em>The Most Noble, Auncient, and Learned Playe, Called the Philosophers Game</em>
              </Link>
              <p className="text-sm text-muted mt-1 mb-3">London, 1563 &middot; English &middot; 97 pages</p>
              <p className="text-secondary text-sm leading-relaxed font-body">
                The only English treatise, written as an explicit alternative to dice and card games. Lever
                appeals to moral reformers: &ldquo;This causes no contention, nor any debate at all; by this,
                no hatred, wrath, nor guile arises in any way.&rdquo; Fulke, a mathematician, supplies the
                technical details. The result is the most accessible of all five treatises — a practical
                how-to guide.
              </p>
            </div>
          </div>
        </div>

        {/* Barozzi */}
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
          <div className="md:flex">
            <div className="md:w-48 shrink-0">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd369ff0f1d2c4517fbb/5.jpg"
                alt="Title page of Il nobilissimo et antiquissimo giuoco Pythagoreo by Francesco Barozzi, 1572"
                className="w-full h-48 md:h-full object-cover"
              />
            </div>
            <div className="p-5 md:p-6">
              <Link href="/book/il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi" className="text-accent-rust hover:text-accent-rust underline font-medium">
                Francesco Barozzi, <em>Il nobilissimo et antiquissimo giuoco Pythagoreo nominato Rythmomachia</em>
              </Link>
              <p className="text-sm text-muted mt-1 mb-3">Venice, 1572 &middot; Italian &middot; 66 pages</p>
              <p className="text-secondary text-sm leading-relaxed font-body">
                Barozzi was a Venetian mathematician with a taste for Pythagorean mysticism — he was later
                tried by the Inquisition for magical practices. His treatise is compact, precise, and features
                the clearest explanation of how piece values are derived from Pythagorean number sequences.
                His preface laments that the &ldquo;ancient philosophers discovered many most beautiful games&rdquo;
                now &ldquo;buried in perpetual oblivion.&rdquo;
              </p>
            </div>
          </div>
        </div>

        {/* Selenus */}
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-6">
          <div className="md:flex">
            <div className="md:w-48 shrink-0">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/248.jpg"
                alt="Copperplate engraving of two aristocratic men in late 16th century dress from Selenus's chess treatise, 1616"
                className="w-full h-48 md:h-full object-cover"
              />
            </div>
            <div className="p-5 md:p-6">
              <Link href="/book/the-game-of-chess-gustavus-selenus" className="text-accent-rust hover:text-accent-rust underline font-medium">
                Gustavus Selenus, <em>Das Schach- oder König-Spiel</em>
              </Link>
              <p className="text-sm text-muted mt-1 mb-3">Leipzig, 1616 &middot; German &middot; 540 pages</p>
              <p className="text-secondary text-sm leading-relaxed font-body">
                The grandest of the five. &ldquo;Gustavus Selenus&rdquo; was a pseudonym for Duke August the Younger
                of Brunswick-Lüneburg, who later founded the famous Wolfenbüttel library — one of the largest in
                Europe. His massive chess treatise includes Rithmomachia as an appendix (from page 495), treating
                it as chess&rsquo;s scholarly cousin. The copperplate engravings are the finest visual record of
                the game, and his account of the victory conditions is the most complete.
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-12">
          {[
            { number: '961', label: 'Pages translated' },
            { number: '5', label: 'Languages represented' },
            { number: '120', label: 'Years of publication (1496–1616)' },
            { number: '600+', label: 'Years the game was played' },
          ].map((stat) => (
            <div key={stat.label} className="text-center py-5 px-3 bg-warm rounded-lg border border-border-light">
              <div className="font-serif text-3xl md:text-4xl text-accent-rust mb-1">{stat.number}</div>
              <div className="text-xs text-muted leading-tight">{stat.label}</div>
            </div>
          ))}
        </div>

        <hr className="border-border-light my-12" />

        {/* A Game for Philosophers */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          A Game for Philosophers
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          What is most striking in reading these five treatises side by side is how consistently the
          authors defend the game&rsquo;s moral and intellectual value. Rithmomachia was not just a
          pastime — it was a pedagogical tool, a form of mental discipline, and a demonstration of
          Pythagorean principles.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Lever and Fulke make the case most forcefully:
        </p>

        <div className="border-l-4 border-accent-rust pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;I would rather teach men how to play in such a way that both integrity may be
            preserved, their wits exercised, they themselves refreshed, and some profit also attained,
            rather than to see them, for lack of exercise, either pass the time in idleness or else
            take pleasure in things fruitless and unseemly.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/the-most-noble-auncient-and-learned-playe-called-the-fulke?page=12" className="text-accent-rust hover:text-accent-rust">
              Lever &amp; Fulke, 1563, p. 12
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The game&rsquo;s appeal was always tied to its Pythagorean credentials: &ldquo;Its invention
          is ascribed to Pythagoras; it bears the name of philosophers; prudent men practice it, and
          godly men praise it.&rdquo; Thomas More had recommended it in <em>Utopia</em> (1516) as a
          wholesome alternative to dice. The game occupied a unique cultural niche — respectable
          enough for clerics, intellectually rigorous enough for mathematicians, and entertaining
          enough to survive in print.
        </p>

        {/* Perspective view */}
        <figure className="my-10">
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd499ff0f1d2c4518062/499.jpg"
            alt="Perspective engraving of a Rithmomachia board from Selenus 1616, showing an 8x12 checkered grid with rectangular piece formations"
            className="w-full max-w-xl mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Perspective view of a Rithmomachia board. Selenus, 1616.{' '}
            <Link href="/book/the-game-of-chess-gustavus-selenus?page=499" className="text-accent-rust hover:text-accent-rust not-italic">Read &rarr;</Link>
          </figcaption>
        </figure>

        <hr className="border-border-light my-12" />

        {/* Even vs Odd */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          Even Against Odd: The Pythagorean Cosmos on a Board
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The game&rsquo;s deepest structure reflects Pythagorean cosmology. The two sides are not
          interchangeable armies — they represent the fundamental duality of the universe. Even numbers
          represent the sensible, material world. Odd numbers represent the intelligible, formal world.
          The Jordanus treatise makes this explicit:
        </p>

        <div className="border-l-4 border-accent-violet pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;Let the side of the Even numbers be blackish, as the Evens belong to the sensible,
            worldly realm.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/arithmetica-decem-libris-demonstrata-with-rithmimachie-ludus-stapulensis?page=146" className="text-accent-rust hover:text-accent-rust">
              Jordanus / Lefèvre d&rsquo;Étaples, 1496, p. 146
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Boissiere adds a characteristically elegant observation about the interdependence
          of the two sides: &ldquo;Here you may consider this most noble alliance: how the
          parts of even numbers always proceed by progression from the odd number; conversely,
          the parts of the odd number have their progression according to the even number.&rdquo;
          Even and odd are not merely opponents — they are complementary aspects of mathematical
          reality, locked in a generative relationship.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This gives the game a philosophical dimension that chess entirely lacks. In chess, the two
          sides are identical except for who moves first. In Rithmomachia, the two sides embody a
          metaphysical distinction. Playing the game means inhabiting one half of the Pythagorean
          cosmos and learning to understand the other through combat.
        </p>

        <hr className="border-border-light my-12" />

        {/* Secrets Hidden in the Rules */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Secrets Hidden in the Rules
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Reading all five treatises side by side reveals details that no single source makes obvious.
          The game is stranger, deeper, and more tactically rich than its basic rules suggest.
        </p>

        <h3 className="font-serif text-xl text-secondary mt-10 mb-4">
          Winning Is Literally Playing a Chord
        </h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The &ldquo;Greatest Victory&rdquo; isn&rsquo;t just an abstract mathematical exercise.
          Selenus walks through how each winning set of four numbers encodes specific musical intervals.
          Take the simplest example: 2, 3, 4, 6. Within those four numbers you find:
        </p>

        <div className="bg-warm rounded-xl p-6 border border-border-light my-10">
          <div className="space-y-2 text-secondary font-body text-sm">
            <p><strong className="text-stone-800">3:2</strong> &mdash; the Fifth (<em>Diapente</em>)</p>
            <p><strong className="text-stone-800">4:3</strong> &mdash; the Fourth (<em>Diatessaron</em>)</p>
            <p><strong className="text-stone-800">4:2 = 2:1</strong> &mdash; the Octave (<em>Diapason</em>)</p>
            <p><strong className="text-stone-800">6:2 = 3:1</strong> &mdash; the Twelfth (<em>Diapason + Diapente</em>)</p>
            <p><strong className="text-stone-800">4:1</strong> &mdash; the Fifteenth, or Double Octave (<em>Disdiapason</em>)</p>
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Buxerius, quoted by Selenus, confirms the physical reality of this connection:
        </p>

        <div className="border-l-4 border-accent-gold pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;These ratios, if examined by weight — as in metals — or if tested
            by measure — as in strings — always provide and exhibit Musical Harmony.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/the-game-of-chess-gustavus-selenus?page=526" className="text-accent-rust hover:text-accent-rust">
              Buxerius, via Selenus, 1616, p. 484
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          You don&rsquo;t just win Rithmomachia by arranging numbers. You play a chord on the
          board &mdash; a harmony you could literally reproduce on a monochord or a set of
          tuned metal bars. The game&rsquo;s ultimate victory is an act of musical composition.
        </p>

        <h3 className="font-serif text-xl text-secondary mt-10 mb-4">
          Two Pieces That Cannot Be Captured by Arithmetic
        </h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Barozzi reveals a fact buried in the mathematics: two specific pieces &mdash; the white
          square 153 and the black pyramid 190 &mdash; cannot be captured by any arithmetic method.
          No combination of opposing pieces can sum, subtract, multiply, or divide to reach
          these values.
        </p>

        <div className="border-l-4 border-accent-rust pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;There are two pieces in this game that cannot be captured except by siege
            alone: the 190 black pyramid and the 153 white square.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi?page=37" className="text-accent-rust hover:text-accent-rust">
              Barozzi, 1572, p. 37
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This makes siege &mdash; surrounding a piece on all four sides &mdash; strategically
          essential. The strongest pieces on the board can only fall to positional play, not
          calculation. It also means these two pieces are the ultimate anchors: they can roam
          the board knowing they are immune to every form of arithmetic attack.
        </p>

        <h3 className="font-serif text-xl text-secondary mt-10 mb-4">
          The Pyramid&rsquo;s Chess Knight Escape
        </h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Rithmomachia is emphatically not chess. But there is exactly one moment where chess
          intrudes. Both Barozzi and Selenus describe a unique privilege of the pyramid: when
          besieged &mdash; surrounded on all four sides &mdash; the pyramid can escape using a
          chess knight&rsquo;s leap.
        </p>

        <div className="border-l-4 border-accent-violet pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;When the pyramid is besieged, it can free itself by making the knight&rsquo;s
            jump of chess &hellip; All other pieces do not enjoy this freedom.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/the-game-of-chess-gustavus-selenus?page=520" className="text-accent-rust hover:text-accent-rust">
              Selenus, 1616, p. 478
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This is the only chess move in the entire game. It applies only to the pyramid, and only
          when besieged. It cannot be used to capture &mdash; only to escape. The distinction
          matters: it means a besieging player must not only surround the pyramid, but also control
          all knight-jump escape squares, making siege of the pyramid extraordinarily difficult.
        </p>

        <h3 className="font-serif text-xl text-secondary mt-10 mb-4">
          Victory Must Be Proclaimed
        </h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Barozzi&rsquo;s seven rules for achieving victory include a remarkable protocol.
          When you place the second-to-last piece of your victory formation, you must
          announce your intention &mdash; giving your opponent a chance to disrupt it. Once
          proclaimed, the pieces in your formation become immune to capture.
        </p>

        <div className="border-l-4 border-accent-rust pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;When you play the second-to-last piece for the final victory, it is necessary to
            proclaim it, to warn the enemy to remedy it if he can &mdash; so that afterward, when
            he can no longer remedy it, you may honorably move the last piece that completes the
            final victory.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi?page=52" className="text-accent-rust hover:text-accent-rust">
              Barozzi, 1572, p. 52
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The victory is not a surprise attack. It is a demonstration &mdash; a public proof
          that you have achieved mathematical harmony despite your opponent&rsquo;s best
          efforts to prevent it. This is the game&rsquo;s most chivalric rule: you win
          not by stealth, but by openly declaring your mastery and daring your opponent to
          stop you.
        </p>

        <h3 className="font-serif text-xl text-secondary mt-10 mb-4">
          The Polybius Connection: Pieces as an Army
        </h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Selenus quotes Buxerius comparing the starting formation directly to the military
          treatise of Polybius: &ldquo;The rear of the army should be more open &hellip; so that
          if the front soldiers are weak, they can retreat to the rear, from which the ability
          to fight again is granted. And the light cavalry on the wings resembles the arrangement
          of this game.&rdquo;
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The circles (low-value, short-range) form the front rank &mdash; infantry. The
          triangles are the mobile middle ranks. The squares (high-value, long-range) hold
          the back &mdash; heavy reserves. The pyramid is the king, protected at the center.
          This isn&rsquo;t a metaphor invented by modern commentators; the original authors
          explicitly thought of the game in military terms.
        </p>

        <h3 className="font-serif text-xl text-secondary mt-10 mb-4">
          Three Different Games in One Book
        </h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Lever and Fulke describe not one but three complete rulesets, which they call
          &ldquo;kinds of play.&rdquo; In the first kind (the standard rules), circles move
          diagonally and triangles and squares move orthogonally. In the third kind,
          attributed to the Chaldean tradition, <em>no piece moves diagonally at all</em> &mdash;
          Buxerius writes that they move &ldquo;straight, not through corners, like the mad
          chess bishops.&rdquo; The second kind introduces a different capture system where
          multiplication and division use the empty squares between pieces as the operand.
          Each kind produces a fundamentally different tactical experience from the same board
          and pieces.
        </p>

        <h3 className="font-serif text-xl text-secondary mt-10 mb-4">
          Lever&rsquo;s Honest Admission
        </h3>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          After sixty-five pages of painstakingly detailed rules, tables, and mathematical
          derivations, Lever and Fulke close their treatise with a confession that no strategy
          guide can substitute for experience:
        </p>

        <div className="border-l-4 border-accent-gold pl-6 my-10">
          <p className="text-lg text-secondary italic font-body leading-relaxed">
            &ldquo;And thus is the first kind of playing at an end. And this is sufficient to
            teach you to play, but if you would learn to play cunningly, you must use to play
            often &mdash; so shall you learn better than by any precepts or rules.&rdquo;
          </p>
          <p className="text-sm text-muted mt-2">
            <Link href="/book/the-most-noble-auncient-and-learned-playe-called-the-fulke?page=65" className="text-accent-rust hover:text-accent-rust">
              Lever &amp; Fulke, 1563, p. 65
            </Link>
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Even in 1563, the game was too complex for written strategy. Five hundred years
          later, it still is. The only way to learn Rithmomachia is to play it.
        </p>

        <hr className="border-border-light my-12" />

        {/* Why It Died */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why It Disappeared
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          After Selenus&rsquo;s treatise in 1616, no new Rithmomachia book was printed. By the
          mid-17th century, the game had vanished from European culture almost completely. Why?
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The simplest answer is that chess won. Chess is adversarial, fast, and infinitely deep
          in its strategic complexity. It requires no mathematical knowledge to learn. Rithmomachia,
          by contrast, demands that both players share a mathematical education — you cannot
          play it without understanding ratios and proportions.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          But there is a deeper reason. Rithmomachia is a game that only makes sense within the
          Pythagorean worldview — a world where number is the essence of reality, where mathematical
          ratios produce musical harmonies, and where understanding proportion is the highest
          intellectual achievement. As the Scientific Revolution replaced Pythagorean numerology
          with empirical measurement, the philosophical framework that gave Rithmomachia its meaning
          dissolved. The game didn&rsquo;t just lose to chess. It lost its world.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Selenus seems to have sensed this. Writing in 1616, he laments that the game &ldquo;until
          our own times, has lain so shamefully in the Shadows.&rdquo; He was already writing an elegy.
        </p>

        {/* Boissiere mathematical proportions diagram */}
        <figure className="my-10">
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/699fcd509ff0f1d2c4518280/14.jpg"
            alt="Mathematical diagram from Boissiere's 1554 treatise showing a grid of numbers used in Rithmomachia piece values"
            className="w-full max-w-xl mx-auto rounded-lg shadow-md"
          />
          <figcaption className="text-center text-sm text-muted mt-3 italic">
            Number table for deriving piece values. Boissiere, 1554.{' '}
            <Link href="/book/le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere?page=14" className="text-accent-rust hover:text-accent-rust not-italic">Read &rarr;</Link>
          </figcaption>
        </figure>

        <hr className="border-border-light my-12" />

        {/* Read These Books */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          Read These Books
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          These are exactly the kind of texts Source Library exists for. They were written for
          educated readers, printed in small runs, scattered across European libraries, and never
          translated into a common modern language. Until now, reading the complete Rithmomachia
          corpus required Latin, French, Italian, German, and Early Modern English. Now it requires
          one click.
        </p>

        <div className="bg-warm rounded-xl p-6 md:p-8 border border-border-light mb-8">
          <p className="font-serif text-lg text-primary mb-4">The complete Rithmomachia collection</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              {
                href: '/book/arithmetica-decem-libris-demonstrata-with-rithmimachie-ludus-stapulensis',
                title: 'Jordanus & Lefèvre (1496)',
                sub: 'Latin \u2022 152 pages',
              },
              {
                href: '/book/le-tres-excellent-et-ancien-jeu-pythagorique-dit-boissiere',
                title: 'Boissiere (1554)',
                sub: 'French \u2022 106 pages',
              },
              {
                href: '/book/the-most-noble-auncient-and-learned-playe-called-the-fulke',
                title: 'Lever & Fulke (1563)',
                sub: 'English \u2022 97 pages',
              },
              {
                href: '/book/il-nobilissimo-et-antiquissimo-giuoco-pythagoreo-nominato-barozzi',
                title: 'Barozzi (1572)',
                sub: 'Italian \u2022 66 pages',
              },
              {
                href: '/book/the-game-of-chess-gustavus-selenus',
                title: 'Selenus (1616)',
                sub: 'German \u2022 540 pages',
              },
              {
                href: '/book/de-institutione-arithmetica-libri-ii-de-institutione-musica-friedlein',
                title: 'Boethius, De Institutione Arithmetica',
                sub: 'The mathematical foundation',
              },
            ].map((book) => (
              <Link
                key={book.href}
                href={book.href}
                className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors group"
              >
                <p className="font-medium text-sm text-stone-800 group-hover:text-accent-rust transition-colors">
                  {book.title}
                </p>
                <p className="text-xs text-muted mt-1">{book.sub}</p>
              </Link>
            ))}
          </div>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          If you want to start with one book, choose Lever and Fulke — it&rsquo;s in English, the
          most practically oriented, and reads like a game manual. If you want the richest
          intellectual experience, read Selenus&rsquo;s account of the victory conditions alongside
          Barozzi&rsquo;s derivation of the piece values. And if you want to understand the
          philosophical tradition that made this game possible, start with Boethius.
        </p>

        <hr className="border-border-light my-12" />

        {/* Play the Game */}
        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">
          Play the Game
        </h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          We&rsquo;ve built a playable version of Rithmomachia, synthesized from all five treatises.
          Challenge an AI opponent at three difficulty levels, or watch a demonstration game with
          move-by-move commentary drawn from the primary sources. Every rule links back to the
          original page where it appears.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 my-8">
          <Link
            href="/rithmomachia"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-accent-rust text-white rounded-lg font-medium hover:bg-accent-rust/90 transition-colors"
          >
            Play Rithmomachia
          </Link>
          <Link
            href="/rithmomachia?demo=true"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 border border-border-light rounded-lg font-medium hover:bg-warm transition-colors"
          >
            Watch AI vs AI Demo
          </Link>
        </div>

        {/* Footer */}
        <div className="border-t border-border-light pt-8 mt-16">
          <p className="text-secondary text-sm leading-relaxed font-body">
            Source Library is a digital library of rare philosophical, scientific, and esoteric texts,
            translated from their original languages using AI and available to read for free.
            Questions or corrections?{' '}
            <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:text-accent-rust underline">
              derek@sourcelibrary.org
            </a>.
          </p>
        </div>
      </article>

      <BlogComments slug="rithmomachia" />
    </ContentPageLayout>
  );
}
