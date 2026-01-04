'use client';

import Link from 'next/link';

// Fundraising progress
const GOAL = 100000;
const RAISED = 55000;

export default function SupportPage() {
  return (
    <div className="min-h-screen">
      {/* Hero Section - matches front page */}
      <section className="relative h-screen w-full overflow-hidden bg-black">
        {/* Poster image - loads immediately as background */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero-poster.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover z-0"
          fetchPriority="high"
        />

        {/* Video background */}
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover z-0"
        >
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm" type="video/webm" />
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/40 z-0" />

        {/* Header */}
        <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
          <Link href="/" className="text-white flex items-center gap-3">
            <svg className="w-10 h-10 md:w-12 md:h-12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
            </svg>
            <span className="text-xl md:text-2xl uppercase tracking-wider text-white">
              <span className="font-semibold text-white">Source</span>
              <span className="font-light text-white">Library</span>
            </span>
          </Link>
          <Link
            href="/#library"
            className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm text-white rounded-full text-sm font-medium hover:bg-white/20 transition-colors border border-white/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Browse Library
          </Link>
        </header>

        {/* Hero Content */}
        <div className="relative z-10 h-full flex items-center">
          <div className="px-6 md:px-12 max-w-3xl">
            <h1
              className="text-4xl md:text-5xl lg:text-6xl text-white mb-6 leading-tight tracking-wide"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              Help Preserve Ancient Wisdom
            </h1>
            <p className="text-lg md:text-xl font-light text-white/90 leading-relaxed max-w-2xl">
              Your donation funds the digitization and translation of rare texts from the Bibliotheca Philosophica Hermetica.
            </p>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
          <svg className="w-6 h-6 text-white animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* Donation Section */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="max-w-xl">
            {/* Thermometer */}
            <div className="mb-12">
              <div className="flex justify-between items-end mb-3">
                <div>
                  <span className="text-4xl md:text-5xl font-bold text-stone-800">${(RAISED / 1000).toFixed(0)}k</span>
                  <span className="text-stone-500 ml-2">raised</span>
                </div>
                <div className="text-right">
                  <span className="text-stone-400">${(GOAL / 1000).toFixed(0)}k goal</span>
                </div>
              </div>
              <div className="h-3 bg-stone-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-stone-800 rounded-full transition-all duration-500"
                  style={{ width: `${(RAISED / GOAL) * 100}%` }}
                />
              </div>
            </div>

            {/* Donate Buttons */}
            <div className="space-y-4">
              <a
                href="https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center bg-stone-900 hover:bg-stone-800 text-white text-lg py-4 px-6 rounded-full transition-colors"
              >
                Donate Now
              </a>

              <a
                href="mailto:derek@ancientwisdomtrust.org?subject=Source%20Library%20Pledge&body=I%20would%20like%20to%20pledge%20%24_____%20to%20support%20Source%20Library."
                className="block w-full text-center bg-white hover:bg-stone-50 text-stone-700 text-lg py-4 px-6 rounded-full transition-colors border border-stone-300"
              >
                Make a Pledge via Email
              </a>
            </div>

            <p className="text-center text-stone-500 text-sm mt-8">
              Tax-deductible via the Netherland-America Foundation (501c3)
            </p>
          </div>
        </div>
      </section>

      {/* About the Mission */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            Your gift helps transform 2500+ years of wisdom texts into a living archive.
          </h2>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed mb-8">
            Based at the Embassy of the Free Mind in Amsterdam, home to the Bibliotheca Philosophica Hermetica—recognized by UNESCO&apos;s Memory of the World Register—this collection contains rare works on Hermetic philosophy, alchemy, Neoplatonist mystical literature, Rosicrucianism, Freemasonry, and the Kabbalah.
          </p>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
            By digitizing, translating, and freely sharing these works, we aim to spark a new renaissance in the study of philosophy, mysticism, and free thought.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          {/* Partner Logos */}
          <div className="flex items-center gap-8 mb-16">
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-16 md:h-20 w-auto object-contain"
            />
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-20 md:h-24 w-auto object-contain"
            />
          </div>

          {/* Footer Links */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center pt-8 border-t border-stone-300">
            <div className="mb-4 md:mb-0 text-gray-600">
              &copy; {new Date().getFullYear()} Source Library — A project of the Ancient Wisdom Trust
            </div>
            <div className="flex flex-wrap items-center gap-4 md:gap-6 text-gray-600">
              <Link
                href="/"
                className="hover:text-gray-900 transition-colors"
              >
                Home
              </Link>
              <span className="hidden md:inline">•</span>
              <span>CC0 Public Domain</span>
              <span className="hidden md:inline">•</span>
              <a
                href="mailto:derek@ancientwisdomtrust.org"
                className="text-amber-700 hover:text-amber-800 transition-colors"
              >
                derek@ancientwisdomtrust.org
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
