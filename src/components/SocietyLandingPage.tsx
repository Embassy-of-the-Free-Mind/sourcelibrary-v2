'use client';

import Link from 'next/link';
import SocietyHeroSection from './SocietyHeroSection';

// Featured texts to show as glimpses
const FEATURED_GLIMPSES = [
  {
    title: 'Corpus Hermeticum',
    author: 'Hermes Trismegistus',
    year: '2nd-3rd c.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Hermes_mercurius_trismegistus_siena_cathedral.jpg/440px-Hermes_mercurius_trismegistus_siena_cathedral.jpg',
    status: 'Available',
  },
  {
    title: 'Arbatel de Magia Veterum',
    author: 'Anonymous',
    year: '1575',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Arbatel_De_magia_veterum_%281575%29.jpg/440px-Arbatel_De_magia_veterum_%281575%29.jpg',
    status: 'Newly Translated',
  },
  {
    title: 'De Occulta Philosophia',
    author: 'Heinrich Cornelius Agrippa',
    year: '1533',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/De_Occulta_Philosophia_libri_III.jpg/440px-De_Occulta_Philosophia_libri_III.jpg',
    status: 'In Progress',
  },
  {
    title: 'Atalanta Fugiens',
    author: 'Michael Maier',
    year: '1617',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/Michael_Maier_Atalanta_Fugiens.jpeg/500px-Michael_Maier_Atalanta_Fugiens.jpeg',
    status: 'Available',
  },
];

const MEMBERSHIP_TIERS = [
  {
    name: 'Seeker',
    tagline: 'Begin the journey',
    price: 'Free',
    description: 'Explore the catalog and read foundational texts',
    features: [
      'Browse the full catalog',
      'Read 15 gateway texts (Corpus Hermeticum, Emerald Tablet, etc.)',
      'Join public discussions',
    ],
    cta: 'Start Exploring',
    highlight: false,
  },
  {
    name: 'Student',
    tagline: 'Full access',
    price: '$15/month',
    description: 'Unlock the entire library and join the community',
    features: [
      'Full access to all translated texts',
      'Community forum & reading groups',
      'Personal library & annotations',
      'One membership pass to gift',
      'Vote on translation priorities',
    ],
    cta: 'Become a Student',
    highlight: true,
  },
  {
    name: 'Adept',
    tagline: 'Earned through contribution',
    price: 'Earned',
    description: 'Recognition for those who contribute meaningfully',
    features: [
      'Everything in Student',
      'Early access to new translations',
      'Access to original scans',
      '3 membership passes to gift',
      'Name in translation credits',
    ],
    cta: 'Learn How to Earn',
    highlight: false,
  },
  {
    name: 'Fellow',
    tagline: 'By invitation',
    price: 'Invited',
    description: 'For scholars and major contributors',
    features: [
      'Everything in Adept',
      'Direct input on acquisitions',
      'Unlimited membership passes',
      'Private channel with the team',
      'Lifetime free access',
    ],
    cta: 'Nominate a Scholar',
    highlight: false,
  },
];

const RECENT_TRANSLATIONS = [
  { title: 'Splendor Solis', pages: 42, date: 'Dec 2025' },
  { title: 'Theatrum Chemicum', pages: 156, date: 'Nov 2025' },
  { title: 'Aurora Consurgens', pages: 88, date: 'Nov 2025' },
  { title: 'Rosarium Philosophorum', pages: 64, date: 'Oct 2025' },
];

export default function SocietyLandingPage() {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Hero Section */}
      <SocietyHeroSection />

      {/* What's Inside Section */}
      <section id="what-inside" className="py-20 md:py-28 bg-gradient-to-b from-stone-100 to-stone-50">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p
              className="text-amber-700 text-sm tracking-widest uppercase mb-4"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              The Collection
            </p>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-6"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              Rare texts, freshly translated
            </h2>
            <p
              className="text-lg text-stone-600 max-w-2xl mx-auto"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              From the Hermetic corpus to Renaissance alchemical manuscripts—works that
              shaped Western esotericism, now accessible in English.
            </p>
          </div>

          {/* Featured texts grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {FEATURED_GLIMPSES.map((text) => (
              <div
                key={text.title}
                className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow"
              >
                <div className="aspect-[3/4] overflow-hidden">
                  <img
                    src={text.image}
                    alt={text.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <span
                    className={`inline-block px-2 py-1 text-[10px] uppercase tracking-wider rounded mb-2 ${
                      text.status === 'Newly Translated'
                        ? 'bg-amber-500 text-white'
                        : text.status === 'In Progress'
                        ? 'bg-stone-600 text-white'
                        : 'bg-white/20 text-white backdrop-blur-sm'
                    }`}
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    {text.status}
                  </span>
                  <h3
                    className="text-white text-lg mb-1"
                    style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
                  >
                    {text.title}
                  </h3>
                  <p className="text-white/70 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                    {text.author}, {text.year}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link
              href="/library"
              className="inline-flex items-center gap-2 text-amber-700 hover:text-amber-800 font-medium"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              Browse the full catalog
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Membership Tiers Section */}
      <section id="membership" className="py-20 md:py-28 bg-white">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p
              className="text-amber-700 text-sm tracking-widest uppercase mb-4"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              Membership
            </p>
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-6"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              A path of deepening engagement
            </h2>
            <p
              className="text-lg text-stone-600 max-w-2xl mx-auto"
              style={{ fontFamily: 'Newsreader, Georgia, serif' }}
            >
              Progress through contribution, not just payment. Each tier unlocks more access
              and more ways to shape the library&apos;s future.
            </p>
          </div>

          {/* Tiers grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {MEMBERSHIP_TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl p-6 ${
                  tier.highlight
                    ? 'bg-stone-900 text-white ring-2 ring-amber-500'
                    : 'bg-stone-50 text-stone-900 border border-stone-200'
                }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span
                      className="bg-amber-500 text-white text-xs px-3 py-1 rounded-full"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3
                    className="text-2xl mb-1"
                    style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
                  >
                    {tier.name}
                  </h3>
                  <p
                    className={`text-sm ${tier.highlight ? 'text-white/60' : 'text-stone-500'}`}
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    {tier.tagline}
                  </p>
                </div>

                <div className="mb-6">
                  <span
                    className={`text-3xl font-light ${tier.highlight ? 'text-amber-400' : 'text-amber-700'}`}
                    style={{ fontFamily: 'Cormorant Garamond, serif' }}
                  >
                    {tier.price}
                  </span>
                </div>

                <p
                  className={`text-sm mb-6 ${tier.highlight ? 'text-white/70' : 'text-stone-600'}`}
                  style={{ fontFamily: 'Newsreader, serif' }}
                >
                  {tier.description}
                </p>

                <ul className="space-y-3 mb-8">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-start gap-2 text-sm ${
                        tier.highlight ? 'text-white/80' : 'text-stone-600'
                      }`}
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      <svg
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          tier.highlight ? 'text-amber-400' : 'text-amber-600'
                        }`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  className={`w-full py-3 rounded-lg font-medium transition-colors ${
                    tier.highlight
                      ? 'bg-amber-500 hover:bg-amber-400 text-stone-900'
                      : 'bg-stone-900 hover:bg-stone-800 text-white'
                  }`}
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Collective Section */}
      <section id="collective" className="py-20 md:py-28 bg-stone-900 text-white">
        <div className="px-6 md:px-12 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <p
                className="text-amber-400 text-sm tracking-widest uppercase mb-4"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                The Collective Fund
              </p>
              <h2
                className="text-3xl md:text-4xl text-white mb-6"
                style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
              >
                Your membership directly commissions new translations
              </h2>
              <p
                className="text-lg text-white/70 mb-8"
                style={{ fontFamily: 'Newsreader, Georgia, serif' }}
              >
                Every dollar goes into the collective fund. Members vote on priorities.
                Translators are paid for their work. New texts are published freely
                at Source Library for everyone.
              </p>

              <div className="space-y-4 mb-8">
                <div className="flex justify-between items-center py-3 border-b border-white/10">
                  <span style={{ fontFamily: 'Inter, sans-serif' }}>Translation work</span>
                  <span className="text-amber-400" style={{ fontFamily: 'Cormorant Garamond, serif' }}>65%</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-white/10">
                  <span style={{ fontFamily: 'Inter, sans-serif' }}>Digitization & OCR</span>
                  <span className="text-amber-400" style={{ fontFamily: 'Cormorant Garamond, serif' }}>20%</span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-white/10">
                  <span style={{ fontFamily: 'Inter, sans-serif' }}>Platform & community</span>
                  <span className="text-amber-400" style={{ fontFamily: 'Cormorant Garamond, serif' }}>15%</span>
                </div>
              </div>

              <Link
                href="/transparency"
                className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                See full transparency report
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
            </div>

            <div className="bg-stone-800 rounded-2xl p-8">
              <h3
                className="text-xl text-white mb-6"
                style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
              >
                Recently Funded Translations
              </h3>
              <div className="space-y-4">
                {RECENT_TRANSLATIONS.map((translation) => (
                  <div
                    key={translation.title}
                    className="flex justify-between items-center py-3 border-b border-white/10 last:border-0"
                  >
                    <div>
                      <p className="text-white" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                        {translation.title}
                      </p>
                      <p className="text-white/50 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                        {translation.pages} pages
                      </p>
                    </div>
                    <span
                      className="text-white/50 text-sm"
                      style={{ fontFamily: 'Inter, sans-serif' }}
                    >
                      {translation.date}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-white/10">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-white/60 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                    This month&apos;s fund
                  </span>
                  <span
                    className="text-2xl text-amber-400"
                    style={{ fontFamily: 'Cormorant Garamond, serif' }}
                  >
                    $2,847
                  </span>
                </div>
                <div className="h-2 bg-stone-700 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: '71%' }} />
                </div>
                <p className="text-white/50 text-xs mt-2" style={{ fontFamily: 'Inter, sans-serif' }}>
                  71% of monthly goal
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Pass System */}
      <section className="py-20 md:py-28 bg-gradient-to-b from-stone-50 to-white">
        <div className="px-6 md:px-12 max-w-4xl mx-auto text-center">
          <p
            className="text-amber-700 text-sm tracking-widest uppercase mb-4"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            The Pass
          </p>
          <h2
            className="text-3xl md:text-4xl text-stone-900 mb-6"
            style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
          >
            One hand reaches to another
          </h2>
          <p
            className="text-lg text-stone-600 mb-12 max-w-2xl mx-auto"
            style={{ fontFamily: 'Newsreader, Georgia, serif' }}
          >
            When you join as a Student, you receive a pass—a key to give to someone you
            believe should be here. Knowledge spreads through relationship, not broadcast.
            This is how these traditions have always moved.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-amber-700" style={{ fontFamily: 'Cormorant Garamond, serif' }}>1</span>
              </div>
              <h3
                className="text-lg text-stone-900 mb-2"
                style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
              >
                You join
              </h3>
              <p className="text-stone-600 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                Become a Student member and receive one pass
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-amber-700" style={{ fontFamily: 'Cormorant Garamond, serif' }}>2</span>
              </div>
              <h3
                className="text-lg text-stone-900 mb-2"
                style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
              >
                You gift
              </h3>
              <p className="text-stone-600 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                Give your pass to someone who should be here
              </p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-amber-700" style={{ fontFamily: 'Cormorant Garamond, serif' }}>3</span>
              </div>
              <h3
                className="text-lg text-stone-900 mb-2"
                style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
              >
                They continue
              </h3>
              <p className="text-stone-600 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                They receive their own pass to give forward
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 md:py-28 bg-stone-900">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl text-white mb-6"
            style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
          >
            Join the society translating the Western esoteric tradition
          </h2>
          <p
            className="text-lg text-white/70 mb-10"
            style={{ fontFamily: 'Newsreader, Georgia, serif' }}
          >
            Your membership funds the work. You decide what we translate next.
            And you get to read texts that have been locked in Latin for 500 years.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/apply"
              className="px-8 py-4 bg-amber-500 hover:bg-amber-400 text-stone-900 rounded-lg text-base font-medium transition-colors"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              Apply for Membership
            </Link>
            <Link
              href="/auth/signin"
              className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white rounded-lg text-base font-medium transition-colors border border-white/20"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 bg-stone-950 text-white/60">
        <div className="px-6 md:px-12 max-w-6xl mx-auto">
          {/* Partner Logos */}
          <div className="flex items-center justify-center gap-8 mb-12">
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-12 md:h-16 w-auto object-contain opacity-60 hover:opacity-100 transition-opacity"
            />
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-16 md:h-20 w-auto object-contain opacity-60 hover:opacity-100 transition-opacity"
            />
          </div>

          <div className="border-t border-white/10 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <p className="text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                &copy; {new Date().getFullYear()} The Ficino Society — A project of the Ancient Wisdom Trust
              </p>
              <div className="flex gap-6 text-sm" style={{ fontFamily: 'Inter, sans-serif' }}>
                <Link href="/about" className="hover:text-white transition-colors">About</Link>
                <Link href="/transparency" className="hover:text-white transition-colors">Transparency</Link>
                <a href="https://sourcelibrary.org" className="hover:text-white transition-colors">Source Library</a>
                <a href="mailto:derek@ancientwisdomtrust.org" className="text-amber-400 hover:text-amber-300 transition-colors">
                  Contact
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
