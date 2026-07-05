import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getSiteStats } from '@/lib/site-stats';

export const metadata: Metadata = {
  title: 'About - Source Library',
  description: 'Source Library continues the mission of Cosimo de\' Medici and Marsilio Ficino, making rare Hermetic and Renaissance texts freely available to all.',
  alternates: {
    canonical: '/about',
  },
};

export default async function AboutPage() {
  const stats = await getSiteStats();
  const fmt = (n: number) => n.toLocaleString('en-US');

  const headlineStats: { value: string; label: string; href?: string }[] = [
    { value: fmt(stats.totalBooks), label: 'books digitized', href: '/search' },
    // stats.languageCount is now an honest distinct-language count: compound
    // labels are split into atomic languages and variants/junk are dropped
    // (scripts/lib/language-count.mjs). ~105 as of 2026-06-26, so 100+ is a
    // defensible floor.
    { value: '100+', label: 'languages' },
    { value: fmt(stats.translatedToEnglish), label: 'translated to English', href: '/search?has_translation=true' },
    { value: fmt(stats.firstTranslationCount), label: 'first-ever English translations', href: '/search?first_translation=true' },
    { value: fmt(stats.illustrationCount), label: 'illustrations cataloged', href: '/gallery' },
  ];

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Source Library transforms 2500+ years of wisdom texts into a living archive, freely available to all."
          image="https://images.sourcelibrary.org/artwork/art-anima-mundi-the-world-soul.jpg"
          imageAlt="Robert Fludd's Anima Mundi — the World Soul binding the cosmos, from Utriusque Cosmi (1617)"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        {/* The big idea */}
        <p className="text-2xl md:text-3xl text-primary leading-snug mb-8 font-serif">
          The last time the world translated its ancient wisdom, it set off the Renaissance. We think we can do it again &mdash; this time for the age of AI.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-6">
          Source Library is a digital library of historical primary sources &mdash; the foundational works of philosophy, science, religion, and mysticism from cultures across the world, in more than 50 languages. It spans the Sanskrit and Tibetan canons, the Chinese classics, the sciences of the Arabic and Hebrew worlds, the Hermetic and Neoplatonist currents of the Renaissance, and far beyond. We digitize rare books and manuscripts, translate them with AI alongside the original scanned page, and make them free to read, quote, and cite.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-12">
          Based at the <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> in Amsterdam &mdash; home to the Bibliotheca Philosophica Hermetica, a rare-book library inscribed on UNESCO&apos;s Memory of the World register &mdash; we work to preserve this heritage while opening it to new research, new readers, and a new renaissance in the study of philosophy, mysticism, and free thought.
        </p>

        {/* Stats band */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border-light rounded-xl overflow-hidden border border-border-light mb-16">
          {headlineStats.map((s) => {
            const inner = (
              <div className="bg-cream h-full p-5 text-center flex flex-col justify-center transition-colors group-hover:bg-white">
                <div className="text-2xl md:text-3xl font-semibold text-primary tabular-nums">{s.value}</div>
                <div className="text-xs md:text-sm text-muted mt-1 leading-tight">{s.label}</div>
              </div>
            );
            return s.href ? (
              <Link key={s.label} href={s.href} className="group block">
                {inner}
              </Link>
            ) : (
              <div key={s.label} className="group">{inner}</div>
            );
          })}
        </div>

        {/* Why it matters */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Why It Matters
        </h2>

        <p className="text-secondary mb-6 leading-relaxed">
          The Renaissance itself was written largely in Latin. As the UCLA Renaissance scholar Debora Shuger has observed, <a href="https://newsroom.ucla.edu/stories/learning-the-little-known-language-229883" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">&ldquo;90 percent of the Latin texts from the Renaissance have never been available in translation.&rdquo;</a> The rest is legible only to specialists. And beyond Latin lie thousands upon thousands of texts in Chinese, Sanskrit, Arabic, Hebrew, and Egyptian &mdash; much of it never digitized, let alone translated.
        </p>

        <p className="text-secondary mb-12 leading-relaxed">
          And this is about more than what AI was trained on. Give a capable model real access to primary sources at scale &mdash; the actual texts, every line checkable against the original scan &mdash; and it becomes a serious instrument of research and synthesis. Ask a question the whole world has asked &mdash; <em>what is mind?</em> &mdash; and it can set <a href="/q/BhIfljO2ApigrcHcTeD" className="text-accent-rust hover:underline">Plato&apos;s Greek</a> beside <a href="/q/BgRsFohtofMtBqdNmop" className="text-accent-rust hover:underline">Śaṅkara&apos;s Sanskrit</a>, a Tibetan master&apos;s <a href="/q/BijCMw143jlgk5jBxGl" className="text-accent-rust hover:underline">pointing-out instructions</a>, and <a href="/q/BilNwaKFiK2xSzX6BW5" className="text-accent-rust hover:underline">Xunzi&apos;s Chinese</a> &mdash; quoting each and linking to the page it sits on. Source Library is built for exactly that: a library both people and AI can actually read and cite, open through a public API and MCP.
        </p>

        {/* A glimpse — show, don't tell */}
        <figure className="mb-16">
          <Link
            href="/book/atalanta-fleeing-new-chemical-emblems-of-the-secrets-of-maier/page/69520c46ab34727b1f044154"
            className="block group overflow-hidden rounded-xl border border-border-light shadow-sm"
          >
            <img
              src="https://images.sourcelibrary.org/pages/69520c46ab34727b1f044141/0019.jpg"
              alt="An alchemical emblem from Michael Maier's Atalanta Fugiens (1618)"
              className="w-full h-auto object-contain bg-white transition-transform duration-500 group-hover:scale-[1.02]"
            />
          </Link>
          <figcaption className="text-sm text-muted mt-3 text-center">
            One of millions of pages now readable and quotable &mdash; an emblem from Michael Maier&apos;s <em>Atalanta Fugiens</em>, 1618. Every translation sits beside the original scan, so any line can be verified, quoted, and trusted.
          </figcaption>
        </figure>

        {/* Mission Section */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What We Do
        </h2>

        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-border-light">
            <h3 className="font-semibold text-primary mb-2">Digitize</h3>
            <p className="text-secondary">
              Capture rare manuscripts and early printed books from archives worldwide, making them accessible to all.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm border border-border-light">
            <h3 className="font-semibold text-primary mb-2">Translate</h3>
            <p className="text-secondary">
              AI-assisted translation from Latin, German, and other languages, with originals preserved for verification.
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm border border-border-light">
            <h3 className="font-semibold text-primary mb-2">Cite</h3>
            <p className="text-secondary">
              DOI-backed scholarly editions via <a href="https://zenodo.org" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">Zenodo</a>, enabling proper academic citation of primary sources.
            </p>
          </div>
        </div>

        {/* Historical Context */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          In the Spirit of the Renaissance
        </h2>

        <div className="border-l-4 border-accent-gold/30 pl-6 mb-8">
          <p className="text-secondary italic mb-4">
            &ldquo;Wisdom belongs to everyone.&rdquo;
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <div>
            <h3 className="text-xl text-stone-800 mb-1">
              Cosimo de&apos; Medici
            </h3>
            <p className="text-muted text-sm mb-3">1389–1464 · Florence</p>
            <p className="text-secondary text-sm leading-relaxed">
              In 1460, when a Greek manuscript of the <em>Corpus Hermeticum</em> arrived in Florence, Cosimo ordered its translation before even Plato, sensing that Hermes Trismegistus held the key to ancient wisdom. He founded the Platonic Academy in his villa at Careggi, creating the first institution dedicated to freely sharing philosophical knowledge since antiquity.
            </p>
          </div>
          <div>
            <h3 className="text-xl text-stone-800 mb-1">
              Marsilio Ficino
            </h3>
            <p className="text-muted text-sm mb-3">1433–1499 · Philosopher & Translator</p>
            <p className="text-secondary text-sm leading-relaxed">
              Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the Hermetic writings into Latin, making them accessible to all of Europe for the first time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and the <em>prisca theologia</em>: the belief in an ancient wisdom tradition uniting all seekers of truth.
            </p>
          </div>
        </div>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-16">
          <p className="text-stone-700 leading-relaxed">
            <strong>Source Library continues their work.</strong> Just as Cosimo funded translations to make ancient wisdom freely available, and Ficino labored to render Greek and Latin texts accessible to readers across Europe, we use modern tools to digitize, translate, and openly share these same traditions with the world.
          </p>
        </div>

        {/* Technology Section */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          How It Works
        </h2>

        <p className="text-secondary mb-6">
          Source Library uses AI to make historical texts accessible while maintaining scholarly standards:
        </p>

        <ul className="space-y-3 text-secondary mb-12">
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1">•</span>
            <span><strong>OCR:</strong> Gemini vision models read historical typefaces and handwriting</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1">•</span>
            <span><strong>Translation:</strong> Context-aware translation preserving technical terminology</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1">•</span>
            <span><strong>Original preserved:</strong> Every translation includes the original language text</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1">•</span>
            <span><strong>DOI citations:</strong> Published editions receive DOIs via Zenodo</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent-rust mt-1">•</span>
            <span><strong>API & MCP:</strong> <Link href="/developers" className="text-accent-rust hover:underline">Programmatic access</Link> for researchers and AI systems</span>
          </li>
        </ul>

        {/* Who's Behind This */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Who&apos;s Behind This
        </h2>

        <div className="flex flex-col sm:flex-row gap-6 items-start mb-6">
          <img
            src="/founder-derek.jpg"
            alt="Derek Lomas, founder of Source Library"
            className="w-32 h-40 object-cover rounded-lg border border-border-light shadow-sm flex-shrink-0"
          />
          <p className="text-secondary leading-relaxed">
            Source Library was founded by <strong>Derek Lomas</strong> in February 2022 after encountering Marsilio Ficino&apos;s <em>Liber de Voluptate</em> at the Embassy of the Free Mind in Amsterdam. A cognitive scientist (Yale) turned technologist, Derek saw that thousands of foundational texts in Western esotericism, philosophy, and science had never been translated into English &mdash; and that AI was finally making it possible to change that. Read his <Link href="/vision" className="text-accent-rust hover:underline">founder&apos;s letter</Link> on where the project is headed.
          </p>
        </div>

        {/* Partners */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          In Partnership with the Embassy of the Free Mind
        </h2>

        <div className="flex flex-wrap items-center gap-8 mb-8">
          <img
            src="https://images.sourcelibrary.org/assets/partners-unesco.avif"
            alt="UNESCO Memory of the World"
            className="h-20 w-auto object-contain"
          />
        </div>

        <p className="text-secondary mb-4 leading-relaxed">
          The <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> in Amsterdam is home to the Bibliotheca Philosophica Hermetica &mdash; a 25,000-volume research library inscribed on the <strong>UNESCO Memory of the World</strong> register. Library Director <strong>Paul Dijstelberge</strong> (PhD, former assistant professor for the history of the book at the University of Amsterdam; former curator at the Allard Pierson) provides scholarly guidance for Source Library&apos;s work with the BPH collection.
        </p>

        <p className="text-secondary mb-4 leading-relaxed">
          The Embassy&apos;s <a href="https://embassyofthefreemind.com/en/research/281-staff" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">Academic Advisory Board</a> includes leading international scholars in the fields covered by the collection:
        </p>

        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 mb-8">
          {[
            ['Wouter Hanegraaff', 'University of Amsterdam'],
            ['Lawrence Principe', 'Johns Hopkins University'],
            ['Bernard McGinn', 'University of Chicago, emer.'],
            ['Georgiana Hedesan', 'Oxford University'],
            ['Didier Kahn', 'CNRS, France'],
            ['Yuval Harari', 'Ben Gurion University of the Negev'],
            ['Matthew Melvin-Koushki', 'University of South Carolina'],
            ['Mike Driedger', 'Brock University, Canada'],
            ['Vladimir Urbanek', 'Academy of Sciences, Czech Republic'],
          ].map(([name, institution]) => (
            <div key={name} className="flex flex-col border-l-2 border-accent-gold/20 pl-3">
              <span className="text-stone-800 text-sm font-medium">{name}</span>
              <span className="text-muted text-xs">{institution}</span>
            </div>
          ))}
        </div>

        <p className="text-secondary mb-8 leading-relaxed">
          Senior researcher <strong>Dr. Carlos Gilly</strong> (University of Basel), a pillar of the BPH for over thirty years and one of the world&apos;s foremost scholars of Rosicrucianism and early modern Hermetism, contributes to the Institute&apos;s research and curation.
        </p>

        {/* Supporters */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          With the Generous Support Of
        </h2>

        <p className="text-secondary mb-8 leading-relaxed">
          Source Library and the Embassy of the Free Mind are made possible by the
          generosity of those who believe in this work. We gratefully acknowledge the{' '}
          <strong>Wisdom Frontiers Society</strong> of La Jolla, California, and the{' '}
          <a href="https://gambrellfoundation.org" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline"><strong>Gambrell Foundation</strong></a>{' '}
          of Charlotte, North Carolina, for their support.
        </p>

        <div className="flex flex-wrap items-center gap-10 mb-8">
          <a
            href="https://gambrellfoundation.org"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="The Gambrell Foundation"
            className="inline-block hover:opacity-80 transition-opacity"
          >
            <img
              src="/partners/gambrell-foundation.svg"
              alt="The Gambrell Foundation"
              className="h-16 w-auto object-contain"
            />
          </a>
        </div>

      </div>

      {/* Navigation blocks live OUTSIDE .prose-content: `.prose-content a` forces
          link color to accent-rust, which would make button labels (e.g. white-on-rust)
          invisible. Keeping them out lets the Tailwind text-* utilities win. */}

      {/* Closing call to action */}
      <div className="bg-stone-900 text-cream rounded-2xl p-8 md:p-10 mt-16 mb-12">
        <h2 className="text-2xl md:text-3xl text-white mb-3">Join the work</h2>
        <p className="text-stone-300 leading-relaxed mb-6 max-w-2xl">
          We are building a lasting institution for the stewardship of humanity&apos;s wisdom &mdash; from books to oral histories to expeditions in the field. Read the vision, explore the library, or help make the next translation possible.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/vision"
            className="px-5 py-2.5 bg-white text-stone-900 rounded-full hover:bg-stone-100 transition-colors font-medium"
          >
            Read the vision
          </Link>
          <Link
            href="/support"
            className="px-5 py-2.5 bg-accent-rust text-white rounded-full hover:opacity-90 transition-opacity font-medium"
          >
            Support the project
          </Link>
          <Link
            href="/"
            className="px-5 py-2.5 border border-stone-600 text-cream rounded-full hover:bg-stone-800 transition-colors"
          >
            Browse the library
          </Link>
        </div>
      </div>

      {/* Secondary links */}
      <div className="flex flex-wrap gap-4 pt-8 border-t border-border-light">
        <Link
          href="/census"
          className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
        >
          Translation Census
        </Link>
        <Link
          href="/about/progress"
          className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
        >
          Our Progress
        </Link>
        <Link
          href="/about/sources"
          className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
        >
          Source Libraries
        </Link>
        <Link
          href="/about/faq"
          className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
        >
          FAQ
        </Link>
        <Link
          href="/developers"
          className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
        >
          API & MCP Server
        </Link>
      </div>
    </ContentPageLayout>
  );
}
