'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, ExternalLink, Image as ImageIcon, Pencil, ShieldCheck } from 'lucide-react';
import type { Book, ImageSource, FieldProvenanceEntry } from '@/lib/types';
import { IMAGE_LICENSES } from '@/lib/types';
import BookEditModal from './BookEditModal';
import { useRouter } from 'next/navigation';
import { AuthCheck } from '@/components/auth/AuthCheck';

const FIELD_LABELS: Record<string, string> = {
  display_title: 'Display Title',
  language: 'Language',
  author: 'Author',
  year: 'Year',
  published: 'Published',
  categories: 'Categories',
  description: 'Description',
  subject_keywords: 'Keywords',
  is_first_translation: 'First Translation',
  first_translation: 'First Translation',
  title: 'Title',
  place_published: 'Place Published',
  publisher: 'Publisher',
  publication_place: 'Place Published',
  printer: 'Printer',
  english_title: 'English Title',
  place_of_publication: 'Place Published',
  dublin_core: 'Dublin Core',
  translation_census: 'Translation Census',
  index: 'Index',
};

const SOURCE_LABELS: Record<string, string> = {
  ai_enrichment: 'AI',
  import: 'Import',
  metadata_verification: 'Catalog',
  admin_edit: 'Manual',
  manual: 'Manual',
  ustc_catalog: 'USTC',
  bph_catalogue: 'BPH',
  cross_reference: 'Cross-ref',
  ai_generation: 'AI',
  ustc_enrichments: 'USTC',
};

const SOURCE_COLORS: Record<string, string> = {
  ai_enrichment: 'bg-accent-violet/15 text-accent-violet',
  ai_generation: 'bg-accent-violet/15 text-accent-violet',
  import: 'bg-accent-sage/15 text-accent-sage',
  metadata_verification: 'bg-accent-gold/15 text-accent-gold-dark',
  ustc_catalog: 'bg-accent-gold/15 text-accent-gold-dark',
  ustc_enrichments: 'bg-accent-gold/15 text-accent-gold-dark',
  bph_catalogue: 'bg-accent-gold/15 text-accent-gold-dark',
  cross_reference: 'bg-accent-gold/15 text-accent-gold-dark',
  admin_edit: 'bg-accent-rust/15 text-accent-rust',
  manual: 'bg-accent-rust/15 text-accent-rust',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-status-success',
  medium: 'text-status-warning',
  low: 'text-status-error',
};

function formatProvenanceDate(date: string | Date | undefined): string | null {
  if (!date) return null;
  try {
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function formatPreviousValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function getCatalogUrl(source: string, catalogId: string): string {
  // Some catalog_ids have comma-separated values — take the first
  const id = catalogId.split(',')[0].trim();
  switch (source) {
    case 'open_library':
      return id.startsWith('/')
        ? `https://openlibrary.org${id}`
        : `https://openlibrary.org/works/${id}`;
    case 'google_books':
      return `https://books.google.com/books?id=${id}`;
    case 'internet_archive':
      return `https://archive.org/details/${id}`;
    default:
      return '#';
  }
}

function getCatalogLabel(source: string): string {
  switch (source) {
    case 'open_library': return 'Open Library';
    case 'google_books': return 'Google Books';
    case 'internet_archive': return 'Internet Archive';
    default: return source;
  }
}

interface BibliographicInfoProps {
  book: Book;
  pagesCount: number;
}

export default function BibliographicInfo({ book, pagesCount }: BibliographicInfoProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [provenanceExpanded, setProvenanceExpanded] = useState(false);

  // Format a bibliographic citation
  const formatCitation = () => {
    const parts: string[] = [];

    // Author (last name first if possible)
    if (book.author) {
      parts.push(book.author);
    }

    // Title in italics (original language)
    if (book.title) {
      parts.push(`_${book.title}_`);
    }

    // Publication info
    const pubParts: string[] = [];
    if (book.place_published) pubParts.push(book.place_published);
    if (book.publisher) pubParts.push(book.publisher);
    if (book.published) pubParts.push(book.published);
    if (pubParts.length > 0) {
      parts.push(pubParts.join(': '));
    }

    // Format
    if (book.format) {
      parts.push(book.format);
    }

    // USTC
    if (book.ustc_id) {
      parts.push(`USTC ${book.ustc_id}`);
    }

    return parts.join('. ') + '.';
  };

  const handleCopy = async () => {
    const citation = formatCitation();
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const hasExtraInfo = book.place_published || book.publisher || book.format || book.ustc_id;

  return (
    <div className="mt-4">
      {/* Toggle button and Edit */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm text-stone-400 hover:text-stone-200 transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Bibliographic Info
        </button>
        <AuthCheck role="admin">
          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-1.5 text-sm text-accent-gold hover:text-accent-gold transition-colors"
            title="Edit metadata"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </button>
        </AuthCheck>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 p-4 bg-stone-800/50 rounded-lg border border-stone-700">
          <div className="space-y-2 text-sm">
            {/* Original title */}
            <div className="flex gap-2">
              <span className="text-stone-500 w-24 flex-shrink-0">Title:</span>
              <span className="text-stone-200 italic">{book.title}</span>
            </div>

            {/* Display title if different */}
            {book.display_title && book.display_title !== book.title && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">English:</span>
                <span className="text-stone-200">{book.display_title}</span>
              </div>
            )}

            {/* Author */}
            <div className="flex gap-2">
              <span className="text-stone-500 w-24 flex-shrink-0">Author:</span>
              <span className="text-stone-200">{book.author}</span>
            </div>

            {/* Language */}
            {book.language && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Language:</span>
                <span className="text-stone-200">{book.language}</span>
              </div>
            )}

            {/* Publication details */}
            {book.place_published && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Place:</span>
                <span className="text-stone-200">{book.place_published}</span>
              </div>
            )}

            {book.publisher && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Publisher:</span>
                <span className="text-stone-200">{book.publisher}</span>
              </div>
            )}

            {book.published && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Published:</span>
                <span className="text-stone-200">{book.published}</span>
              </div>
            )}

            {/* Source Work Timeline */}
            {book.source_work_dates && book.source_work_dates.length > 0 && (
              <div className="mt-3 pt-3 border-t border-stone-700/50">
                <span className="text-stone-400 text-xs font-medium uppercase tracking-wide">Source Work</span>
                <div className="mt-2 space-y-1.5">
                  {book.source_work_dates.map((layer, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-stone-500 w-24 flex-shrink-0 capitalize">{layer.type}:</span>
                      <span className="text-stone-200">
                        {layer.author && <span>{layer.author}, </span>}
                        {layer.work_title && <span className="italic">{layer.work_title} </span>}
                        {layer.language && <span className="text-stone-400">({layer.language}, </span>}
                        {layer.date_display}
                        {layer.language && <span className="text-stone-400">)</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Known English Translations */}
            {book.translation_verification?.disposition && (
              <div className="mt-3 pt-3 border-t border-stone-700/50">
                <span className="text-stone-400 text-xs font-medium uppercase tracking-wide">English Translations</span>
                <div className="mt-2 space-y-2">
                  {book.translation_verification.disposition === 'translation_found' && (() => {
                    const translations = book.translation_verification!.validated_translations?.length
                      ? book.translation_verification!.validated_translations
                      : book.translation_verification!.translations || [];
                    return translations
                      .filter(t => t.english_title || t.translator)
                      .map((t, i) => (
                        <div key={i} className="text-sm">
                          <div className="text-stone-200">
                            {t.english_title && (
                              <span className="italic">
                                {t.english_title.length > 100
                                  ? t.english_title.substring(0, 100).replace(/\s+\S*$/, '') + '...'
                                  : t.english_title}
                              </span>
                            )}
                            {t.translator && t.translator !== 'unknown' && t.translator !== 'Not specified' && (
                              <span className="text-stone-400">, trans. {t.translator}</span>
                            )}
                            {t.pub_year && <span className="text-stone-400"> ({t.pub_year})</span>}
                            {t.publisher && <span className="text-stone-500">, {t.publisher}</span>}
                          </div>
                          {t.catalog_id && t.evidence_source && t.evidence_source !== 'llm_knowledge' && (
                            <a
                              href={getCatalogUrl(t.evidence_source, t.catalog_id)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-gold hover:text-accent-gold/80 text-xs inline-flex items-center gap-1 mt-0.5"
                            >
                              View on {getCatalogLabel(t.evidence_source)}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ));
                  })()}
                  {book.translation_verification.disposition === 'confirmed_first' && (
                    <p className="text-stone-500 text-xs">
                      No prior complete English translation found.{' '}
                      <a href="/blog/first-translation-methodology" className="text-accent-gold hover:text-accent-gold/80 underline">
                        How we verify this
                      </a>
                    </p>
                  )}
                </div>
              </div>
            )}

            {book.format && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">Format:</span>
                <span className="text-stone-200">{book.format}</span>
              </div>
            )}

            {/* Pages */}
            <div className="flex gap-2">
              <span className="text-stone-500 w-24 flex-shrink-0">Pages:</span>
              <span className="text-stone-200">{pagesCount}</span>
            </div>

            {/* USTC with link */}
            {book.ustc_id && (
              <div className="flex gap-2">
                <span className="text-stone-500 w-24 flex-shrink-0">USTC:</span>
                <a
                  href={`https://www.ustc.ac.uk/editions/${book.ustc_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-gold hover:text-accent-gold flex items-center gap-1"
                >
                  {book.ustc_id}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {/* Image Source & License */}
          {book.image_source ? (
            <div className="mt-4 pt-4 border-t border-stone-700">
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon className="w-4 h-4 text-stone-400" />
                <span className="text-sm font-medium text-stone-300">Image Source</span>
              </div>
              <div className="space-y-2 text-sm">
                {book.image_source.provider_name && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">Source:</span>
                    {book.image_source.source_url ? (
                      <a
                        href={book.image_source.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-gold hover:text-accent-gold flex items-center gap-1"
                      >
                        {book.image_source.provider_name}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-stone-200">{book.image_source.provider_name}</span>
                    )}
                  </div>
                )}
                {book.image_source.contributing_library && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">Digitized by:</span>
                    <span className="text-stone-200">{book.image_source.contributing_library}</span>
                  </div>
                )}
                {book.image_source.sponsor && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">Sponsor:</span>
                    <span className="text-stone-200">{book.image_source.sponsor}</span>
                  </div>
                )}
                {book.image_source.license && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">License:</span>
                    <span className="text-stone-200">
                      {IMAGE_LICENSES.find(l => l.id === book.image_source?.license)?.name || book.image_source.license}
                    </span>
                  </div>
                )}
                {book.image_source.attribution && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">Credit:</span>
                    <span className="text-stone-200">{book.image_source.attribution}</span>
                  </div>
                )}
                {book.image_source.shelfmark && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">Shelfmark:</span>
                    <span className="text-stone-200">{book.image_source.shelfmark}</span>
                  </div>
                )}
                {book.image_source.iiif_manifest && (
                  <div className="flex gap-2">
                    <span className="text-stone-500 w-24 flex-shrink-0">IIIF:</span>
                    <a
                      href={book.image_source.iiif_manifest}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-gold hover:text-accent-gold flex items-center gap-1"
                    >
                      View manifest
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Data Provenance */}
          {book.field_provenance && Object.keys(book.field_provenance).length > 0 && (
            <div className="mt-4 pt-4 border-t border-stone-700">
              <button
                onClick={() => setProvenanceExpanded(!provenanceExpanded)}
                className="flex items-center gap-2 w-full"
              >
                <ShieldCheck className="w-4 h-4 text-stone-400" />
                <span className="text-sm font-medium text-stone-300">Data Provenance</span>
                <span className="text-xs text-stone-500 ml-1">({Object.keys(book.field_provenance).length} fields)</span>
                <span className="ml-auto">
                  {provenanceExpanded
                    ? <ChevronUp className="w-3.5 h-3.5 text-stone-500" />
                    : <ChevronDown className="w-3.5 h-3.5 text-stone-500" />}
                </span>
              </button>
              {provenanceExpanded && (
                <div className="mt-3 space-y-2">
                  {Object.entries(book.field_provenance).map(([field, entry]) => {
                    const prov = entry as FieldProvenanceEntry;
                    const label = FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    const sourceLabel = SOURCE_LABELS[prov.source] || prov.source;
                    const sourceColor = SOURCE_COLORS[prov.source] || 'bg-stone-700 text-stone-300';
                    const dateStr = formatProvenanceDate(prov.date);
                    const prevVal = formatPreviousValue(prov.previous_value);

                    return (
                      <div key={field} className="flex flex-col gap-1 py-1.5 border-b border-stone-700/30 last:border-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-stone-300 text-sm min-w-[100px]">{label}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${sourceColor}`}>
                            {sourceLabel}
                          </span>
                          {prov.confidence && (
                            <span className={`text-xs ${CONFIDENCE_COLORS[prov.confidence] || 'text-stone-500'}`}>
                              {prov.confidence}
                            </span>
                          )}
                          {dateStr && (
                            <span className="text-xs text-stone-500">{dateStr}</span>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 pl-0.5">
                          {prov.model && (
                            <span className="text-xs text-stone-500 font-mono">{prov.model}</span>
                          )}
                          {prov.provider_name && (
                            <span className="text-xs text-stone-500">{prov.provider_name}</span>
                          )}
                          {prov.pages_checked && (
                            <span className="text-xs text-stone-500">{prov.pages_checked} pages checked</span>
                          )}
                          {prevVal && (
                            <span className="text-xs text-stone-500 italic">was: {prevVal.length > 80 ? prevVal.slice(0, 80) + '...' : prevVal}</span>
                          )}
                          {prov.note && (
                            <span className="text-xs text-stone-500">{prov.note}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Copy citation button */}
          <div className="mt-4 pt-3 border-t border-stone-700">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-1.5 bg-stone-700 hover:bg-stone-600 text-stone-200 rounded-lg text-sm transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-green-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Citation
                </>
              )}
            </button>
            {/* Preview */}
            <p className="mt-2 text-xs text-stone-500 font-mono break-all">
              {formatCitation()}
            </p>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <BookEditModal
          book={book}
          onClose={() => setShowEditModal(false)}
          onSave={() => router.refresh()}
        />
      )}
    </div>
  );
}
