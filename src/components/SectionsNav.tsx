'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Quote, BookOpen, Sparkles } from 'lucide-react';

interface SectionSummary {
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  quotes?: Array<{
    text: string;
    page: number;
    significance?: string;
  }>;
  concepts?: string[];
}

interface SectionsNavProps {
  bookId: string;
  sections: SectionSummary[];
  pages: Array<{ id: string; page_number: number }>;
  currentPage?: number;
}

export default function SectionsNav({ bookId, sections, pages, currentPage }: SectionsNavProps) {
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  if (!sections || sections.length === 0) {
    return null;
  }

  // Find page ID for a given page number
  const getPageId = (pageNumber: number) => {
    const page = pages.find(p => p.page_number === pageNumber);
    return page?.id;
  };

  // Find which section the current page is in
  const currentSectionIndex = currentPage
    ? sections.findIndex(s => currentPage >= s.startPage && currentPage <= s.endPage)
    : -1;

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="p-4 border-b border-stone-100 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-amber-600" />
        <h3 className="font-semibold text-stone-900">Sections</h3>
        <span className="text-xs text-stone-500 ml-auto">{sections.length} sections</span>
      </div>

      <div className="divide-y divide-stone-100">
        {sections.map((section, index) => {
          const isExpanded = expandedSection === index;
          const isCurrent = currentSectionIndex === index;
          const startPageId = getPageId(section.startPage);

          return (
            <div key={index} className={isCurrent ? 'bg-amber-50' : ''}>
              {/* Section Header */}
              <button
                onClick={() => setExpandedSection(isExpanded ? null : index)}
                className="w-full p-4 flex items-start gap-3 hover:bg-stone-50 transition-colors text-left"
              >
                <div className="mt-0.5">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-stone-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-stone-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900 line-clamp-1">
                      {section.title}
                    </span>
                    {isCurrent && (
                      <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded">
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Pages {section.startPage}–{section.endPage}
                  </p>
                </div>
              </button>

              {/* Expanded Section Content */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-4">
                  {/* Summary */}
                  <div className="pl-7">
                    <p className="text-sm text-stone-600 leading-relaxed">
                      {section.summary}
                    </p>
                  </div>

                  {/* Key Concepts */}
                  {section.concepts && section.concepts.length > 0 && (
                    <div className="pl-7">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                          Key Concepts
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {section.concepts.map((concept, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 bg-stone-100 text-stone-700 text-xs rounded"
                          >
                            {concept}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notable Quotes */}
                  {section.quotes && section.quotes.length > 0 && (
                    <div className="pl-7">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Quote className="w-3 h-3 text-amber-500" />
                        <span className="text-xs font-medium text-stone-500 uppercase tracking-wide">
                          Notable Quotes
                        </span>
                      </div>
                      <div className="space-y-3">
                        {section.quotes.slice(0, 3).map((quote, i) => {
                          const quotePageId = getPageId(quote.page);
                          return (
                            <div key={i} className="relative pl-3 border-l-2 border-amber-200">
                              <p className="text-sm text-stone-600 italic">
                                &ldquo;{quote.text}&rdquo;
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                {quotePageId ? (
                                  <Link
                                    href={`/book/${bookId}/page/${quotePageId}`}
                                    className="text-xs text-amber-600 hover:text-amber-700"
                                  >
                                    p. {quote.page}
                                  </Link>
                                ) : (
                                  <span className="text-xs text-stone-400">p. {quote.page}</span>
                                )}
                                {quote.significance && (
                                  <span className="text-xs text-stone-500">
                                    — {quote.significance}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {section.quotes.length > 3 && (
                          <p className="text-xs text-stone-400">
                            +{section.quotes.length - 3} more quotes
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Read Section Link */}
                  {startPageId && (
                    <div className="pl-7 pt-2">
                      <Link
                        href={`/book/${bookId}/page/${startPageId}`}
                        className="inline-flex items-center gap-1.5 text-sm text-amber-600 hover:text-amber-700 font-medium"
                      >
                        <BookOpen className="w-4 h-4" />
                        Read this section
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
