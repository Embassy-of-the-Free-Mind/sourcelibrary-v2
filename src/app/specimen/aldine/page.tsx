import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { aldineVariables, aldineStack, cardoStack } from '@/lib/fonts/aldine';

export const metadata: Metadata = {
  title: 'The Aldine Roman — a facsimile type from De Aetna (1496) - Source Library',
  description:
    'Francesco Griffo’s roman for Aldus Manutius, traced letter by letter from the 1496 De Aetna in the Source Library collection, shown beside the open-licence revival Cardo.',
  alternates: { canonical: '/specimen/aldine' },
};

const BOOK_ID = '6a06d1f39a48d51399960d08';
const PAGE_IMAGE = `https://images.sourcelibrary.org/pages/${BOOK_ID}/0020.jpg`;

// The passage on the page shown, as printed (u for v, long s, abbreviations kept).
const PASSAGE = [
  'BEMBVS PATER  Eſt ita, ut',
  'dicis: nam cum ab urbe propterea me,',
  'frequentiáq; hominum; tanq a flucti-',
  'bus, in hunc ſolitudinis portum recipi',
  'am; ut relaxem a curis, remittámq; pau',
  'liſper animũ; méq; ipſum reſtituã mihi,',
];

const LOWER = 'a b c d e f g h i l m n o p q r s t u x y ſ æ ę';
const ACCENTS = 'á é í ó ú à è ì ò ù ã ẽ ĩ õ ũ';
const UPPER = 'A B C D E F G H I K L M N O P Q R S T V X Y Z & ( )';
const FIGURES = '0 1 2 3 4 5 6 7 8 9';
const RECON = 'J U W';
const LIGS = 'ct ſt ſi ſſ ſſi fi ff Qu';

export default function AldineSpecimenPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Aldine roman"
          subtitle="A facsimile type traced from the 1496 De Aetna, beside the revival that descends from it."
          image={PAGE_IMAGE}
          imageAlt="A page of Pietro Bembo's De Aetna, printed by Aldus Manutius in Venice, 1496"
        />
      }
      bg="bg-cream"
    >
      <div className={`prose-content max-w-none ${aldineVariables}`}>
        <p className="text-xl text-secondary leading-relaxed mb-10">
          In February 1496 Aldus Manutius printed a short dialogue by the young Pietro Bembo about
          climbing Mount Etna. For it his punchcutter Francesco Griffo cut a new roman, lighter
          and more even than the Venetian romans before it. Almost every roman text face since,
          from Garamond to Times, descends from that alphabet. Source Library holds the Florentine
          copy; the type below was traced, letter by letter, from its pages.
        </p>

        {/* The facsimile */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-2">Aldine Aetna — the facsimile</h2>
        <p className="text-secondary mb-6 leading-relaxed">
          Each glyph is one real impression from the book, chosen as the most typical of its
          kind among some 70,000 printed letters on sixty pages of De Aetna and the Aldines of 1495–97 set in the same fount, then vectorised. Ink spread,
          worn corners and the slight unevenness of hand-set metal are kept on purpose. This is
          what the 1496 reader saw.
        </p>
        <div className="rounded-xl border border-border-light bg-white p-6 md:p-10 mb-8 overflow-x-auto">
          <div
            className="text-primary leading-[1.45]"
            style={{ fontFamily: aldineStack, fontSize: 'clamp(1.35rem, 2.6vw, 2rem)', fontFeatureSettings: '"liga" 1' }}
          >
            {PASSAGE.map((line) => (
              <div key={line} className="whitespace-nowrap">{line}</div>
            ))}
          </div>
          <p className="text-xs text-muted mt-6">
            <Link href={`/book/${BOOK_ID}?page=20`} className="text-accent-rust hover:underline">
              De Aetna, sig. A iii
            </Link>{' '}
            — the page in the header, set in the type traced from it.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {[
            ['Lowercase', LOWER],
            ['Capitals', UPPER],
            ['Ligatures', LIGS],
            ['Accents and abbreviation marks', ACCENTS],
            ['Figures (from the smaller roman, 1499)', FIGURES],
            ['Reconstructed — never cast in 1496', RECON],
          ].map(([label, text]) => (
            <div key={label} className="rounded-xl border border-border-light bg-white p-5">
              <div className="text-xs uppercase tracking-wider text-muted mb-3">{label}</div>
              <div
                className="text-primary leading-snug break-words"
                style={{ fontFamily: aldineStack, fontSize: '1.75rem', fontFeatureSettings: '"liga" 1' }}
              >
                {text}
              </div>
            </div>
          ))}
        </div>

        {/* Side by side */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-2">Facsimile and revival</h2>
        <p className="text-secondary mb-6 leading-relaxed">
          A <em>revival</em> is a designer&apos;s clean reinterpretation of a historical type; a{' '}
          <em>facsimile</em> reproduces the impressions themselves. Cardo, by David Perry, is an
          open-licence revival modelled on this same De Aetna roman, with complete Latin, Greek
          and Hebrew. The same sentence in both:
        </p>
        <div className="grid md:grid-cols-2 gap-4 mb-12">
          <div className="rounded-xl border border-border-light bg-white p-6">
            <div className="text-xs uppercase tracking-wider text-muted mb-3">Aldine Aetna (facsimile, 1496)</div>
            <p className="text-primary text-2xl leading-snug" style={{ fontFamily: aldineStack, fontFeatureSettings: '"liga" 1' }}>
              Eſt ita, ut dicis: nam cum ab urbe propterea me, frequentiáq; hominum; in hunc ſolitudinis portum recipiam.
            </p>
          </div>
          <div className="rounded-xl border border-border-light bg-white p-6">
            <div className="text-xs uppercase tracking-wider text-muted mb-3">Cardo (revival, 2004)</div>
            <p className="text-primary text-2xl leading-snug" style={{ fontFamily: cardoStack }}>
              Est ita, ut dicis: nam cum ab urbe propterea me, frequentiaque hominum; in hunc solitudinis portum recipiam.
            </p>
          </div>
        </div>

        {/* Notes */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-4">What the facsimile contains</h2>
        <p className="text-secondary mb-4 leading-relaxed">
          Only what the 1496 text uses. The lowercase is complete for Latin as Aldus set it
          (<span style={{ fontFamily: aldineStack }}>u</span> serves for v, long <span style={{ fontFamily: aldineStack }}>ſ</span> inside
          words), with the ligatures <span style={{ fontFamily: aldineStack, fontFeatureSettings: '"liga" 1' }}>ct ſt ſi ſſ fi ff</span>, æ and
          the ampersand, and ę. The acute, grave and tilde — the tilde is the printer&apos;s nasal
          abbreviation, <span style={{ fontFamily: aldineStack }}>animũ</span> for <em>animum</em> — are
          taken from real impressions and set over each vowel at the offset measured on the page, as
          the compositor did with separate accent sorts. Nineteen capitals, including a lone Q and the fused{' '}
          <span style={{ fontFamily: aldineStack, fontFeatureSettings: '"liga" 1' }}>Qu</span> sort Griffo
          cast for the common case. K comes from De Aetna itself (&ldquo;Kalendis&rdquo;); X, Y and Z from
          the Greek alphabet tables of Lascaris&apos; grammar, where Aldus set the Greek majuscules from
          the roman case. The figures are old-style arabic numerals from the index of Perotti&apos;s{' '}
          <Link href="/book/69b220f356715b0e32473bd0" className="text-accent-rust hover:underline">Cornucopiae</Link>{' '}
          (1499) &mdash; the same shop, set in its smaller roman and scaled to this body, since the 1496
          text itself counts only in roman numerals. J, U and W did not exist in 1490s roman type (I and V
          did their work), so those three are <em>reconstructed</em> and marked as such: W is VV, exactly
          as the compositors set it; U is the lowercase u raised to the cap line, as Monotype did for Bembo;
          J is the I with the hook of the long s turned to hang below the line. Nothing else in the font
          is invented.
          Letter spacing is measured from the page too: one em is the book&apos;s line pitch, and
          sidebearings are half the median gap between neighbouring sorts.
        </p>
        <p className="text-secondary mb-4 leading-relaxed">
          The pipeline (binarise, segment, cluster by shape, label, trace, assemble) lives in the
          repository under <code>scripts/fonts/aldine-aetna/</code> and can be re-run on other
          Aldine pages to extend the character set, or on any book in the library.
        </p>
        <ul className="text-secondary mb-12 leading-relaxed list-disc pl-6">
          <li>
            <a href="/fonts/aldine-aetna/AldineAetna-Regular.ttf" className="text-accent-rust hover:underline">AldineAetna-Regular.ttf</a>{' '}
            · <a href="/fonts/aldine-aetna/AldineAetna-Regular.woff2" className="text-accent-rust hover:underline">woff2</a>{' '}
            — public domain, <a href="/fonts/aldine-aetna/LICENSE.txt" className="text-accent-rust hover:underline">CC0</a>. Griffo cut these letters in 1496; we only traced them.
          </li>
          <li>
            Source:{' '}
            <Link href={`/book/${BOOK_ID}`} className="text-accent-rust hover:underline">
              Pietro Bembo, De Aetna dialogus (Venice: Aldus Manutius, 1496)
            </Link>
            , Biblioteca Nazionale Centrale di Firenze, via Internet Archive.
          </li>
          <li>
            More of the press:{' '}
            <Link href="/collections/aldine-press" className="text-accent-rust hover:underline">the Aldine Press collection</Link>.
          </li>
        </ul>
      </div>
    </ContentPageLayout>
  );
}
