'use client';

import { useState, useRef, useEffect } from 'react';

// Curated gallery images — diverse sources
const GALLERY_IMAGES = [
  {
    title: 'The Wind Carried Him in Its Belly',
    source: 'Atalanta Fugiens',
    year: '1617',
    thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044154-0-thumb.jpg',
  },
  {
    title: 'The First Key of Basil Valentine',
    source: 'Musaeum Hermeticum',
    year: '1678',
    thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/695203a5ab34727b1f041c53/695203a6ab34727b1f041dea-0-thumb.jpg',
  },
  {
    title: 'Perspective Drawing Machine',
    source: 'Unterweysung der Messung',
    year: '1525',
    image: 'https://sourcelibrary.org/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2Fe532b010-6d2e-40ca-9f95-c67e74c5ee61%2F183.jpg&x=0.063&y=0.119&w=0.898&h=0.491',
  },
  {
    title: 'Fortuna Overcoming Virtue',
    source: 'Emblemata',
    year: '1621',
    image: 'https://sourcelibrary.org/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2Fa0461b95-c56a-463a-beed-a6a2fb11cec2%2F102.jpg&x=0.06&y=0.07&w=0.88&h=0.84',
  },
  {
    title: 'The Ouroboros',
    source: 'Atalanta Fugiens',
    year: '1617',
    thumbnail: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044188-0-thumb.jpg',
  },
  {
    title: 'Alchemical Distillation',
    source: 'Musaeum Hermeticum',
    year: '1678',
    image: 'https://sourcelibrary.org/api/crop-image?url=https%3A%2F%2F3kwioilsplnmnkv8.public.blob.vercel-storage.com%2Farchived%2F695203a5ab34727b1f041c53%2F357.jpg&x=0.118&y=0.279&w=0.448&h=0.433',
  },
];

function EmailForm({
  email, setEmail, status, errorMsg, onSubmit, variant = 'dark',
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
        className={`border rounded-xl p-6 max-w-xl ${variant === 'dark' ? 'bg-white/10 border-white/20' : 'bg-amber-50 border-amber-200'
          }`}
        style={{ fontFamily: 'Inter, sans-serif' }}
      >
        <p className={`text-lg font-medium mb-1 ${variant === 'dark' ? 'text-white' : 'text-stone-900'}`}>
          You&apos;re in.
        </p>
        <p className={`text-sm ${variant === 'dark' ? 'text-white/70' : 'text-stone-600'}`}>
          We&apos;ll send you access when the beta opens.
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
          className={`flex-1 px-5 py-4 rounded-lg text-base focus:outline-none transition-colors ${variant === 'dark'
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    setIsMobile(mobile);
    if (!mobile) videoRef.current?.play().catch(() => { });
  }, []);

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
    <div className="min-h-screen bg-dark">
      {/* ============================================ */}
      {/* HERO                                         */}
      {/* ============================================ */}
      <section className="relative min-h-screen w-full overflow-hidden flex flex-col">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero-poster.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          fetchPriority="high"
        />
        {!isMobile && (
          <video
            ref={videoRef}
            autoPlay loop muted playsInline preload="auto"
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm" type="video/webm" />
            <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4" type="video/mp4" />
          </video>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/80" />

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-6">
          <div className="flex items-center gap-4">
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
            <span className="hidden md:inline text-white/30">|</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="hidden md:block h-8 w-auto opacity-80"
            />
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-white/60" style={{ fontFamily: 'Inter, sans-serif' }}>
            <a href="#demo" className="hover:text-white transition-colors">See It Work</a>
            <a href="#gallery" className="hover:text-white transition-colors">Gallery</a>
            <a href="#signup" className="hover:text-white transition-colors">Get Access</a>
          </div>
        </header>

        {/* Hero content */}
        <div className="relative z-10 flex-1 flex items-center">
          <div className="px-6 md:px-12 w-full max-w-4xl">
            <p
              className="text-amber-400/80 text-lg md:text-xl mb-6"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              Most books written before 1800 have never been translated<br />
              into any modern language.
            </p>
            <h1
              className="text-4xl md:text-5xl lg:text-7xl text-white mb-6 leading-[1.05]"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              We&apos;re bringing them<br />
              <span className="italic font-normal">back to life.</span>
            </h1>
            <p
              className="text-lg md:text-xl text-white/70 leading-relaxed max-w-2xl mb-10"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              Source Library uses AI to translate thousands of rare historical texts —
              early science, philosophy, medicine, alchemy, theology — into modern English.
              Over 4,000 books. 1.6 million pages. 120 books free and open.
              Register for free to access the full collection.
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
              An initiative of the Embassy of the Free Mind, Amsterdam
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
      {/* DEMO — real reader screenshot                */}
      {/* ============================================ */}
      <section id="demo" className="py-20 md:py-28 bg-[#0f0d0a]">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <p
              className="text-amber-500 text-sm tracking-[0.2em] uppercase mb-4"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              See it in action
            </p>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-white mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              A 1,000-page cosmology, translated for the first time
            </h2>
            <p
              className="text-lg text-white/50 max-w-2xl mx-auto"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              Robert Fludd&apos;s <em>Utriusque Cosmi Historia</em> (1617) — a lavishly illustrated
              theory of the universe as a musical instrument. No complete English translation
              has ever been published.
            </p>
          </div>

          {/* Reader screenshot */}
          <div className="max-w-6xl mx-auto">
            <a
              href="https://sourcelibrary.org/book/6952dac677f38f6761bc683a?page=87"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl overflow-hidden shadow-2xl border border-white/10 hover:border-amber-500/30 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/reader-screenshot.png"
                alt="Source Library reader showing Robert Fludd's Utriusque Cosmi Historia (1617) — Latin manuscript on the left, AI-generated English translation on the right"
                className="w-full"
                loading="lazy"
              />
            </a>
            <p className="text-center mt-4 text-white/30 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
              Original manuscript and AI translation, side by side.{' '}
              <a
                href="https://sourcelibrary.org/book/6952dac677f38f6761bc683a?page=87"
                className="text-amber-500/60 hover:text-amber-400 transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                Try the reader &rarr;
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* GALLERY                                      */}
      {/* ============================================ */}
      <section id="gallery" className="py-20 md:py-28 bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              29,000+ illustrations extracted
            </h2>
            <p
              className="text-lg text-stone-600 max-w-2xl mx-auto"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              Emblems, engravings, diagrams, and woodcuts — identified by AI,
              described with museum-quality metadata, and searchable.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
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
                    {item.source}, {item.year}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* STATS                                        */}
      {/* ============================================ */}
      <section className="py-16 md:py-20 bg-stone-900">
        <div className="px-6 md:px-12 max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-center">
            {[
              { number: '4,400+', label: 'Rare books' },
              { number: '1.6M', label: 'Pages scanned' },
              { number: '280K+', label: 'Pages translated' },
              { number: '90+', label: 'Languages' },
              { number: '53K+', label: 'Illustrations' },
            ].map((stat) => (
              <div key={stat.label}>
                <div
                  className="text-3xl md:text-4xl text-amber-400 mb-2"
                  style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300 }}
                >
                  {stat.number}
                </div>
                <div className="text-white/50 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================ */}
      {/* CTA                                          */}
      {/* ============================================ */}
      <section id="signup" className="py-20 md:py-28 bg-gradient-to-b from-stone-900 to-stone-950">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl text-white mb-6"
            style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
          >
            Free to read and cite.
          </h2>
          <p
            className="text-lg text-white/50 mb-10 max-w-xl mx-auto"
            style={{ fontFamily: 'Newsreader, Georgia, serif' }}
          >
            Source Library opens February 22, 2026.
            120 books are completely open — no account needed.
            Register for free to unlock the full collection of over 4,000 texts.
            No payment required, ever.
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
            Free access with registration. No paywall.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-stone-950">
        <div className="px-6 md:px-12 max-w-6xl mx-auto">
          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-white/30 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
              &copy; {new Date().getFullYear()} Source Library
            </p>
            <div className="flex gap-6 text-sm text-white/30" style={{ fontFamily: 'Inter, sans-serif' }}>
              <a href="mailto:press@sourcelibrary.org" className="text-amber-500/60 hover:text-amber-400 transition-colors">
                Press
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
