'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Home, BookOpen } from 'lucide-react';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

const QUOTES = [
  {
    text: 'The lips of Wisdom are closed, except to the ears of Understanding.',
    source: 'The Kybalion',
    href: '/book/the-kybalion-a-study-of-the-hermetic-philosophy-of-ancient-initiates?page=19',
  },
  {
    text: 'We have given you, O Adam, no fixed seat, no form of your own, no specific duty, so that whatever seat, whatever appearance, and whatever duty you yourself desire, you may have according to your own wish and decision.',
    source: 'Pico della Mirandola, Oration on the Dignity of Man',
    href: '/book/oration-on-the-dignity-of-man-mirandola?page=2',
  },
  {
    text: 'I must enter the cloud and admit the coincidence of opposites, beyond all reason, and seek the truth where impossibility presents itself.',
    source: 'Nicholas of Cusa, De Visione Dei',
    href: '/book/de-visione-dei-cusa?page=16',
  },
  {
    text: 'The divine light is always present, always offers itself, and always calls and knocks at the doors of our senses.',
    source: 'Giordano Bruno, Of Heroic Frenzies',
    href: '/book/of-heroic-frenzies-bruno?page=20',
  },
  {
    text: 'He who does not understand, should either be silent or learn.',
    source: 'John Dee, The Hieroglyphic Monad',
    href: '/book/the-hieroglyphic-monad-dee?page=2',
  },
  {
    text: 'It is a most certain truth that what is above is nothing other than that which is below, and vice versa.',
    source: 'Sendivogius, New Chemical Light',
    href: '/book/new-chemical-light-sendivogius?page=37',
  },
  {
    text: 'I compare the whole of philosophy, astrology, and theology to a precious tree that grows in a beautiful paradise.',
    source: 'Jacob Boehme, Aurora (Dawn Rising)',
    href: '/book/dawn-rising-boehme?page=9',
  },
  {
    text: 'The Sky is one, of one and the same essence and substance, both that which is below and that which is above.',
    source: 'Khunrath, Amphitheatre of Eternal Wisdom',
    href: '/book/amphitheater-of-eternal-wisdom-khunrath?page=301',
  },
  {
    text: 'You are inside the wall of Paradise, where the highest spirit of reason guards the gate.',
    source: 'Nicholas of Cusa, De Visione Dei',
    href: '/book/de-visione-dei-cusa?page=16',
  },
  {
    text: 'The Physician is not to burn, but to test all things; once the impurity is removed, the three Substances remain.',
    source: 'Paracelsus, Opus Paramirum',
    href: '/book/paramirum-works-paracelsus?page=105',
  },
];

export default function NotFoundContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [quote, setQuote] = useState(QUOTES[0]);
  const router = useRouter();

  useEffect(() => {
    setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)]);

    // Auto-report the 404 — fire and forget
    const url = window.location.pathname + window.location.search;
    const referrer = document.referrer || undefined;
    fetch('/api/analytics/not-found', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, referrer }),
    }).catch(() => {});
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center px-4 py-12">
      <div className="max-w-xl w-full text-center">
        <h1 className="text-7xl font-bold text-accent-rust/20 mb-2 font-serif">404</h1>
        <h2 className="text-2xl font-serif font-semibold text-primary mb-3">
          Lost in the Stacks
        </h2>
        <Link href={quote.href} className="block text-muted mb-8 italic hover:text-secondary transition-colors group">
          <span>&ldquo;{quote.text}&rdquo;</span>
          <span className="block text-faint text-sm mt-1 not-italic group-hover:text-accent-rust/70 transition-colors">&mdash; {quote.source}</span>
        </Link>

        <div className="bg-white rounded-xl border border-light p-6 mb-6">
          <form onSubmit={handleSearch} className="mb-5">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search the library..."
                className="w-full pl-12 pr-4 py-3 border border-medium rounded-xl focus:outline-none focus:ring-2 focus:ring-accent-rust/40 focus:border-accent-rust/50 text-lg"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full mt-3 bg-accent-rust hover:bg-accent-rust/90 text-white font-medium py-3 px-6 rounded-xl transition-colors"
            >
              Search
            </button>
          </form>

          <div className="flex gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-warm hover:bg-accent-rust/10 text-secondary rounded-xl transition-colors text-sm"
            >
              <Home className="w-4 h-4" />
              Home
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-warm hover:bg-accent-rust/10 text-secondary rounded-xl transition-colors text-sm"
            >
              <BookOpen className="w-4 h-4" />
              Browse
            </Link>
          </div>
        </div>

        <p className="text-xs text-faint">
          Something broken?{' '}
          <FeedbackWidget
            label="Let us know"
            initialMessage="I hit a 404 on: "
            className="text-accent-rust/70 hover:text-accent-rust underline"
          />
        </p>
      </div>
    </div>
  );
}
