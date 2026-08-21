/* eslint-disable react/no-unescaped-entities */
import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const HERO = 'https://images.sourcelibrary.org/artwork/art-khunrath-the-four-the-three-the-two-and-the-one.jpg';
const HERO_ALT = "Heinrich Khunrath's engraving 'The Four, the Three, the Two, and the One' (1595) — concentric rings of Latin, Greek, and Hebrew words circling a single figure.";

export const metadata: Metadata = {
  title: 'The Ngram Viewer: Chart a Word, Then Read the Page - Source Library',
  description:
    'A Google-Books-style word-frequency viewer over five centuries of alchemy, Hermetica, and early science — with the two things Google ngrams cannot do: one curve that follows a concept across Latin, German, and French sources at once, and a click-through from any point on the chart to the actual readable pages.',
  openGraph: {
    title: 'The Ngram Viewer: Chart a Word, Then Read the Page',
    description:
      'Follow mercury from Latin mercurius to German Quecksilber on one chart, watch the philosopher’s stone rise and fall, and click any peak to read the pages behind it.',
    images: [{ url: HERO, alt: HERO_ALT }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: HERO, alt: HERO_ALT }],
  },
  alternates: { canonical: '/blog/ngram-viewer' },
};

function ChartLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 border border-border-light bg-white/60 px-4 py-2 text-sm text-accent-rust hover:border-accent-rust/50 transition-colors font-body"
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l5-6 4 3 6-8M3 21h18" />
      </svg>
      {children}
    </Link>
  );
}

export default function NgramViewerPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Chart a Word, Then Read the Page"
          subtitle="A new ngram viewer over five centuries of alchemy, Hermetica, and early science — built to do the two things word-frequency charts have never done."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">19 July 2026 &middot; 7 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          When Google's Ngram Viewer appeared in 2010, it gave everyone a new kind of historical instrument: type a word,
          and watch it rise and fall across two centuries of print. It was mesmerizing, and it changed how a generation
          of researchers asked questions. But anyone who used it seriously ran into the same two walls. You cannot lay
          two languages on the same chart, so a concept that lived in Latin before it lived in English simply falls off
          the left edge of history. And the curve is a dead end — you can see <em>that</em> a word surged in the 1650s,
          but you cannot click the surge and read what people were actually writing.
        </p>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Source Library now has its own ngram viewer, at{' '}
          <Link href="/ngrams" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/ngrams</Link>.
          It is much smaller than Google's — 17,819 books and about 3.4 billion words, against Google's half a trillion —
          and it is built over a deliberately curated corpus: alchemy, Hermetica, Kabbalah, natural magic, and early
          modern science, with the surrounding literature those traditions argued with. Within that world, it does the
          two things the giant one can't.
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Start with the classic experiment</h2>
        <p className="text-secondary leading-relaxed mb-6 font-body">
          Paracelsus taught that all matter is composed of three principles — mercury, sulphur, and salt, the{' '}
          <em>tria prima</em>. If that doctrine really conquered European natural philosophy in the sixteenth and
          seventeenth centuries, the words themselves should show it. They do:
        </p>
        <div className="mb-8">
          <ChartLink href="/ngrams?q=mercury,sulphur,salt&corpus=en">
            mercury &middot; sulphur &middot; salt, 1450&ndash;1930
          </ChartLink>
        </div>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          That chart is drawn from the English corpus — which needs a word of explanation, because it is the quiet trick
          behind everything else here. Source Library translates its holdings into English, whatever language they were
          written in. So the English corpus is not "books published in English": it is Latin treatises, German tracts,
          French dialogues, and Greek fragments, all counted through one language. A single curve for{' '}
          <em>mercury</em> tracks the concept across every tradition we hold at once. Google's ngrams cannot do this,
          because nobody translated Google's corpus into one language first.
        </p>

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Follow a concept across languages</h2>
        <p className="text-secondary leading-relaxed mb-6 font-body">
          Sometimes you want the opposite: not one merged curve, but the original languages side by side. The viewer
          takes a <code>term:language</code> syntax — <code>mercurius:la</code> charts the Latin word in the Latin
          corpus, <code>quecksilber:de</code> the German word in the German corpus — and overlays them on whatever else
          you're charting:
        </p>
        <div className="mb-8">
          <ChartLink href="/ngrams?q=mercury,mercurius:la,quecksilber:de&corpus=en">
            mercury &middot; mercurius (Latin) &middot; Quecksilber (German)
          </ChartLink>
        </div>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          Now you can watch a concept migrate between languages: <em>mercurius</em> carrying the load through the Latin
          sixteenth century, the vernaculars taking over as alchemy moved out of the universities and into print for
          apothecaries and mine-owners. For common pairs the viewer suggests these equivalents itself — chart{' '}
          <em>mercury</em> and it offers the Latin, German, French, and Italian forms as one-click chips, from a small
          hand-curated lexicon of terms whose equivalence in early modern usage is actually unambiguous.
        </p>

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Click the curve, read the page</h2>
        <p className="text-secondary leading-relaxed mb-6 font-body">
          The second wall is the one that matters most. A frequency chart is a claim about thousands of pages you
          haven't read; if you can't reach those pages, the chart is an argument from authority. Here, every point on
          every curve is a link. Click the 1650s on this chart:
        </p>
        <div className="mb-8">
          <ChartLink href="/ngrams?q=philosopher%27s%20stone,elixir&corpus=en">
            philosopher's stone vs. elixir
          </ChartLink>
        </div>
        <p className="text-secondary leading-relaxed mb-6 font-body">
          — and you land in a search scoped to that term and that window of years, listing the actual passages, in books
          you can open to the actual page, facsimile beside translation. Two clicks from a trend line to a paragraph
          like this one, from the English printing of Sendivogius that helped carry Paracelsian doctrine into the
          language:
        </p>

        <figure className="my-8">
          <blockquote className="border-l-2 border-accent-rust/40 pl-5 italic text-secondary font-body leading-relaxed">
            For Mercury is the Spirit, Sulphur the Soule, and Salt the Body, but a Metall is the Soul betwixt the
            Spirit, and the Body (as Hermes saith) which Soule indeed is Sulphur; and unites these two contraries, the
            Body, and Spirit, and changeth them into one essence
          </blockquote>
          <figcaption className="text-sm text-muted mt-2 pl-5 not-italic">
            — Paracelsus, "Of the Nature of Things," printed with Sendivogius, <em>A New Light of Alchymie</em> (London,
            1650), p. 192.{' '}
            <Link href="/q/BekIYFS7EoKqXHwqdbE" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/q/BekIYFS7EoKqXHwqdbE</Link>
          </figcaption>
        </figure>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          That round trip — curve, to search, to page, to quotation with a stable citation link — is the point of the
          whole tool. The chart is not the evidence. The chart is a map of where the evidence is.
        </p>

        <hr className="border-border-light my-12" />

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">How to read these curves honestly</h2>
        <p className="text-secondary leading-relaxed mb-6 font-body">
          Every frequency chart is an argument, and this one has assumptions you should know before you trust a curve
          with a conclusion.
        </p>
        <ul className="list-disc pl-6 space-y-4 text-secondary font-body leading-relaxed mb-8">
          <li>
            <strong>The corpus is curated, not representative.</strong> These frequencies describe the Source Library
            collection — a library deliberately centered on alchemy, Hermetica, and early science — not print culture at
            large. A term's rise can mean the idea spread, or that we acquired more books that use it. Under every chart
            a coverage panel compares our per-year holdings against the Universal Short Title Catalogue's record of
            European print, so you can see what share of the printed record the corpus actually holds in the years that
            matter to your question.
          </li>
          <li>
            <strong>Thin years are thin evidence.</strong> The gray backdrop behind the curves shows how much text each
            year contributes; years with almost no text are dropped from the series entirely rather than plotted as
            false zeros or wild spikes. A dramatic peak standing on a few thousand words is an anecdote, not a trend.
          </li>
          <li>
            <strong>Years are edition years, not composition years.</strong> A 1650 reprint of a fifteenth-century text
            counts as 1650. This is the honest choice for a library of physical editions — it charts when words were{' '}
            <em>circulating in print</em> — but it means the curves measure publishing, not first thoughts.
          </li>
          <li>
            <strong>The English corpus counts a translator's choices.</strong> Our translations are AI-generated
            (reviewed and corrected over time, but machine-made at scale), so the English curve for a term partly
            reflects how the translator renders concepts, not only how authors used them. That is exactly why the
            original-language overlays exist: when a conclusion matters, check it against <em>mercurius</em> and{' '}
            <em>Quecksilber</em>, where the words are the authors' own. OCR of early print has errors too, and an
            unrecognized word is an uncounted word.
          </li>
          <li>
            <strong>Spelling is normalized before counting.</strong> Long ſ, ligatures, and — in Latin — the u/v and
            i/j pairs are folded together, so <em>vniuersum</em> and <em>universum</em> chart as one term. Genuinely
            distinct early modern spellings are not merged; if a word you expect seems undercounted, try its variants.
          </li>
        </ul>
        <p className="text-secondary leading-relaxed mb-8 font-body">
          The counting itself involves no AI at all — it is plain tallying over the corpus, which means a curve you see
          today is exactly reproducible tomorrow. Charts live in the URL, so any comparison you build can be shared as a
          link; a toggle switches from raw frequency to the share of books that mention a term at all, which is often
          the sturdier question; and the editorial apparatus our AI adds around page text (summaries, keywords, marginal
          descriptions) is stripped before anything is counted, for the same reason we never let it be quoted as source text:
          counting a summary's words would fabricate frequency data the way quoting one fabricates a citation.
        </p>

        <h2 className="font-serif text-3xl text-primary mb-6 mt-12">Go count something</h2>
        <p className="text-secondary leading-relaxed mb-6 font-body">
          The viewer is live at{' '}
          <Link href="/ngrams" className="text-accent-rust hover:text-accent-rust underline">sourcelibrary.org/ngrams</Link>,
          with example charts one click away. Chart the words your own question turns on — and when a curve surprises
          you, don't stop at the curve. Click it, and read what they wrote.
        </p>
      </article>
    </ContentPageLayout>
  );
}
