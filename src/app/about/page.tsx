import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About - Source Library',
  description: 'Source Library continues the mission of Cosimo de\' Medici and Marsilio Ficino, making rare Hermetic and Renaissance texts freely available to all.',
  alternates: {
    canonical: '/about',
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#f6f3ee]">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-stone-700 hover:text-stone-900 transition-colors">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1" />
            </svg>
            <span className="font-medium">Source Library</span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-16">
        <h1
          className="text-4xl md:text-5xl text-gray-900 mb-8 leading-tight"
          style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
        >
          Source Library continues the Ficino Society&apos;s mission to transform 2500+ years of wisdom texts into a living archive.
        </h1>

        <div className="prose prose-lg prose-stone max-w-none">
          <p className="text-xl text-gray-600 leading-relaxed mb-8">
            Based at the Embassy of the Free Mind in Amsterdam, home to the Bibliotheca Philosophica Hermetica—recognized by UNESCO&apos;s Memory of the World Register—this collection contains rare works on Hermetic philosophy, alchemy, Neoplatonist mystical literature, Rosicrucianism, Freemasonry, and the Kabbalah.
          </p>

          <p className="text-xl text-gray-600 leading-relaxed mb-12">
            We seek to preserve heritage while enabling new research and interpretation through digital innovation. By digitizing, connecting, and reanimating these works through technology, we aim to spark a new renaissance in the study of philosophy, mysticism, and free thought.
          </p>

          {/* Mission Section */}
          <h2
            className="text-2xl md:text-3xl text-gray-900 mt-16 mb-6"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            Our Mission
          </h2>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-stone-200">
              <h3 className="font-semibold text-gray-900 mb-2">Digitize</h3>
              <p className="text-gray-600">
                Capture rare manuscripts and early printed books from archives worldwide, making them accessible to all.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm border border-stone-200">
              <h3 className="font-semibold text-gray-900 mb-2">Translate</h3>
              <p className="text-gray-600">
                AI-assisted translation from Latin, German, and other languages, with originals preserved for verification.
              </p>
            </div>
            <div className="bg-white rounded-xl p-6 shadow-sm border border-stone-200">
              <h3 className="font-semibold text-gray-900 mb-2">Cite</h3>
              <p className="text-gray-600">
                DOI-backed scholarly editions via Zenodo, enabling proper academic citation of primary sources.
              </p>
            </div>
          </div>

          {/* Historical Context */}
          <h2
            className="text-2xl md:text-3xl text-gray-900 mt-16 mb-6"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            In the Spirit of the Renaissance
          </h2>

          <div className="border-l-4 border-amber-400 pl-6 mb-8">
            <p className="text-gray-600 italic mb-4">
              &ldquo;Wisdom belongs to everyone.&rdquo;
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 mb-12">
            <div>
              <h3
                className="text-xl text-stone-800 mb-1"
                style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
              >
                Cosimo de&apos; Medici
              </h3>
              <p className="text-stone-500 text-sm mb-3">1389–1464 · Florence</p>
              <p className="text-stone-600 text-sm leading-relaxed">
                In 1460, when a Greek manuscript of the <em>Corpus Hermeticum</em> arrived in Florence, Cosimo ordered its translation before even Plato—sensing that Hermes Trismegistus held the key to ancient wisdom. He founded the Platonic Academy in his villa at Careggi, creating the first institution dedicated to freely sharing philosophical knowledge since antiquity.
              </p>
            </div>
            <div>
              <h3
                className="text-xl text-stone-800 mb-1"
                style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
              >
                Marsilio Ficino
              </h3>
              <p className="text-stone-500 text-sm mb-3">1433–1499 · Philosopher & Translator</p>
              <p className="text-stone-600 text-sm leading-relaxed">
                Ficino translated the complete works of Plato, Plotinus, Proclus, Iamblichus, and the Hermetic writings into Latin—making them accessible to all of Europe for the first time. His work ignited the Renaissance recovery of Neoplatonism, Hermeticism, and the <em>prisca theologia</em>: the belief in an ancient wisdom tradition uniting all seekers of truth.
              </p>
            </div>
          </div>

          <div className="bg-amber-50/50 rounded-lg p-6 border border-amber-100 mb-16">
            <p className="text-stone-700 leading-relaxed">
              <strong>Source Library continues their work.</strong> Just as Cosimo funded translations to make ancient wisdom freely available, and Ficino labored to render Greek and Latin texts accessible to readers across Europe, we use modern tools to digitize, translate, and openly share these same traditions with the world.
            </p>
          </div>

          {/* Technology Section */}
          <h2
            className="text-2xl md:text-3xl text-gray-900 mt-16 mb-6"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            Technology
          </h2>

          <p className="text-gray-600 mb-6">
            Source Library uses AI to make historical texts accessible while maintaining scholarly standards:
          </p>

          <ul className="space-y-3 text-gray-600 mb-12">
            <li className="flex items-start gap-3">
              <span className="text-amber-600 mt-1">•</span>
              <span><strong>OCR:</strong> Gemini vision models read historical typefaces and handwriting</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-amber-600 mt-1">•</span>
              <span><strong>Translation:</strong> Context-aware translation preserving technical terminology</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-amber-600 mt-1">•</span>
              <span><strong>Original preserved:</strong> Every translation includes the original language text</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-amber-600 mt-1">•</span>
              <span><strong>DOI citations:</strong> Published editions receive DOIs via Zenodo</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-amber-600 mt-1">•</span>
              <span><strong>API & MCP:</strong> Programmatic access for researchers and AI systems</span>
            </li>
          </ul>

          {/* Partners */}
          <h2
            className="text-2xl md:text-3xl text-gray-900 mt-16 mb-6"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
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

          <p className="text-gray-600 mb-8">
            Source Library is a project of the <strong>Ancient Wisdom Trust</strong>, working in partnership with the Embassy of the Free Mind and the Bibliotheca Philosophica Hermetica.
          </p>

          {/* Links */}
          <div className="flex flex-wrap gap-4 pt-8 border-t border-stone-200">
            <Link
              href="/"
              className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
            >
              Browse the Library
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
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 py-8 mt-16">
        <div className="max-w-5xl mx-auto px-6 text-center text-gray-600">
          <p>&copy; {new Date().getFullYear()} Source Library — A project of the Ancient Wisdom Trust</p>
          <p className="mt-2 text-sm">CC0 Public Domain</p>
        </div>
      </footer>
    </div>
  );
}
