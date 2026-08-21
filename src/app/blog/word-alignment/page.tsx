import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { LiveAlignmentDemo } from './LiveAlignmentDemo';

export const metadata: Metadata = {
  title: 'Reading Through the Translation - Research Notes - Source Library',
  description:
    'Click any English word to see the original that produced it. On-demand cross-lingual alignment powered by Gemini embeddings.',
  openGraph: {
    images: [{ url: 'https://images.sourcelibrary.org/archived/6953cc3677f38f6761be156e/383.jpg', alt: 'Fragment of Greek papyrus from Herculaneum, 1885' }],
    title: 'Reading Through the Translation',
    description:
      'Click any English word to see the original that produced it.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6953cc3677f38f6761be156e/383.jpg', alt: 'Fragment of Greek papyrus from Herculaneum, 1885' }],
  },
  alternates: {
    canonical: '/blog/word-alignment',
  },
};

export default function WordAlignmentPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader maxWidth="wide"
          title="Reading Through the Translation"
          subtitle="Click any English word to see the original that produced it"
          image="https://images.sourcelibrary.org/archived/6953cc3677f38f6761be156e/383.jpg"
          imageAlt="Fragment of Greek papyrus from Herculaneum, 1885"
        >
          <p className="text-stone-400 text-sm mt-4">17 April 2026</p>
        </ContentHeader>
      }
      bg="bg-cream"
      maxWidth="wide"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-12">
          Source Library has translated over 10,000 pages of Latin, Greek, Arabic, and Hebrew
          into English. The translations are useful, but they hide the original. Click any
          English word below, and the source word that produced it lights up on the other side.
          The alignment is computed on-demand by{' '}
          <a href="https://ai.google.dev/gemini-api/docs/embeddings" className="text-accent-gold-dark hover:underline">Gemini
          embeddings</a> &mdash; the same model maps words from any language into a shared
          vector space, so it works across scripts, centuries, and languages without
          pre-computation.
        </p>
      </article>

      {/* === Ficino: pleasure vs gladness === */}
      <article className="prose-content max-w-none">
        <h2 className="text-lg font-semibold text-primary mb-2">
          Two words for happiness
        </h2>
        <p className="text-secondary leading-relaxed mb-5">
          Ficino&rsquo;s <em>De Voluptate</em> (1457) argues that Plato distinguished between
          two kinds of positive feeling. Click &ldquo;gladness&rdquo; and &ldquo;joy&rdquo;
          in the English &mdash; they come from different Latin words.
          Click &ldquo;pleasure&rdquo; &mdash; it&rsquo;s a third.
        </p>
      </article>

      <div className="mb-14">
        <LiveAlignmentDemo
          sourceText="PLATO igitur, ut ab eorum principe initium faciam, cum animum in duas partes distribuisset, mente scilicet ac sensum, menti laeticiam & gaudium attribuit, sensibus voluptatem."
          translationText="Plato, therefore (to begin with him as the leader of these philosophers), when he had divided the soul into two parts — namely, the mind and the senses — attributed gladness and joy to the mind, pleasure to the senses."
          sourceLanguage="Latin"
          label="Marsilio Ficino, De Voluptate (1457)"
        />
      </div>

      {/* === Pymander: the creation vision === */}
      <article className="prose-content max-w-none">
        <h2 className="text-lg font-semibold text-primary mb-2">
          Light and shadow in the Hermetic creation
        </h2>
        <p className="text-secondary leading-relaxed mb-5">
          In the <em>Pymander</em>, Hermes Trismegistus describes a vision of the universe
          being created from light and darkness. Click &ldquo;light&rdquo; to
          find &ldquo;lumen,&rdquo; click &ldquo;shadow&rdquo; to find &ldquo;umbra.&rdquo;
          The Latin makes the cosmic polarity sharper than the English does.
        </p>
      </article>

      <div className="mb-14">
        <LiveAlignmentDemo
          sourceText="Cum haec dixisset, mutauit formam, & uniuersa subito reuelauit. Cernebam enim immensum quoddam spectaculum, omnia uidelicet in lumen conuersa, suaue nimium atque iucundum, quod intuentem me mirifice oblectabat. Paulo post umbra quaedam horrenda obliquè deorsum ferebatur."
          translationText="When he had said these things, he changed form, and suddenly revealed all things. For I saw a certain immense spectacle, namely everything converted into light, exceedingly sweet and delightful, which as I gazed upon it wonderfully pleased me. A little later a certain dreadful shadow was carried obliquely downward."
          sourceLanguage="Latin"
          label="Hermes Trismegistus, Pymander (Ficino, 1505)"
        />
      </div>

      {/* === Aratus: Greek script === */}
      <article className="prose-content max-w-none">
        <h2 className="text-lg font-semibold text-primary mb-2">
          Across alphabets
        </h2>
        <p className="text-secondary leading-relaxed mb-5">
          The same technique works across writing systems. Click &ldquo;Zeus&rdquo; in the
          English and &ldquo;Διὸς&rdquo; lights up in the Greek &mdash; the model knows they
          mean the same thing even though the scripts share no visual similarity. Click
          &ldquo;sea&rdquo; to find &ldquo;θάλασσα.&rdquo;
        </p>
      </article>

      <div className="mb-14">
        <LiveAlignmentDemo
          sourceText="Ek Διὸς ἀρχώμεσθα, τὸν οὐδέποτ' ἄνδρες ἐῶμεν ἀῤῥητον· μεσταὶ δὲ Διὸς πᾶσαι μὲν ἀγυιαί, πᾶσαι δ' ἀνθρώπων ἀγοραί, μεστὴ δὲ θάλασσα καὶ λιμένες· πάντη δὲ Διὸς κεχρήμεθα πάντες."
          translationText="From Zeus let us begin: him let no man leave unspoken. Full of Zeus are all the streets, all the marketplaces of men, full is the sea and the harbors. Everywhere we all make use of Zeus."
          sourceLanguage="Ancient Greek"
          label="Aratus of Soli, Phaenomena (~270 BCE)"
        />
      </div>

      <article className="prose-content max-w-none">
        <p className="text-secondary leading-relaxed mb-12">
          This works on any page in the library. The embeddings are computed the moment you
          click &mdash; no batch job, no pre-processing. Every English word becomes a window
          into the source text. Not for the scholars who can already read the original,
          but for everyone else.
        </p>
      </article>
    </ContentPageLayout>
  );
}
