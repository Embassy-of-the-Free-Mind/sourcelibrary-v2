'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronDown, ChevronRight, Quote, BookOpen, Sparkles, ImageIcon } from 'lucide-react';

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

interface GalleryItem {
  pageId: string;
  bookId: string;
  pageNumber: number;
  detectionIndex: number;
  imageUrl: string;
  description: string;
  type?: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

interface SectionsNavProps {
  bookId: string;
  sections: SectionSummary[];
  pages: Array<{ id: string; page_number: number }>;
  currentPage?: number;
  illustrations?: GalleryItem[];
}

export default function SectionsNav({ bookId, sections, pages, currentPage, illustrations = [] }: SectionsNavProps) {
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  if (!sections || sections.length === 0) {
    return null;
  }

  // Find page ID for a given page number
  const getPageId = (pageNumber: number) => {
    const page = pages.find(p => p.page_number === pageNumber);
    return page?.id;
  };

  // Get illustrations for a section's page range
  const getSectionIllustrations = (startPage: number, endPage: number) => {
    return illustrations.filter(img => img.pageNumber >= startPage && img.pageNumber <= endPage);
  };

  // Find which section the current page is in
  const currentSectionIndex = currentPage
    ? sections.findIndex(s => currentPage >= s.startPage && currentPage <= s.endPage)
    : -1;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <div className="p-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
        <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Sections</h3>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>{sections.length} sections</span>
      </div>

      <div>
        {sections.map((section, index) => {
          const isExpanded = expandedSection === index;
          const isCurrent = currentSectionIndex === index;
          const startPageId = getPageId(section.startPage);

          return (
            <div
              key={index}
              style={{
                background: isCurrent ? 'var(--bg-warm)' : 'transparent',
                borderTop: index > 0 ? '1px solid var(--border-light)' : 'none'
              }}
            >
              {/* Section Header */}
              <button
                onClick={() => setExpandedSection(isExpanded ? null : index)}
                className="w-full p-4 flex items-start gap-3 transition-colors text-left hover:opacity-80"
              >
                <div className="mt-0.5">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  ) : (
                    <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium line-clamp-1" style={{ color: 'var(--text-primary)' }}>
                      {section.title}
                    </span>
                    {isCurrent && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-gold)', color: 'white' }}>
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Pages {section.startPage}–{section.endPage}
                  </p>
                </div>
              </button>

              {/* Expanded Section Content */}
              {isExpanded && (() => {
                const sectionImages = getSectionIllustrations(section.startPage, section.endPage);
                return (
                <div className="px-4 pb-4 space-y-4">
                  {/* Section Illustrations */}
                  {sectionImages.length > 0 && (
                    <div className="pl-7">
                      <div className="flex items-center gap-1.5 mb-2">
                        <ImageIcon className="w-3 h-3" style={{ color: 'var(--accent-rust)' }} />
                        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                          Illustrations
                        </span>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {sectionImages.slice(0, 4).map((item) => {
                          const imageId = `${item.pageId}:${item.detectionIndex}`;
                          const cropUrl = item.bbox
                            ? `/api/crop-image?url=${encodeURIComponent(item.imageUrl)}&x=${item.bbox.x}&y=${item.bbox.y}&w=${item.bbox.width}&h=${item.bbox.height}`
                            : item.imageUrl;
                          return (
                            <Link
                              key={imageId}
                              href={`/gallery/image/${imageId}`}
                              className="flex-shrink-0 relative w-16 h-16 rounded-lg overflow-hidden transition-all hover:ring-2"
                              style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                            >
                              <Image
                                src={cropUrl}
                                alt={item.description || `Page ${item.pageNumber}`}
                                fill
                                sizes="64px"
                                className="object-cover"
                              />
                            </Link>
                          );
                        })}
                        {sectionImages.length > 4 && (
                          <div
                            className="flex-shrink-0 w-16 h-16 rounded-lg flex items-center justify-center text-xs"
                            style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}
                          >
                            +{sectionImages.length - 4}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Summary */}
                  <div className="pl-7">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {section.summary}
                    </p>
                  </div>

                  {/* Key Concepts */}
                  {section.concepts && section.concepts.length > 0 && (
                    <div className="pl-7">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Sparkles className="w-3 h-3" style={{ color: 'var(--accent-gold)' }} />
                        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                          Key Concepts
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {section.concepts.map((concept, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 text-xs rounded"
                            style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
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
                        <Quote className="w-3 h-3" style={{ color: 'var(--accent-gold)' }} />
                        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                          Notable Quotes
                        </span>
                      </div>
                      <div className="space-y-3">
                        {section.quotes.slice(0, 3).map((quote, i) => {
                          const quotePageId = getPageId(quote.page);
                          return (
                            <div key={i} className="relative pl-3" style={{ borderLeft: '2px solid var(--accent-gold)' }}>
                              <p className="text-sm italic" style={{ color: 'var(--text-secondary)' }}>
                                &ldquo;{quote.text}&rdquo;
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                {quotePageId ? (
                                  <Link
                                    href={`/book/${bookId}/page/${quotePageId}`}
                                    className="text-xs hover:opacity-70"
                                    style={{ color: 'var(--accent-rust)' }}
                                  >
                                    p. {quote.page}
                                  </Link>
                                ) : (
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>p. {quote.page}</span>
                                )}
                                {quote.significance && (
                                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                    — {quote.significance}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {section.quotes.length > 3 && (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
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
                        className="inline-flex items-center gap-1.5 text-sm font-medium hover:opacity-70"
                        style={{ color: 'var(--accent-rust)' }}
                      >
                        <BookOpen className="w-4 h-4" />
                        Read this section
                      </Link>
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
