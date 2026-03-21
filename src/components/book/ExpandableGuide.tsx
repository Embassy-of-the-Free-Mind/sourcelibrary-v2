'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BookText, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { books, gallery } from '@/lib/api-client';
import SectionsNav from '@/components/layout/SectionsNav';

interface SectionSummary {
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  quotes?: Array<{ text: string; page: number; page_id?: string; significance?: string }>;
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
  extractedUrl?: string;
  thumbnailUrl?: string;
}

interface ExpandableGuideProps {
  bookId: string;
  /** Detailed summary text, passed from server — renders instantly on expand */
  detailedSummary?: string;
}

export default function ExpandableGuide({ bookId, detailedSummary }: ExpandableGuideProps) {
  const [expanded, setExpanded] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);
  const [sections, setSections] = useState<SectionSummary[]>([]);
  const [illustrations, setIllustrations] = useState<GalleryItem[]>([]);
  const [showSections, setShowSections] = useState(true);
  const [showIllustrations, setShowIllustrations] = useState(true);
  const [pages, setPages] = useState<Array<{ id: string; page_number: number }>>([]);
  const [extrasLoaded, setExtrasLoaded] = useState(false);

  // Lazy-load sections + illustrations when first expanded
  useEffect(() => {
    if (!expanded || extrasLoaded) return;

    setLoadingExtras(true);
    Promise.all([
      books.get(bookId, { full: true }).catch(() => null) as Promise<any>,
      gallery.list({ bookId, limit: 50, minQuality: 0.75 }).catch(() => ({ items: [] })),
    ]).then(([bookData, galleryData]) => {
      const idx = bookData?.index;
      if (idx?.sectionSummaries && Array.isArray(idx.sectionSummaries)) {
        setSections(idx.sectionSummaries);
      }
      if (bookData?.pages) {
        setPages(bookData.pages.map((p: any) => ({ id: p.id || p._id, page_number: p.page_number })));
      }
      setIllustrations(galleryData.items || []);
      setExtrasLoaded(true);
    }).finally(() => setLoadingExtras(false));
  }, [expanded, extrasLoaded, bookId]);

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-2 text-sm font-medium text-accent-rust hover:text-accent-gold-dark transition-colors group"
      >
        <BookText className="w-4 h-4" />
        {expanded ? 'Collapse Reading Guide' : 'Reading Guide: chapter-by-chapter summary, selected quotes and illustrations'}
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
      </button>

      {expanded && (
        <div className="mt-5 space-y-6">
          {/* Detailed Summary — renders instantly from props */}
          {detailedSummary && (
            <div>
              <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Overview</h3>
              <div className="prose-content max-w-none">
                {detailedSummary.split('\n\n').map((p, i) => (
                  <p key={i} className="mb-3 last:mb-0 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{p}</p>
                ))}
              </div>
            </div>
          )}

          {/* Sections — lazy-loaded */}
          {sections.length > 0 && (
            <div>
              <button
                onClick={() => setShowSections(!showSections)}
                className="w-full flex items-center justify-between py-2 text-left"
              >
                <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  Table of Contents
                  <span className="text-xs font-normal text-stone-400">({sections.length} sections)</span>
                </h3>
                {showSections ? (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                )}
              </button>
              {showSections && (
                <SectionsNav
                  bookId={bookId}
                  sections={sections}
                  pages={pages}
                  illustrations={illustrations}
                />
              )}
            </div>
          )}

          {/* Illustrations — lazy-loaded */}
          {illustrations.length > 0 && (
            <div>
              <button
                onClick={() => setShowIllustrations(!showIllustrations)}
                className="w-full flex items-center justify-between py-2 text-left"
              >
                <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  Illustrations
                  <span className="text-xs font-normal text-stone-400">({illustrations.length} images)</span>
                </h3>
                {showIllustrations ? (
                  <ChevronUp className="w-4 h-4 text-stone-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-stone-400" />
                )}
              </button>
              {showIllustrations && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {illustrations.map((item) => {
                    const imageId = `${item.pageId}-${item.detectionIndex}`;
                    const displayUrl = item.extractedUrl || item.thumbnailUrl || item.imageUrl;
                    return (
                      <Link
                        key={imageId}
                        href={`/gallery/image/${imageId}`}
                        className="group relative aspect-square rounded-lg overflow-hidden hover:shadow-md transition-shadow"
                        style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
                      >
                        <Image
                          src={displayUrl}
                          alt={item.description || 'Illustration'}
                          fill
                          sizes="(max-width: 640px) 33vw, 25vw"
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="absolute bottom-0 left-0 right-0 p-1.5 text-white text-[10px] line-clamp-2">
                            {item.description || `Page ${item.pageNumber}`}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 text-center">
                <Link
                  href={`/gallery?bookId=${bookId}`}
                  className="text-xs text-accent-rust hover:text-accent-gold-dark transition-colors"
                >
                  View all in Gallery &rarr;
                </Link>
              </div>
            </div>
          )}

          {loadingExtras && (
            <div className="flex items-center gap-2 text-sm text-stone-400 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading sections & illustrations...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
