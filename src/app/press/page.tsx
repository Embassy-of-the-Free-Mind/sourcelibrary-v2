import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Press - Source Library',
  description: 'Press releases, key facts, and media resources for Source Library — an initiative of the Embassy of the Free Mind, Amsterdam.',
  alternates: { canonical: '/press' },
};

const PRESS_RELEASES = [
  {
    slug: '/press/hermetic-tradition',
    date: 'Week 6',
    title: 'The Lost Teachings of Hermes: AI Unlocks the Texts That Sparked the Renaissance',
    description: 'A 15th-century manuscript attributed to the father of Western mysticism is readable in English for the first time through Source Library\'s AI translation system.',
    theme: 'The Hermetic Tradition',
  },
  {
    slug: '/press/alchemy',
    date: 'Week 12',
    title: 'Before Chemistry Had a Name: AI Reveals the Alchemical Roots of Modern Science',
    description: 'Newly translated texts from Paracelsus, Sendivogius, and their contemporaries show how the quest to transmute matter became the science of understanding it.',
    theme: 'Alchemy & Chemistry',
  },
  {
    slug: '/press/kabbalah',
    date: 'Week 18',
    title: 'The Language That Created the World: AI Translates the Kabbalistic Texts That Shaped Renaissance Philosophy',
    description: 'The foundational texts of Jewish and Christian Kabbalah — including the Sefer Yetzirah and Kircher\'s Oedipus Aegyptiacus — are now freely readable in English.',
    theme: 'Kabbalah & Mysticism',
  },
  {
    slug: '/press/origins-of-science',
    date: 'Week 24',
    title: 'The Mystic Who Discovered Planetary Motion: How Kepler\'s Occult Beliefs Led to Modern Astronomy',
    description: 'Source Library\'s AI translation of Kepler\'s Astronomia Nova reveals how mystical convictions about cosmic harmony produced the laws of planetary motion.',
    theme: 'Origins of Science',
  },
  {
    slug: '/press/world-sacred-texts',
    date: 'Week 30',
    title: '30 Traditions, One Library: Source Library Expands Beyond Europe with the World\'s Sacred and Esoteric Texts',
    description: 'A major acquisition brings 193 books from Buddhist, Hindu, Sufi, Daoist, Indigenous, and other wisdom traditions into the open-access digital library.',
    theme: 'World Sacred Texts',
  },
];

const SOURCE_LIBRARIES = [
  'Internet Archive',
  'Biblioth\u00e8que nationale de France (Gallica)',
  'Bodleian Library, University of Oxford',
  'Vatican Library (DigiVatLib)',
  'Bavarian State Library (MDZ)',
  'Cambridge Digital Library',
  'Wellcome Collection',
  'Herzog August Bibliothek Wolfenb\u00fcttel',
  'e-rara (Swiss National Library)',
  'Library of Congress',
  'Europeana',
  'Google Books (via IA mirror)',
  'Biblissima IIIF Aggregator',
];

export default function PressPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-stone-900 text-white py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-6 md:px-12">
          <p className="text-accent-gold text-sm tracking-[0.2em] uppercase mb-4">
            Press
          </p>
          <h1
            className="text-4xl md:text-5xl lg:text-6xl mb-6 font-display"
          >
            Source Library
          </h1>
          <p className="text-xl text-white/70 max-w-2xl font-body">
            An initiative of the Embassy of the Free Mind, Amsterdam.
            AI-powered translations of thousands of rare historical texts, freely available online.
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 md:px-12 py-16 space-y-16">
        {/* Launch Press Release */}
        <section>
          <p className="text-sm text-stone-500 uppercase tracking-wider mb-2">
            FOR IMMEDIATE RELEASE &mdash; February 22, 2026
          </p>
          <h2
            className="text-3xl md:text-4xl text-stone-900 mb-6 font-display"
          >
            Source Library Launches Open Beta: Over 4,000 Rare Books Translated by AI
          </h2>
          <div className="prose prose-stone max-w-none text-lg leading-relaxed space-y-4">
            <p>
              <strong>Amsterdam, February 22, 2026</strong> &mdash; Source Library, an initiative of the
              Embassy of the Free Mind in Amsterdam, today launches its open beta: a digital library of
              over 4,000 rare historical texts from the 15th through 19th centuries, translated into
              modern English using artificial intelligence.
            </p>
            <p>
              Most books written before 1800 have never been translated into any modern language. Source
              Library uses Gemini AI to produce first-ever English translations of works on early science,
              philosophy, medicine, alchemy, theology, Hermeticism, and the Kabbalah &mdash; making texts
              previously accessible only to specialists available to anyone with an internet connection.
            </p>
            <p>
              The collection draws from 13 major digital libraries worldwide, including the Internet
              Archive, the Biblioth&egrave;que nationale de France, the Bodleian Library at Oxford, the
              Vatican Library, and the Bavarian State Library. Every page preserves the original manuscript
              alongside its AI translation, allowing readers to verify and improve the text.
            </p>
            <p>
              Source Library is free to read and cite. It is based at the Embassy of the Free Mind in
              Amsterdam, home to the Bibliotheca Philosophica Hermetica &mdash; one of the world&apos;s
              most important collections of Hermetic philosophy, recognized by UNESCO&apos;s Memory of
              the World Register.
            </p>
          </div>
        </section>

        {/* Themed Press Releases */}
        <section>
          <h2
            className="text-2xl text-stone-900 mb-8 font-display"
          >
            Press Releases
          </h2>
          <div className="space-y-6">
            {PRESS_RELEASES.map((release) => (
              <Link
                key={release.slug}
                href={release.slug}
                className="block group border border-stone-200 rounded-xl p-6 hover:border-accent-gold/20 hover:bg-accent-gold/3 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-accent-rust uppercase tracking-wider mb-1">
                      {release.theme}
                    </p>
                    <h3
                      className="text-xl text-stone-900 group-hover:text-accent-gold-dark transition-colors mb-2 font-display"
                    >
                      {release.title}
                    </h3>
                    <p className="text-stone-500 text-sm leading-relaxed">
                      {release.description}
                    </p>
                  </div>
                  <span className="text-stone-400 group-hover:text-accent-rust transition-colors mt-1 shrink-0">
                    &rarr;
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Key Facts */}
        <section>
          <h2
            className="text-2xl text-stone-900 mb-6 font-display"
          >
            Key Facts
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {[
              { number: '10,000+', label: 'Rare books digitised' },
              { number: '3.7M', label: 'Pages scanned' },
              { number: '800K+', label: 'Pages translated to English' },
              { number: '100+', label: 'Source languages' },
              { number: '76K+', label: 'Illustrations extracted' },
              { number: '160+', label: 'Source libraries worldwide' },
            ].map((stat) => (
              <div key={stat.label} className="bg-stone-50 rounded-xl p-5">
                <div
                  className="text-3xl text-accent-rust mb-1"
                  style={{ fontWeight: 300 }}
                >
                  {stat.number}
                </div>
                <div className="text-stone-600 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Source Libraries */}
        <section>
          <h2
            className="text-2xl text-stone-900 mb-6 font-display"
          >
            Source Libraries
          </h2>
          <p className="text-stone-600 mb-4">
            Source Library aggregates and translates digitised rare books from these institutions:
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-stone-700">
            {SOURCE_LIBRARIES.map((name) => (
              <li key={name} className="flex items-start gap-2">
                <span className="text-accent-gold mt-1.5 shrink-0">&bull;</span>
                {name}
              </li>
            ))}
          </ul>
        </section>

        {/* About the Embassy */}
        <section>
          <h2
            className="text-2xl text-stone-900 mb-6 font-display"
          >
            About the Embassy of the Free Mind
          </h2>
          <div className="space-y-4 text-stone-600 text-lg leading-relaxed">
            <p>
              The Embassy of the Free Mind is an international centre for free thought and the history
              of ideas, located on the Keizersgracht in Amsterdam. It houses the Bibliotheca Philosophica
              Hermetica (BPH), founded by Joost R. Ritman in 1984 &mdash; one of the world&apos;s
              preeminent collections of Hermetic philosophy, mysticism, alchemy, and related traditions.
            </p>
            <p>
              In 2019, the core of the BPH was inscribed in UNESCO&apos;s Memory of the World Register,
              recognizing its outstanding universal significance for the intellectual heritage of
              humanity. The collection spans manuscripts and printed works from the 1st to the 20th
              century.
            </p>
            <p>
              Source Library extends the mission of the Embassy by making these and related texts
              freely accessible in digital form, with AI-generated English translations to reach
              a global audience.
            </p>
          </div>
          <div className="flex items-center gap-6 mt-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-14 w-auto"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-16 w-auto"
            />
          </div>
        </section>

        {/* Contact */}
        <section className="border-t border-stone-200 pt-12">
          <h2
            className="text-2xl text-stone-900 mb-4 font-display"
          >
            Press Contact
          </h2>
          <p className="text-stone-600 mb-6">
            For press enquiries, interviews, and high-resolution images:
          </p>
          <div className="space-y-2 text-stone-700">
            <p>
              <strong>Email:</strong>{' '}
              <a href="mailto:press@sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">
                press@sourcelibrary.org
              </a>
            </p>
            <p>
              <strong>Website:</strong>{' '}
              <a href="https://sourcelibrary.org" className="text-accent-rust hover:text-accent-gold-dark">
                sourcelibrary.org
              </a>
            </p>
          </div>
        </section>

        {/* Press Kit */}
        <section className="bg-stone-50 rounded-xl p-8">
          <h2
            className="text-2xl text-stone-900 mb-4 font-display"
          >
            Press Kit
          </h2>
          <div className="space-y-3 text-stone-600">
            <p>
              Logos and brand assets are available in the{' '}
              <a href="/brand" className="text-accent-rust hover:text-accent-gold-dark">brand kit</a>.
            </p>
            <p>
              For a high-resolution screenshot of the reader interface, see the{' '}
              <Link href="/beta" className="text-accent-rust hover:text-accent-gold-dark">beta page</Link>.
            </p>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="bg-stone-900 text-white/60 py-8">
        <div className="max-w-4xl mx-auto px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm">
          <span>&copy; {new Date().getFullYear()} Source Library &mdash; An initiative of the Embassy of the Free Mind</span>
          <Link href="/" className="text-accent-gold/60 hover:text-accent-gold transition-colors">
            Back to Source Library
          </Link>
        </div>
      </footer>
    </div>
  );
}
