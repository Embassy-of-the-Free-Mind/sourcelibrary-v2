import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'About - Source Library',
  description: 'Source Library continues the mission of Cosimo de\' Medici and Marsilio Ficino, making rare Hermetic and Renaissance texts freely available to all.',
  alternates: {
    canonical: '/about',
  },
};

export default function AboutPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Source Library transforms 2500+ years of wisdom texts into a living archive, freely available to all."
          image="https://images.sourcelibrary.org/archived/6909aba7cf28baa1b4caef69/5.jpg"
          imageAlt="Historical illustration from the Embassy of the Free Mind collection"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Based at the <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> in Amsterdam, home to the Bibliotheca Philosophica Hermetica (recognized by UNESCO&apos;s Memory of the World Register), this collection contains rare works on Hermetic philosophy, alchemy, Neoplatonist mystical literature, Rosicrucianism, Freemasonry, and the Kabbalah.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-12">
          We seek to preserve heritage while enabling new research and interpretation through digital innovation. By digitizing, connecting, and reanimating these works through technology, we aim to spark a new renaissance in the study of philosophy, mysticism, and free thought.
        </p>

        {/* Mission Section */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Our Mission
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
          Technology
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
            <span><strong>API & MCP:</strong> Programmatic access for researchers and AI systems</span>
          </li>
        </ul>

        {/* Who's Behind This */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Who&apos;s Behind This
        </h2>

        <p className="text-secondary mb-6 leading-relaxed">
          Source Library was founded by <strong>Derek Lomas</strong> in February 2022 after encountering Marsilio Ficino&apos;s <em>Liber de Voluptate</em> at the Embassy of the Free Mind in Amsterdam. A cognitive scientist (Yale) turned technologist, Derek saw that thousands of foundational texts in Western esotericism, philosophy, and science had never been translated into English &mdash; and that AI was finally making it possible to change that. Read his <Link href="/vision" className="text-accent-rust hover:underline">founder&apos;s letter</Link> on where the project is headed.
        </p>

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

        {/* Links */}
        <div className="flex flex-wrap gap-4 pt-8 border-t border-border-light">
          <Link
            href="/"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            Browse the Library
          </Link>
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
          <Link
            href="/support"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Support the Project
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}
