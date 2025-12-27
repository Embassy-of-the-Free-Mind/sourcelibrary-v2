'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, BookOpen, Scroll, Compass, FlaskConical, Calculator, Star, Loader2 } from 'lucide-react';

interface RoadmapBook {
  title: string;
  display_title: string;
  author: string;
  language: string;
  ia_identifier: string;
  source_url: string;
  categories: string[];
  priority: number;
  notes: string;
  in_database: boolean;
}

interface RoadmapData {
  total: number;
  in_database: number;
  pending: number;
  books: RoadmapBook[];
}

// Section configuration for grouping books by priority
const PRIORITY_SECTIONS = [
  {
    priority: 1,
    id: 'foundational',
    title: 'Foundational Texts',
    description: 'Core texts of Hermeticism, Florentine Platonism, and Christian Cabala. The essential foundations of Renaissance esotericism.',
    icon: <Star className="w-6 h-6" />,
  },
  {
    priority: 2,
    id: 'major-collections',
    title: 'Major Collections',
    description: 'Alchemical compilations, Paracelsian works, and significant manuscript collections.',
    icon: <Scroll className="w-6 h-6" />,
  },
  {
    priority: 3,
    id: 'ritual-kabbalah',
    title: 'Ritual Magic & Kabbalah',
    description: 'Ceremonial magic and Kabbalistic texts that shaped Western esotericism.',
    icon: <Compass className="w-6 h-6" />,
  },
  {
    priority: 4,
    id: 'christian-mysticism',
    title: 'Christian Mysticism',
    description: 'Jakob Böhme and the theosophical tradition.',
    icon: <FlaskConical className="w-6 h-6" />,
  },
  {
    priority: 5,
    id: 'encyclopedic',
    title: 'Encyclopedic Works',
    description: 'Athanasius Kircher and the Baroque synthesis of all knowledge.',
    icon: <Calculator className="w-6 h-6" />,
  },
];

export default function RoadmapPage() {
  const [data, setData] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRoadmap() {
      try {
        const res = await fetch('/api/books/roadmap');
        if (!res.ok) throw new Error('Failed to fetch roadmap');
        const roadmapData = await res.json();
        setData(roadmapData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load roadmap');
      } finally {
        setLoading(false);
      }
    }
    fetchRoadmap();
  }, []);

  // Group books by priority
  const booksByPriority = data?.books.reduce((acc, book) => {
    const priority = book.priority || 3;
    if (!acc[priority]) acc[priority] = [];
    acc[priority].push(book);
    return acc;
  }, {} as Record<number, RoadmapBook[]>) || {};

  // Stats from API data
  const totalWorks = data?.total || 0;
  const inDatabase = data?.in_database || 0;
  const pending = data?.pending || 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold mb-4">
            Translation Roadmap
          </h1>
          <p className="text-stone-300 max-w-3xl text-lg">
            Our prioritized list of the most influential texts in the history of philosophy,
            mathematics, and natural science. We focus on the earliest available editions
            from the Internet Archive, bringing foundational works into modern accessibility.
          </p>

          {/* Stats */}
          <div className="flex gap-8 mt-8">
            <div>
              <div className="text-3xl font-bold text-amber-400">{totalWorks}</div>
              <div className="text-sm text-stone-400">Total Works</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-amber-400">{inDatabase}</div>
              <div className="text-sm text-stone-400">In Database</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-amber-400">{pending}</div>
              <div className="text-sm text-stone-400">Pending</div>
            </div>
          </div>
        </div>
      </div>

      {/* Mission Statement */}
      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <h2 className="text-xl font-serif font-semibold text-stone-800 mb-3">
            Our Mission
          </h2>
          <p className="text-stone-700 leading-relaxed">
            Less than 3% of Renaissance Latin literature has ever been translated.
            Source Library aims to digitize, OCR, and translate the foundational texts
            of Western thought—starting with the earliest printed editions of ancient
            philosophy, medieval science, and Renaissance wisdom. These are the works
            that shaped Copernicus, Kepler, Newton, and the Scientific Revolution.
          </p>
        </div>
      </div>

      {/* Roadmap Sections */}
      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Table of Contents */}
        <nav className="mb-12 p-6 bg-white rounded-xl border border-stone-200">
          <h2 className="text-lg font-semibold text-stone-800 mb-4">Contents</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PRIORITY_SECTIONS.filter(section => booksByPriority[section.priority]?.length > 0).map(section => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-stone-50 transition-colors group"
              >
                <span className="text-amber-600">{section.icon}</span>
                <div>
                  <div className="font-medium text-stone-800 group-hover:text-amber-700">
                    {section.title}
                  </div>
                  <div className="text-sm text-stone-500">
                    {booksByPriority[section.priority]?.length || 0} works
                  </div>
                </div>
              </a>
            ))}
          </div>
        </nav>

        {/* Sections */}
        <div className="space-y-16">
          {PRIORITY_SECTIONS.filter(section => booksByPriority[section.priority]?.length > 0).map(section => (
            <section key={section.id} id={section.id}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-amber-600">{section.icon}</span>
                <h2 className="text-2xl font-serif font-bold text-stone-800">
                  {section.title}
                </h2>
              </div>
              <p className="text-stone-600 mb-6 max-w-3xl">
                {section.description}
              </p>

              <div className="space-y-4">
                {booksByPriority[section.priority]?.map((book) => (
                  <div
                    key={book.ia_identifier}
                    className="bg-white rounded-xl border border-stone-200 p-5 hover:border-amber-200 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {section.priority === 1 && <span className="text-amber-500" title="High Priority">★</span>}
                          <h3 className="font-semibold text-stone-900">
                            {book.author}
                          </h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${
                            book.in_database
                              ? 'bg-green-100 text-green-800 border-green-200'
                              : 'bg-stone-100 text-stone-600 border-stone-200'
                          }`}>
                            {book.in_database ? 'In Database' : 'Planned'}
                          </span>
                        </div>
                        <div className="text-lg text-amber-800 font-medium">
                          {book.display_title || book.title}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-stone-600">
                          <span>Language: {book.language}</span>
                          {book.categories?.length > 0 && (
                            <span>Categories: {book.categories.join(', ')}</span>
                          )}
                        </div>
                        {book.notes && (
                          <p className="mt-3 text-stone-700 leading-relaxed">
                            {book.notes}
                          </p>
                        )}
                      </div>
                      {book.source_url && (
                        <a
                          href={book.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 p-2 text-stone-400 hover:text-amber-600 transition-colors"
                          title="View on Internet Archive"
                        >
                          <ExternalLink className="w-5 h-5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Call to Action */}
        <div className="mt-16 bg-gradient-to-r from-stone-800 to-stone-900 rounded-2xl p-8 text-white">
          <h2 className="text-2xl font-serif font-bold mb-4">
            Help Build the Library
          </h2>
          <p className="text-stone-300 mb-6 max-w-2xl">
            Source Library is a project of the Ancient Wisdom Trust, working in partnership
            with the Embassy of the Free Mind. We seek patrons, scholars, and volunteers
            to help digitize and translate the foundational texts of human thought.
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href="mailto:derek@ancientwisdomtrust.org"
              className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              <BookOpen className="w-5 h-5" />
              Get Involved
            </a>
            <a
              href="https://archive.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-lg font-medium transition-colors"
            >
              <ExternalLink className="w-5 h-5" />
              Browse Internet Archive
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <p className="text-sm text-stone-500">
            Roadmap inspired by{' '}
            <a
              href="https://secondrenaissance.ai/blog/roadmap"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-700 hover:text-amber-800"
            >
              Second Renaissance Research
            </a>
            . All source texts are in the public domain.
          </p>
        </div>
      </footer>
    </div>
  );
}
