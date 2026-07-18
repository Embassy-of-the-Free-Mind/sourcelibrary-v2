'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Camera, Upload, Loader2, ExternalLink } from 'lucide-react';
import SiteHeader from '@/components/layout/SiteHeader';
import { bookUrl } from '@/lib/slugify';

interface Match {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  published?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  match_image?: string;
  resource_type?: string;
  subject?: string;
  score: number;
  visual_similarity?: number;
  match_source?: 'text' | 'visual';
  page_number?: number;
  page_score?: number;
}

interface AlternativeIdentification {
  artist?: string | null;
  title?: string | null;
  reasoning?: string;
}

interface Identification {
  artist?: string | null;
  title?: string | null;
  inscriptions?: string | null;
  publisher?: string | null;
  subject?: string | null;
  medium?: string;
  period_guess?: string;
  confidence?: 'high' | 'medium' | 'low';
  confidence_reason?: string;
  alternative_identifications?: AlternativeIdentification[];
  search_terms?: string[];
  // From Google Search verification
  verified_artist?: string;
  verified_title?: string;
  catalog_numbers?: string[];
  web_sources?: { title: string; url: string }[];
}

interface ConfirmedMatch {
  book_id: string;
  book_slug?: string;
  book_title?: string;
  book_author?: string;
  gallery_image_id?: string;
  page_id?: string;
  page_number?: number;
  description?: string;
  image_url: string;
  read_url: string;
  gallery_url?: string;
  source_type: string;
}

interface Result {
  identification: Identification;
  matches: Match[];
  visual_search?: boolean;
  verified?: boolean;
  confirmed?: ConfirmedMatch | null;
  page?: { book_id: string; page_number: number; score: number } | null;
}

export default function IdentifyPage() {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const submitFile = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);

    // Compress large images client-side (phone cameras produce 5-10MB files)
    let imageFile = file;
    if (file.size > 3 * 1024 * 1024) {
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(bitmap.width * scale, bitmap.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        imageFile = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      } catch {
        // Fall through with original file if compression fails
      }
    }

    const formData = new FormData();
    formData.append('image', imageFile);

    try {
      const res = await fetch('/api/identify', { method: 'POST', body: formData });
      let data;
      try {
        data = await res.json();
      } catch {
        setError(`Server error (${res.status}) — try again`);
        return;
      }
      if (!res.ok) {
        setError(data.detail || data.error || `Failed to identify (${res.status})`);
      } else {
        setResult(data);
      }
    } catch {
      setError('Network error — check your connection and try again');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFile = useCallback(async (file: File) => {
    lastFileRef.current = file;
    // Preview
    const reader = new FileReader();
    reader.onload = (e) => setImage(e.target?.result as string);
    reader.readAsDataURL(file);
    submitFile(file);
  }, [submitFile]);

  const retry = useCallback(() => {
    if (lastFileRef.current) {
      submitFile(lastFileRef.current);
    }
  }, [submitFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const reset = useCallback(() => {
    setImage(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }, []);

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="bg-dark text-white">
        <SiteHeader variant="dark" />
        <div className="max-w-2xl mx-auto px-4 py-6">
          <h1 className="text-2xl sm:text-3xl font-display font-semibold">Identify</h1>
          <p className="text-white/60 mt-1 text-sm">Photograph an artwork or book to find it in Source Library</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Landing: explain + engage */}
        {!image && (
          <div className="space-y-4">
            {/* Hero — the picture room at the Embassy of the Free Mind */}
            <div className="relative rounded-xl overflow-hidden bg-dark">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/identify-hero.jpg"
                alt="The picture room at the Embassy of the Free Mind in Amsterdam, its walls covered with framed engravings and prints"
                className="w-full h-[44vh] min-h-[300px] object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-5 sm:p-6 text-white">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/70 mb-1.5">
                  Embassy of the Free Mind · Amsterdam
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold leading-tight">
                  Every picture on these walls comes from a book.
                </h2>
                <p className="text-sm text-white/85 mt-2 max-w-md">
                  Photograph any print or engraving — on a museum wall, or on the open page
                  of an old book — and we&apos;ll find the original in the library, together
                  with the book it belongs to.
                </p>
              </div>
            </div>

            {/* Camera button (primary on mobile) */}
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-3 px-6 py-10 rounded-xl border-2 border-dashed border-accent-rust/30 bg-white hover:border-accent-rust/60 hover:bg-accent-rust/5 transition-colors cursor-pointer"
            >
              <Camera className="w-8 h-8 text-accent-rust" />
              <div className="text-left">
                <p className="text-lg font-medium text-primary">Take a Photo</p>
                <p className="text-sm text-muted">Point your camera at an artwork or book</p>
              </div>
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleInputChange}
              className="hidden"
            />

            {/* File upload (secondary) */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-border-light bg-white hover:border-accent-rust/30 transition-colors text-sm text-secondary cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              Upload from gallery
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleInputChange}
              className="hidden"
            />

            {/* How it works */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              {[
                { n: '1', title: 'Photograph', body: 'A print, a plate, or a page — frames and angles are fine.' },
                { n: '2', title: 'We compare', body: 'Your photo is checked against the illustrations of the whole library.' },
                { n: '3', title: 'Read the source', body: 'Land on the exact page in the reader, with translation.' },
              ].map(step => (
                <div key={step.n} className="text-center px-1">
                  <div className="w-7 h-7 mx-auto rounded-full bg-accent-rust/10 text-accent-rust text-sm font-semibold flex items-center justify-center">
                    {step.n}
                  </div>
                  <p className="text-sm font-medium text-primary mt-2">{step.title}</p>
                  <p className="text-xs text-muted mt-1 leading-snug">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Preview + loading */}
        {image && (
          <div className="space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-stone-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="Your photo" className="w-full max-h-[50vh] object-contain" />
              {loading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="flex items-center gap-3 bg-white/90 rounded-full px-5 py-2.5">
                    <Loader2 className="w-5 h-5 animate-spin text-accent-rust" />
                    <span className="text-sm font-medium">Identifying...</span>
                  </div>
                </div>
              )}
            </div>

            {!loading && (
              <button
                onClick={reset}
                className="text-sm text-accent-rust hover:underline cursor-pointer"
              >
                Try another image
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-800 space-y-2">
            <p>{error}</p>
            <button
              onClick={retry}
              disabled={loading}
              className="text-accent-rust font-medium hover:underline cursor-pointer disabled:opacity-50"
            >
              Try again
            </button>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Visually confirmed match — the answer, front and center */}
            {result.confirmed && (
              <div className="rounded-xl overflow-hidden bg-white border-2 border-accent-rust/40 shadow-sm">
                <div className="flex items-center gap-2 px-5 py-3 bg-accent-rust/5 border-b border-accent-rust/20">
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent-rust">Found in the library</span>
                  <span className="text-[10px] text-green-700 bg-green-50 rounded px-1.5 py-0.5">confirmed by visual comparison</span>
                </div>
                <div className="flex gap-4 p-5">
                  <div className="w-24 sm:w-32 flex-shrink-0 rounded overflow-hidden bg-stone-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={result.confirmed.image_url} alt="" className="w-full h-auto object-contain" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {result.confirmed.description && (
                      <p className="text-sm text-secondary line-clamp-3">{result.confirmed.description}</p>
                    )}
                    <p className="font-display font-semibold text-primary">
                      {result.confirmed.book_title}
                      {result.confirmed.page_number != null && (
                        <span className="text-sm font-normal text-muted ml-2">page {result.confirmed.page_number}</span>
                      )}
                    </p>
                    {result.confirmed.book_author && (
                      <p className="text-sm text-secondary">{result.confirmed.book_author}</p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2">
                      <Link
                        href={result.confirmed.read_url}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent-rust text-white text-sm font-medium hover:bg-accent-rust/85 transition-colors"
                      >
                        Read this book
                      </Link>
                      {result.confirmed.gallery_url && (
                        <Link
                          href={result.confirmed.gallery_url}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border-light text-sm text-secondary hover:border-accent-rust/30 transition-colors"
                        >
                          View in gallery
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* What Gemini saw */}
            <div className="card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-display font-semibold text-primary">Analysis</h2>
                {result.identification.confidence && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    result.identification.confidence === 'high'
                      ? 'bg-green-100 text-green-800'
                      : result.identification.confidence === 'medium'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-stone-100 text-stone-600'
                  }`}>
                    {result.identification.confidence} confidence
                  </span>
                )}
              </div>
              {result.identification.confidence_reason && (
                <p className="text-xs text-muted italic">{result.identification.confidence_reason}</p>
              )}
              <dl className="text-sm space-y-2">
                {(result.identification.artist || result.identification.verified_artist) && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Artist</dt>
                    {result.identification.verified_artist ? (
                      <dd>
                        <span className="text-primary font-medium">{result.identification.verified_artist}</span>
                        {result.identification.artist && result.identification.artist !== result.identification.verified_artist && (
                          <span className="text-xs text-muted ml-2 line-through">{result.identification.artist}</span>
                        )}
                        <span className="text-[10px] text-green-700 bg-green-50 rounded px-1 py-0.5 ml-1.5">verified</span>
                      </dd>
                    ) : (
                      <dd className="text-primary font-medium">{result.identification.artist}</dd>
                    )}
                  </div>
                )}
                {(result.identification.title || result.identification.verified_title) && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Title</dt>
                    {result.identification.verified_title ? (
                      <dd>
                        <span className="text-primary">{result.identification.verified_title}</span>
                        {result.identification.title && result.identification.title !== result.identification.verified_title && (
                          <span className="text-xs text-muted ml-2 line-through">{result.identification.title}</span>
                        )}
                        <span className="text-[10px] text-green-700 bg-green-50 rounded px-1 py-0.5 ml-1.5">verified</span>
                      </dd>
                    ) : (
                      <dd className="text-primary">{result.identification.title}</dd>
                    )}
                  </div>
                )}
                {result.identification.subject && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Subject</dt>
                    <dd className="text-secondary">{result.identification.subject}</dd>
                  </div>
                )}
                {result.identification.medium && (
                  <div className="flex gap-4">
                    <div>
                      <dt className="text-muted text-xs uppercase tracking-wider">Medium</dt>
                      <dd className="text-secondary capitalize">{result.identification.medium}</dd>
                    </div>
                    {result.identification.period_guess && (
                      <div>
                        <dt className="text-muted text-xs uppercase tracking-wider">Period</dt>
                        <dd className="text-secondary">{result.identification.period_guess}</dd>
                      </div>
                    )}
                  </div>
                )}
                {result.identification.publisher && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Publisher</dt>
                    <dd className="text-secondary">{result.identification.publisher}</dd>
                  </div>
                )}
                {result.identification.inscriptions && (
                  <div>
                    <dt className="text-muted text-xs uppercase tracking-wider">Inscriptions</dt>
                    <dd className="text-secondary whitespace-pre-line font-serif text-xs mt-1">
                      {result.identification.inscriptions}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Catalog numbers */}
              {result.identification.catalog_numbers && result.identification.catalog_numbers.length > 0 && (
                <div className="pt-3 border-t border-border-light">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-1">Catalogue references</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {result.identification.catalog_numbers.map((num, i) => (
                      <span key={i} className="text-xs bg-stone-100 text-stone-700 rounded px-2 py-0.5 font-mono">{num}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Web sources from Google Search verification */}
              {result.identification.web_sources && result.identification.web_sources.length > 0 && (
                <div className="pt-3 border-t border-border-light">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-1">Sources</h3>
                  <div className="space-y-1">
                    {result.identification.web_sources.map((src, i) => (
                      <a
                        key={i}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-blue-700 hover:text-blue-900 hover:underline truncate"
                      >
                        {src.title || src.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Alternative identifications */}
              {result.identification.alternative_identifications && result.identification.alternative_identifications.length > 0 && (
                <div className="pt-3 border-t border-border-light">
                  <h3 className="text-xs uppercase tracking-wider text-muted mb-2">Other possibilities</h3>
                  <div className="space-y-2">
                    {result.identification.alternative_identifications.map((alt, i) => (
                      <div key={i} className="text-sm bg-stone-50 rounded-lg p-3">
                        {alt.artist && <p className="font-medium text-primary">{alt.artist}</p>}
                        {alt.title && <p className="text-secondary">{alt.title}</p>}
                        {alt.reasoning && <p className="text-xs text-muted mt-1">{alt.reasoning}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Matches */}
            {result.matches.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-lg font-display font-semibold text-primary">
                    {result.confirmed
                      ? 'Related results'
                      : result.matches.length === 1 ? 'Closest Match' : `${result.matches.length} Possible Matches`}
                  </h2>
                  {result.visual_search && (
                    <span className="text-[10px] text-blue-600 bg-blue-50 rounded px-1.5 py-0.5">visual search</span>
                  )}
                </div>
                <div className="space-y-2">
                  {result.matches.filter(m => !result.confirmed || m.id !== result.confirmed.book_id).map((match, i) => {
                    const pageUrl = match.page_number
                      ? `${bookUrl({ slug: match.slug, id: match.id })}/page-number/${match.page_number}`
                      : bookUrl({ slug: match.slug, id: match.id });
                    return (
                    <Link
                      key={match.id}
                      href={pageUrl}
                      className="flex gap-4 p-3 rounded-lg bg-white border border-border-light hover:border-accent-rust/30 hover:shadow-sm transition-all group"
                    >
                      {(match.match_image || match.thumbnail_blob || match.thumbnail) && (
                        <div className="w-16 h-20 flex-shrink-0 rounded overflow-hidden bg-stone-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={match.match_image || match.thumbnail_blob || match.thumbnail || ''}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-primary group-hover:text-accent-rust transition-colors line-clamp-1">
                          {i === 0 && !result.confirmed && result.matches.length > 1 && (
                            <span className="text-xs bg-accent-rust/10 text-accent-rust rounded px-1.5 py-0.5 mr-2">Best match</span>
                          )}
                          {match.display_title || match.title}
                        </p>
                        {match.author && (
                          <p className="text-sm text-secondary mt-0.5">{match.author}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted flex-wrap">
                          {match.visual_similarity && (
                            <span className="font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5">
                              {Math.round(match.visual_similarity * 100)}% visual match
                            </span>
                          )}
                          {match.published && <span>{match.published}</span>}
                          {match.resource_type && (
                            <span className="capitalize">{match.resource_type}</span>
                          )}
                          {match.page_number && (
                            <span className="font-medium text-accent-rust">Page {match.page_number}</span>
                          )}
                          {match.subject && !match.page_number && (
                            <span className="line-clamp-1">{match.subject}</span>
                          )}
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted group-hover:text-accent-rust flex-shrink-0 mt-1" />
                    </Link>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="card p-5 text-center">
                <p className="text-secondary">Not found in Source Library</p>
                <p className="text-sm text-muted mt-1">
                  We searched {result.identification.medium === 'book' || result.identification.medium === 'manuscript'
                    ? 'our book collection' : 'our books and artworks'} but couldn&apos;t find this specific work.
                  The identification above is our best analysis of the image itself.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
