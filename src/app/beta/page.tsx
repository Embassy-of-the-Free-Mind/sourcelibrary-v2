'use client';

import { useState } from 'react';

// Gallery images — curated for visual impact and diversity
const GALLERY_IMAGES = [
  {
    title: 'The Wind Carried Him in Its Belly',
    source: 'Atalanta Fugiens',
    author: 'Michael Maier',
    year: '1617',
    thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044154-0-thumb.jpg',
  },
  {
    title: 'Mother Earth Nursing Creation',
    source: 'Atalanta Fugiens',
    author: 'Michael Maier',
    year: '1617',
    thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044158-0-thumb.jpg',
  },
  {
    title: 'The First Key of Basil Valentine',
    source: 'Musaeum Hermeticum',
    author: 'Various',
    year: '1678',
    thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/695203a5ab34727b1f041c53/695203a6ab34727b1f041dea-0-thumb.jpg',
  },
  {
    title: 'The Ouroboros',
    source: 'Atalanta Fugiens',
    author: 'Michael Maier',
    year: '1617',
    thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044188-0-thumb.jpg',
  },
  {
    title: 'Perspective Drawing Machine',
    source: 'Unterweysung der Messung',
    author: 'Albrecht Dürer',
    year: '1525',
    image: 'https://sourcelibrary.org/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2Fe532b010-6d2e-40ca-9f95-c67e74c5ee61%2F183.jpg&x=0.063&y=0.119&w=0.898&h=0.491',
  },
  {
    title: 'Alchemical Geometry',
    source: 'Atalanta Fugiens',
    author: 'Michael Maier',
    year: '1617',
    image: 'https://sourcelibrary.org/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2F69520c46ab34727b1f044141%2F99.jpg&x=0.145&y=0.216&w=0.713&h=0.472',
  },
];

// Featured translated works for the catalog section
const FEATURED_WORKS = [
  { title: 'Corpus Hermeticum: Pimander', author: 'Hermes Trismegistus / Ficino', year: '1481', language: 'Latin', pages: 96 },
  { title: 'Three Books of Occult Philosophy', author: 'Heinrich Cornelius Agrippa', year: '1550', language: 'Latin', pages: 626 },
  { title: 'The Letters of Marsilio Ficino', author: 'Marsilio Ficino', year: '1497', language: 'Latin', pages: 496 },
  { title: 'Atalanta Fugiens', author: 'Michael Maier', year: '1617', language: 'Latin', pages: 230 },
  { title: 'Platonic Theology', author: 'Marsilio Ficino', year: '1525', language: 'Latin', pages: 455 },
  { title: 'De Mysteriis Aegyptiorum', author: 'Iamblichus / Ficino', year: '1497', language: 'Latin', pages: 381 },
  { title: 'Plato Opera Omnia', author: 'Plato / Ficino', year: '1557', language: 'Latin & Greek', pages: 718 },
  { title: 'Symbola Aureae Mensae', author: 'Michael Maier', year: '1617', language: 'Latin', pages: 698 },
];

function EmailForm({
  email,
  setEmail,
  status,
  errorMsg,
  onSubmit,
  variant = 'dark',
}: {
  email: string;
  setEmail: (v: string) => void;
  status: 'idle' | 'loading' | 'success' | 'error';
  errorMsg: string;
  onSubmit: (e: React.FormEvent) => void;
  variant?: 'dark' | 'light';
}) {
  if (status === 'success') {
    return (
      <div
        className={`border rounded-xl p-6 max-w-xl ${
          variant === 'dark'
            ? 'bg-white/10 border-white/20'
            : 'bg-amber-50 border-amber-200'
        }`}
        style={{ fontFamily: 'Inter, sans-serif' }}
      >
        <p className={`text-lg font-medium mb-1 ${variant === 'dark' ? 'text-white' : 'text-stone-900'}`}>
          You&apos;re in.
        </p>
        <p className={`text-sm ${variant === 'dark' ? 'text-white/70' : 'text-stone-600'}`}>
          We&apos;ll send you access when the beta opens. Welcome to the library.
        </p>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3 max-w-xl">
        <input
          type="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`flex-1 px-5 py-4 rounded-lg text-base focus:outline-none transition-colors ${
            variant === 'dark'
              ? 'bg-white/10 backdrop-blur-sm border border-white/20 text-white placeholder-white/40 focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/30'
              : 'bg-white border border-stone-300 text-stone-900 placeholder-stone-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30'
          }`}
          style={{ fontFamily: 'Inter, sans-serif' }}
          disabled={status === 'loading'}
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="px-8 py-4 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 text-stone-900 rounded-lg text-base font-medium transition-colors whitespace-nowrap"
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {status === 'loading' ? 'Joining...' : 'Get Early Access'}
        </button>
      </form>
      {status === 'error' && (
        <p className="text-red-400 text-sm mt-2" style={{ fontFamily: 'Inter, sans-serif' }}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}

export default function BetaLandingPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/beta/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Something went wrong');
        setStatus('error');
        return;
      }
      setStatus('success');
      setEmail('');
    } catch {
      setErrorMsg('Network error — please try again');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-black">
      {/* ============================================ */}
      {/* HERO — full viewport, video background       */}
      {/* ============================================ */}
      <section className="relative min-h-screen w-full overflow-hidden flex flex-col">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero-poster.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          fetchPriority="high"
        />
        <video
          autoPlay loop muted playsInline preload="auto"
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm" type="video/webm" />
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80" />

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-6">
          <div className="flex items-center gap-3">
            <svg className="w-10 h-10 md:w-12 md:h-12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
            </svg>
            <span className="text-xl md:text-2xl uppercase tracking-wider text-white">
              <span className="font-semibold">Source</span>
              <span className="font-light">Library</span>
            </span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-white/60" style={{ fontFamily: 'Inter, sans-serif' }}>
            <a href="#demo" className="hover:text-white transition-colors">See it work</a>
            <a href="#collection" className="hover:text-white transition-colors">The collection</a>
            <a href="#signup" className="hover:text-white transition-colors">Get access</a>
          </div>
        </header>

        {/* Hero content */}
        <div className="relative z-10 flex-1 flex items-center">
          <div className="px-6 md:px-12 w-full max-w-4xl">
            <p
              className="text-amber-400 text-sm tracking-[0.2em] uppercase mb-6"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              Now in beta
            </p>
            <h1
              className="text-4xl md:text-5xl lg:text-7xl text-white mb-6 leading-[1.05]"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              The world&apos;s largest library
              <br />
              of Western esoteric texts,
              <br />
              <span className="italic font-normal">translated by AI</span>
            </h1>
            <p
              className="text-lg md:text-xl text-white/80 leading-relaxed max-w-2xl mb-10"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              4,100 rare books. 1.6 million pages. 71 languages. Hermetic philosophy, alchemy,
              Kabbalah, Neoplatonism, natural magic — translated into clear modern English and
              searchable for the first time.
            </p>

            <EmailForm
              email={email}
              setEmail={setEmail}
              status={status}
              errorMsg={errorMsg}
              onSubmit={handleSubmit}
              variant="dark"
            />
            <p className="text-white/30 text-xs mt-3" style={{ fontFamily: 'Inter, sans-serif' }}>
              Free and open access. No paywall, ever.
            </p>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="relative z-10 pb-8 flex justify-center" aria-hidden="true">
          <svg className="w-6 h-6 text-white/40 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ============================================ */}
      {/* LIVE DEMO — manuscript + translation          */}
      {/* ============================================ */}
      <section id="demo" className="py-20 md:py-28 bg-[#0f0d0a]">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p
              className="text-amber-500 text-sm tracking-[0.2em] uppercase mb-4"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              See it work
            </p>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-white mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              From 1497 manuscript to English in seconds
            </h2>
            <p
              className="text-lg text-white/50 max-w-2xl mx-auto"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              Ficino&apos;s <em>Epistolae</em> — a dialogue between God and the Soul,
              printed in Venice, now readable for the first time in 500 years.
            </p>
          </div>

          {/* Side-by-side: manuscript + translation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start max-w-6xl mx-auto">
            {/* Left: Manuscript scan */}
            <div className="relative">
              <div className="bg-stone-900 rounded-xl overflow-hidden border border-stone-800 shadow-2xl">
                <div className="px-4 py-3 border-b border-stone-800 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-stone-700" />
                  <span className="text-stone-500 text-xs" style={{ fontFamily: 'Inter, sans-serif' }}>
                    Original — Latin, Venice, 1497
                  </span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/694b3acade93d1d4cec199c5/8.jpg"
                  alt="Page from Ficino's Epistolae, printed in Venice, 1497"
                  className="w-full"
                  loading="lazy"
                />
              </div>
            </div>

            {/* Right: English translation */}
            <div className="relative">
              <div className="bg-[#fdfcf9] rounded-xl overflow-hidden border border-stone-200 shadow-2xl">
                <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <span className="text-stone-500 text-xs" style={{ fontFamily: 'Inter, sans-serif' }}>
                    AI Translation — English, 2026
                  </span>
                </div>
                <div className="p-6 md:p-8">
                  <div
                    className="text-stone-800 leading-[1.9] text-[15px] md:text-base"
                    style={{ fontFamily: 'Newsreader, Georgia, serif' }}
                  >
                    <p className="mb-4 text-xs uppercase tracking-[0.15em] text-stone-400" style={{ fontFamily: 'Inter, sans-serif' }}>
                      God speaks to the Soul:
                    </p>
                    <p className="mb-5">
                      <em>&ldquo;I fill, penetrate, and contain heaven and earth. I fill, but am not filled, because
                      I am fullness itself. I penetrate, but am not penetrated, because I am the power of
                      penetration itself. I contain, but am not contained, because I am the very capacity of
                      containing.&rdquo;</em>
                    </p>
                    <p className="mb-5">
                      <em>&ldquo;I am the light of lights, beyond every light. I illuminate every intellectual nature,
                      but no intellectual light illuminates me, because I exist above every intellect.&rdquo;</em>
                    </p>
                    <p className="mb-5">
                      <em>&ldquo;Seek my face, and you shall live. But do not stir, so as to touch me, who am stability
                      itself; do not be distracted by various things, so as to apprehend me, who am unity itself.
                      Cease motion. Gather the multitude.&rdquo;</em>
                    </p>
                    <p className="text-amber-800 font-medium">
                      <em>&ldquo;You will immediately attain me, who have long since wholly attained you.&rdquo;</em>
                    </p>
                    <div className="mt-6 pt-4 border-t border-stone-200">
                      <p className="text-stone-400 text-xs" style={{ fontFamily: 'Inter, sans-serif' }}>
                        Marsilio Ficino, <em>Epistolae</em>, Venice, 1497 — p. 8
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Second example: Corpus Hermeticum pull quote */}
          <div className="max-w-3xl mx-auto mt-16 text-center">
            <div className="border-l-2 border-amber-500/40 pl-6 md:pl-8 text-left">
              <p
                className="text-white/80 text-lg md:text-xl leading-relaxed italic"
                style={{ fontFamily: 'Newsreader, Georgia, serif' }}
              >
                &ldquo;You, whoever you are who reads these words: whether a student of grammar, an orator,
                a philosopher, or a theologian: know that I am Mercurius Trismegistus.&rdquo;
              </p>
              <p
                className="text-white/30 text-sm mt-4"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                Corpus Hermeticum: Pimander — Venice, 1481. Translated from Latin by AI.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* GALLERY — visual showcase                    */}
      {/* ============================================ */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p
              className="text-amber-700 text-sm tracking-[0.2em] uppercase mb-4"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              29,000+ illustrations cataloged
            </p>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              A searchable gallery of alchemical art
            </h2>
            <p
              className="text-lg text-stone-600 max-w-2xl mx-auto"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              Every emblem, engraving, diagram, and frontispiece — extracted, described, and
              searchable by subject, symbol, and technique.
            </p>
          </div>

          {/* Gallery grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 mb-12">
            {GALLERY_IMAGES.map((item) => (
              <div
                key={item.title}
                className="group relative rounded-xl overflow-hidden shadow-sm bg-white"
              >
                <div className="aspect-square overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={(item as any).image || item.thumbnail}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                </div>
                <div className="p-3 md:p-4">
                  <h3
                    className="text-stone-900 text-sm md:text-base mb-0.5"
                    style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
                  >
                    {item.title}
                  </h3>
                  <p className="text-stone-400 text-xs" style={{ fontFamily: 'Inter, sans-serif' }}>
                    {item.author}, {item.year}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* CATALOG — what's already translated           */}
      {/* ============================================ */}
      <section id="collection" className="py-20 md:py-28 bg-white">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p
              className="text-amber-700 text-sm tracking-[0.2em] uppercase mb-4"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              The Collection
            </p>
            <h2
              className="text-3xl md:text-4xl text-stone-900 mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              Already translated and searchable
            </h2>
            <p
              className="text-lg text-stone-600 max-w-2xl mx-auto"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              These are some of the foundational texts of the Western esoteric tradition.
              Most have never before been available in English in any complete form.
            </p>
          </div>

          {/* Works table */}
          <div className="border border-stone-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <th className="text-left px-4 md:px-6 py-3 text-xs uppercase tracking-wider text-stone-500" style={{ fontFamily: 'Inter, sans-serif' }}>Work</th>
                  <th className="text-left px-4 md:px-6 py-3 text-xs uppercase tracking-wider text-stone-500 hidden md:table-cell" style={{ fontFamily: 'Inter, sans-serif' }}>Author</th>
                  <th className="text-left px-4 md:px-6 py-3 text-xs uppercase tracking-wider text-stone-500 hidden sm:table-cell" style={{ fontFamily: 'Inter, sans-serif' }}>Year</th>
                  <th className="text-right px-4 md:px-6 py-3 text-xs uppercase tracking-wider text-stone-500" style={{ fontFamily: 'Inter, sans-serif' }}>Pages</th>
                </tr>
              </thead>
              <tbody>
                {FEATURED_WORKS.map((work, i) => (
                  <tr
                    key={work.title}
                    className={`border-b border-stone-100 ${i % 2 === 0 ? '' : 'bg-stone-50/50'}`}
                  >
                    <td className="px-4 md:px-6 py-4">
                      <span
                        className="text-stone-900 text-sm md:text-base"
                        style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
                      >
                        {work.title}
                      </span>
                      <span className="md:hidden block text-stone-400 text-xs mt-0.5" style={{ fontFamily: 'Inter, sans-serif' }}>
                        {work.author}
                      </span>
                    </td>
                    <td
                      className="px-4 md:px-6 py-4 text-stone-500 text-sm hidden md:table-cell"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      {work.author}
                    </td>
                    <td
                      className="px-4 md:px-6 py-4 text-stone-500 text-sm hidden sm:table-cell"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      {work.year}
                    </td>
                    <td
                      className="px-4 md:px-6 py-4 text-right text-stone-400 text-sm"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      {work.pages}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p
            className="text-center text-stone-400 text-sm mt-4"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            Plus 4,000+ more works in alchemy, Hermeticism, Kabbalah, astrology, natural philosophy, Neoplatonism, and early modern science.
          </p>
        </div>
      </section>

      {/* ============================================ */}
      {/* PROCESS — how it works                       */}
      {/* ============================================ */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p
              className="text-amber-700 text-sm tracking-[0.2em] uppercase mb-4"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              The Technology
            </p>
            <h2
              className="text-3xl md:text-4xl text-stone-900 mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              From 500-year-old manuscript to searchable text
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              {
                step: '1',
                title: 'Digitize',
                text: 'High-resolution scans from the Bodleian, Bavarian State Library, Bibliotheca Philosophica Hermetica, Vatican, and 12 other institutions.',
              },
              {
                step: '2',
                title: 'Read',
                text: 'Custom AI models extract text from blackletter type, Renaissance italic, and handwritten scripts that defeat standard OCR. 289,000 pages processed.',
              },
              {
                step: '3',
                title: 'Translate',
                text: 'Page-by-page translation preserving technical vocabulary, cross-references, and scholarly nuance. 81,000+ pages completed across 71 languages.',
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-5 border border-amber-200/60">
                  <span
                    className="text-2xl text-amber-700"
                    style={{ fontFamily: 'Cormorant Garamond, serif' }}
                  >
                    {item.step}
                  </span>
                </div>
                <h3
                  className="text-xl text-stone-900 mb-3"
                  style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
                >
                  {item.title}
                </h3>
                <p
                  className="text-stone-500 text-sm leading-relaxed"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* NUMBERS — stats bar                          */}
      {/* ============================================ */}
      <section className="py-16 md:py-20 bg-stone-900">
        <div className="px-6 md:px-12 max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-center">
            {[
              { number: '4,100+', label: 'Rare books' },
              { number: '1.6M', label: 'Pages scanned' },
              { number: '81K+', label: 'Pages translated' },
              { number: '71', label: 'Languages' },
              { number: '29K+', label: 'Illustrations' },
            ].map((stat) => (
              <div key={stat.label}>
                <div
                  className="text-3xl md:text-4xl text-amber-400 mb-2"
                  style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300 }}
                >
                  {stat.number}
                </div>
                <div
                  className="text-white/50 text-sm"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* PROVENANCE — institutional credibility        */}
      {/* ============================================ */}
      <section className="py-20 md:py-28 bg-white">
        <div className="px-6 md:px-12 max-w-4xl mx-auto text-center">
          <p
            className="text-amber-700 text-sm tracking-[0.2em] uppercase mb-4"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            Provenance
          </p>
          <h2
            className="text-3xl md:text-4xl text-stone-900 mb-6"
            style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
          >
            Built on the world&apos;s great esoteric collections
          </h2>
          <p
            className="text-lg text-stone-600 max-w-2xl mx-auto mb-12"
            style={{ fontFamily: 'Newsreader, Georgia, serif' }}
          >
            Source Library draws from the Bibliotheca Philosophica Hermetica in Amsterdam — recognized
            by UNESCO&apos;s Memory of the World Register — and 12 other major research libraries
            across Europe and the Americas.
          </p>

          {/* Partner logos */}
          <div className="flex flex-wrap items-center justify-center gap-10 md:gap-14 mb-12">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-14 md:h-20 w-auto object-contain opacity-70"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-18 md:h-24 w-auto object-contain opacity-70"
            />
          </div>

          {/* Source libraries list */}
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-stone-400 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
            {[
              'Internet Archive',
              'Gallica (BnF)',
              'Bavarian State Library',
              'Bodleian Library',
              'Vatican Library',
              'Cambridge Digital Library',
              'HAB Wolfenbüttel',
              'Wellcome Collection',
              'e-rara',
              'Google Books',
            ].map((lib, i) => (
              <span key={lib}>
                {lib}{i < 9 && <span className="ml-6 text-stone-300">&middot;</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* FINAL CTA — email capture                    */}
      {/* ============================================ */}
      <section id="signup" className="py-20 md:py-28 bg-gradient-to-b from-stone-900 to-stone-950">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl text-white mb-6"
            style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
          >
            Be among the first to read these texts
          </h2>
          <p
            className="text-lg text-white/50 mb-10 max-w-xl mx-auto"
            style={{ fontFamily: 'Newsreader, Georgia, serif' }}
          >
            Source Library is opening to early readers. Sign up to be notified
            when the beta launches — and be the first to explore 2,500 years
            of philosophical and esoteric writing, translated into English.
          </p>

          <div className="flex justify-center">
            <EmailForm
              email={email}
              setEmail={setEmail}
              status={status}
              errorMsg={errorMsg}
              onSubmit={handleSubmit}
              variant="dark"
            />
          </div>
          <p className="text-white/20 text-xs mt-4" style={{ fontFamily: 'Inter, sans-serif' }}>
            Free and open access. CC0 Public Domain. No paywall.
          </p>
        </div>
      </section>

      {/* ============================================ */}
      {/* FOOTER                                       */}
      {/* ============================================ */}
      <footer className="py-12 bg-stone-950">
        <div className="px-6 md:px-12 max-w-6xl mx-auto">
          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p
              className="text-white/30 text-sm"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              &copy; {new Date().getFullYear()} Source Library — A project of the Ancient Wisdom Trust
            </p>
            <div className="flex gap-6 text-sm text-white/30" style={{ fontFamily: 'Inter, sans-serif' }}>
              <span>CC0 Public Domain</span>
              <a href="mailto:press@sourcelibrary.org" className="text-amber-500/60 hover:text-amber-400 transition-colors">
                Press inquiries
              </a>
              <a href="mailto:derek@ancientwisdomtrust.org" className="text-amber-500/60 hover:text-amber-400 transition-colors">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
