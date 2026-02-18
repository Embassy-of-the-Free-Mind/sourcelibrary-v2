'use client';

import Link from 'next/link';

// TODO: Ask NAF for a Source Library-specific DonorPerfect form.
// When available, replace this URL so donors see "Source Library" instead of the generic Embassy form.
const DONORPERFECT_URL = 'https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind';

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

      {/* Donation Pathways */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            Ways to Give
          </h2>
          <p className="text-lg text-stone-600 mb-12 max-w-2xl">
            Every gift directly funds the digitization and translation of rare texts. All donations are tax-deductible for US taxpayers.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1: Donate Online (primary) */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200 flex flex-col">
              <div className="text-2xl mb-2">
                <svg className="w-8 h-8 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-stone-900 mb-2">Donate Online</h3>
              <p className="text-stone-600 text-sm leading-relaxed mb-6 flex-1">
                Secure online donation through the Netherland-America Foundation. Please write <strong>&ldquo;Source Library&rdquo;</strong> in the comments field so your gift is directed to our project.
              </p>
              <a
                href={DONORPERFECT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center bg-stone-900 hover:bg-stone-800 text-white py-3 px-6 rounded-full transition-colors text-base font-medium"
              >
                Donate Now
              </a>
              <p className="text-stone-400 text-xs mt-3 text-center">
                Tax-deductible &middot; 501(c)(3)
              </p>
            </div>

            {/* Card 2: Wire Transfer / Large Gift */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200 flex flex-col">
              <div className="text-2xl mb-2">
                <svg className="w-8 h-8 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-stone-900 mb-2">Wire Transfer or Large Gift</h3>
              <p className="text-stone-600 text-sm leading-relaxed mb-6 flex-1">
                For wire transfers, stock gifts, or donations over $1,000, contact us directly. We&apos;ll provide banking details and a tax receipt.
              </p>
              <a
                href="mailto:derek@ancientwisdomtrust.org?subject=Source%20Library%20%E2%80%94%20Large%20Gift%20Inquiry&body=I%20am%20interested%20in%20making%20a%20gift%20to%20Source%20Library.%20Please%20send%20me%20details."
                className="block w-full text-center bg-white hover:bg-stone-50 text-stone-700 py-3 px-6 rounded-full transition-colors border border-stone-300 text-base font-medium"
              >
                Contact Us
              </a>
            </div>

            {/* Card 3: Support the Embassy */}
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-stone-200 flex flex-col">
              <div className="text-2xl mb-2">
                <svg className="w-8 h-8 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-stone-900 mb-2">Support the Embassy of the Free Mind</h3>
              <p className="text-stone-600 text-sm leading-relaxed mb-6 flex-1">
                Source Library is based at the Embassy of the Free Mind in Amsterdam. You can also support the Embassy directly — your gift helps preserve the Bibliotheca Philosophica Hermetica collection.
              </p>
              <a
                href="https://embassyofthefreemind.com/en/embassy/support-us"
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center bg-white hover:bg-stone-50 text-stone-700 py-3 px-6 rounded-full transition-colors border border-stone-300 text-base font-medium"
              >
                Embassy Website
              </a>
            </div>
          </div>

          {/* 501(c)(3) Disclosure */}
          <div className="mt-12 bg-white/60 rounded-xl border border-stone-200 p-6 md:p-8">
            <h3 className="text-lg font-semibold text-stone-800 mb-2">Tax-Deductible Giving</h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              Donations to Source Library are tax-deductible for US taxpayers. Source Library is fiscally sponsored by the <strong>Netherland-America Foundation, Inc.</strong>, a 501(c)(3) public charity (EIN: 13-2989216). The NAF strengthens bonds between the Netherlands and the United States through educational and cultural programs. Your donation is tax-deductible to the full extent permitted by law.
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
