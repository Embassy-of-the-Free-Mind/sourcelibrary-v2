'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Loader2, Sparkles, ChevronRight, Quote } from 'lucide-react';
import { Book, Page, Section } from '@/lib/types';

interface ReadPageProps {
  params: Promise<{ id: string }>;
}

export default function ReadPage({ params }: ReadPageProps) {
  const [bookId, setBookId] = useState<string | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve params
  useEffect(() => {
    params.then(p => setBookId(p.id));
  }, [params]);

  // Fetch book data
  useEffect(() => {
    if (!bookId) return;

    async function fetchData() {
      try {
        setLoading(true);

        // Fetch book with pages
        const bookRes = await fetch(`/api/books/${bookId}`);
        if (!bookRes.ok) throw new Error('Book not found');
        const bookData = await bookRes.json();
        setBook(bookData);
        setPages(bookData.pages || []);

        // Fetch sections
        const sectionsRes = await fetch(`/api/books/${bookId}/sections`);
        if (sectionsRes.ok) {
          const sectionsData = await sectionsRes.json();
          setSections(sectionsData.sections || []);
        }

        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [bookId]);

  // Generate summary for a section
  const generateSectionSummary = async (section: Section) => {
    setGeneratingSection(section.id);

    try {
      const response = await fetch(`/api/books/${bookId}/sections/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId: section.id,
          startPage: section.startPage,
          endPage: section.endPage
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate');
      }

      const data = await response.json();

      // Update local state
      setSections(prev => prev.map(s =>
        s.id === section.id
          ? { ...s, summary: data.summary, quotes: data.quotes, concepts: data.concepts, generated_at: new Date() }
          : s
      ));
    } catch (err) {
      console.error('Error generating summary:', err);
    } finally {
      setGeneratingSection(null);
    }
  };

  // Generate all missing summaries
  const generateAllSummaries = async () => {
    for (const section of sections) {
      if (!section.summary) {
        await generateSectionSummary(section);
      }
    }
  };

  // Count translated pages per section
  const getTranslatedCount = (section: Section) => {
    return pages.filter(
      p => p.page_number >= section.startPage &&
           p.page_number <= section.endPage &&
           p.translation?.data
    ).length;
  };

  const sectionsNeedingSummaries = sections.filter(s => !s.summary).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <BookOpen className="w-12 h-12 text-stone-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Book Not Found</h1>
          <Link href="/" className="text-amber-600 hover:text-amber-700">
            Back to Library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link
              href={`/book/${bookId}`}
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back to Book</span>
            </Link>

            {sectionsNeedingSummaries > 0 && (
              <button
                onClick={generateAllSummaries}
                disabled={!!generatingSection}
                className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm"
              >
                <Sparkles className="w-4 h-4" />
                Generate All Summaries
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Book info */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white py-8 sm:py-12">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold">
            {book.display_title || book.title}
          </h1>
          <p className="text-stone-300 mt-2">{book.author}</p>
          <p className="text-stone-400 text-sm mt-4">
            Reading Guide · {sections.length} section{sections.length !== 1 ? 's' : ''} · {pages.length} pages
          </p>
        </div>
      </div>

      {/* Sections */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-6">
          {sections.map((section, index) => {
            const translatedCount = getTranslatedCount(section);
            const totalPages = section.endPage - section.startPage + 1;
            const isGenerating = generatingSection === section.id;
            const hasSummary = !!section.summary;

            return (
              <div
                key={section.id}
                className="bg-white rounded-xl border border-stone-200 overflow-hidden"
              >
                {/* Section header */}
                <div className="p-4 sm:p-6 border-b border-stone-100">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-stone-400 mb-1">
                        Section {index + 1}
                      </div>
                      <h2 className="text-lg sm:text-xl font-serif font-semibold text-stone-900">
                        {section.title}
                      </h2>
                      <p className="text-sm text-stone-500 mt-1">
                        Pages {section.startPage}–{section.endPage}
                        {translatedCount > 0 && (
                          <span className="ml-2 text-green-600">
                            · {translatedCount}/{totalPages} translated
                          </span>
                        )}
                      </p>
                    </div>

                    <Link
                      href={`/book/${bookId}/page/${pages.find(p => p.page_number === section.startPage)?.id || ''}`}
                      className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-sm text-amber-700 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                      Read
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>

                {/* Summary content */}
                <div className="p-4 sm:p-6">
                  {isGenerating ? (
                    <div className="flex items-center gap-3 text-stone-500 py-4">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Generating summary...</span>
                    </div>
                  ) : hasSummary ? (
                    <div className="space-y-4">
                      {/* Summary text */}
                      <div className="prose prose-stone prose-sm max-w-none">
                        {section.summary!.split('\n\n').map((p, i) => (
                          <p key={i} className="text-stone-700 leading-relaxed">{p}</p>
                        ))}
                      </div>

                      {/* Key quotes */}
                      {section.quotes && section.quotes.length > 0 && (
                        <div className="mt-6 space-y-3">
                          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                            Key Quotes
                          </h3>
                          {section.quotes.map((quote, i) => (
                            <blockquote
                              key={i}
                              className="relative pl-4 border-l-2 border-amber-300 text-stone-600 italic"
                            >
                              <Quote className="absolute -left-1.5 -top-1 w-3 h-3 text-amber-400 bg-white" />
                              <p className="text-sm leading-relaxed">&ldquo;{quote.text}&rdquo;</p>
                              <cite className="block text-xs text-stone-400 mt-1 not-italic">
                                — Page {quote.page}
                              </cite>
                            </blockquote>
                          ))}
                        </div>
                      )}

                      {/* Key concepts */}
                      {section.concepts && section.concepts.length > 0 && (
                        <div className="mt-4">
                          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                            Key Concepts
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {section.concepts.map((concept, i) => (
                              <span
                                key={i}
                                className="px-2 py-1 bg-stone-100 text-stone-700 text-xs rounded-full"
                              >
                                {concept}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : translatedCount > 0 ? (
                    <button
                      onClick={() => generateSectionSummary(section)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm text-amber-700 hover:text-amber-800 hover:bg-amber-50 rounded-lg transition-colors"
                    >
                      <Sparkles className="w-4 h-4" />
                      Generate Summary
                    </button>
                  ) : (
                    <p className="text-sm text-stone-400 italic">
                      Translate pages to generate a summary
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {sections.length === 0 && (
            <div className="text-center py-12 text-stone-500">
              <BookOpen className="w-12 h-12 mx-auto mb-4 text-stone-300" />
              <p>No sections detected yet.</p>
              <p className="text-sm mt-1">Sections are auto-detected from chapter headings in the OCR.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
