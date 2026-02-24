import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'About - Source Library',
  description: 'Thousands of the most important texts in Western intellectual history have never been translated into English. Source Library is recovering them with AI and making them freely available.',
  alternates: {
    canonical: '/about',
  },
};

export default function AboutPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Thousands of the most important texts in Western intellectual history have never been translated into English."
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          The foundational works of Hermetic philosophy, alchemy, Neoplatonism, Rosicrucianism, Kabbalah, and early modern science sit in archives across Europe — written in Latin, German, Arabic, Hebrew, and Greek. Scholars who can read them number in the hundreds. The rest of the world has had to rely on summaries, fragments, and secondhand accounts.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library is recovering them — using AI to do in months what would take centuries by hand — and making them freely available to scholars, seekers, and the AI systems that will shape how future generations think.
        </p>

        <p className="text-xl text-secondary leading-relaxed mb-12">
          Based at the <a href="https://embassyofthefreemind.org" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> in Amsterdam, home to the Bibliotheca Philosophica Hermetica — recognized by UNESCO&apos;s Memory of the World Register — we are building the open infrastructure for a tradition that has been locked away for too long.
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
              DOI-backed scholarly editions via Zenodo, enabling proper academic citation of primary sources.
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
              In 1460, when a Greek manuscript of the <em>Corpus Hermeticum</em> arrived in Florence, Cosimo ordered its translation before even Plato—sensing that Hermes Trismegistus held the key to ancient wisdom. He founded the Platonic Academy in his villa at Careggi, creating the first institution dedicated to freely sharing philosophical knowledge since antiquity.
            </p>
          </div>
          <div>
            <h3 className="text-xl text-stone-800 mb-1">
              Marsilio Ficino
            </h3>
            <p className="text-muted text-sm mb-3">1433–1499 · Philosopher & Translator</p>
            <p className="text-secondary text-sm leading-relaxed">
              Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the Hermetic writings into Latin—making them accessible to all of Europe for the first time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and the <em>prisca theologia</em>: the belief in an ancient wisdom tradition uniting all seekers of truth.
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

        {/* Partners */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Partners
        </h2>

        <div className="flex flex-wrap items-center gap-8 mb-12">
          <img
            src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
            alt="Embassy of the Free Mind"
            className="h-16 w-auto object-contain"
          />
          <img
            src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
            alt="UNESCO Memory of the World"
            className="h-20 w-auto object-contain"
          />
        </div>

        <p className="text-secondary mb-8">
          Source Library is a project of the <strong>Ancient Wisdom Trust</strong>, working in partnership with the Embassy of the Free Mind and the Bibliotheca Philosophica Hermetica.
        </p>

        {/* Links */}
        <div className="flex flex-wrap gap-4 pt-8 border-t border-border-light">
          <Link
            href="/"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            Browse the Library
          </Link>
          <Link
            href="/about/standards"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Standards & Interoperability
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
