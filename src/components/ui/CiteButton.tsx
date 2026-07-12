'use client';

import { useState } from 'react';
import { Quote, Copy, Check } from 'lucide-react';
import { trackEvent } from '@/lib/track-event';

function getRuntimeOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';
}

function getEmbedHostUrl(): URL | null {
  if (typeof window === 'undefined') return null;
  if (window.self === window.top) return null;
  if (!document.referrer) return null;

  try {
    const ref = new URL(document.referrer);
    const params = new URLSearchParams(window.location.search);
    const hostPathParam = params.get('host_path');
    const hostPath = hostPathParam || sessionStorage.getItem('sl_embed_host_path') || '';

    if (hostPathParam) {
      sessionStorage.setItem('sl_embed_host_path', hostPathParam);
    }

    // Cross-origin referrers often include only origin; restore the real host page pathname.
    if (hostPath && ref.pathname === '/') {
      ref.pathname = hostPath.startsWith('/') ? hostPath : `/${hostPath}`;
    }

    return ref;
  } catch {
    return null;
  }
}

function buildCitableUrl(props: CiteButtonProps, origin: string): string {
  const embedHostUrl = getEmbedHostUrl();

  if (embedHostUrl) {
    embedHostUrl.searchParams.set('book', props.bookId);
    if (!props.pageNumber) {
      embedHostUrl.searchParams.delete('page');
    }
    if (props.editionVersion) {
      embedHostUrl.searchParams.set('v', props.editionVersion);
    } else {
      embedHostUrl.searchParams.delete('v');
    }
    return embedHostUrl.toString();
  }

  const vParam = props.editionVersion ? `?v=${props.editionVersion}` : '';
  // Canonical book URL is /book/{slug} on every host. proxy.ts (380+) 308s
  // any /{tenant}/book/... back to /book/... so a citation that included the
  // tenant prefix would just redirect — split the SEO signal across two URLs
  // and confuse social-share previews (B13). Emit the canonical form here.
  return `${origin}/book/${props.bookId}${vParam}`;
}

interface CiteButtonProps {
  bookId: string;
  title: string;
  displayTitle?: string;
  author: string;
  year?: string;
  publisher?: string;
  placePublished?: string;
  /** Original edition format (folio, quarto, octavo, …) */
  format?: string;
  /** USTC catalog number of the source edition */
  ustcId?: string;
  language?: string;
  doi?: string;
  pageNumber?: number;
  editionVersion?: string;
  /** Tenant slug (e.g. "bph") — produces /bph/book/… URLs instead of /book/… */
  tenantSlug?: string;
  className?: string;
  /** Hide the "Cite" label — show only the icon. */
  iconOnly?: boolean;
}

function formatAccessedDate(): string {
  const d = new Date();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Original-edition imprint: place of publication, publisher, format, and USTC
// number of the source printing being translated. This is the bibliographic
// record of the original work — distinct from the Source Library translation/
// access credit. Mirrors BibliographicInfo.formatCitation() so the "Cite"
// dropdown carries the same scholarly detail as the bibliographic panel.
function originalImprint(props: CiteButtonProps): string {
  const pub = [props.placePublished, props.publisher].filter(Boolean).join(': ');
  return [pub, props.format, props.ustcId ? `USTC ${props.ustcId}` : ''].filter(Boolean).join('. ');
}

function generateApa(props: CiteButtonProps, origin: string): string {
  const { author, title, displayTitle, year, doi, pageNumber, editionVersion } = props;
  const url = buildCitableUrl(props, origin);
  const displayName = displayTitle || title;
  const yearStr = year || 'n.d.';
  const authorStr = author || 'Anonymous';
  const version = editionVersion ? `, v${editionVersion}` : '';
  const page = pageNumber ? `, p. ${pageNumber}` : '';
  const accessed = formatAccessedDate();
  const imprint = originalImprint(props);
  const imprintStr = imprint ? `${imprint}. ` : '';

  if (doi) {
    return `${authorStr}. ${displayName}. ${imprintStr}Trans. Source Library (${yearStr})${version}${page}. https://doi.org/${doi}`;
  }
  return `${authorStr}. (${yearStr}). ${displayName}. ${imprintStr}Source Library${page}. Retrieved ${accessed}, from ${url}`;
}

function generateBibtex(props: CiteButtonProps, origin: string): string {
  const { author, title, year, doi, language, pageNumber, editionVersion, publisher, placePublished, format, ustcId } = props;
  const authorStr = author || 'Anonymous';

  const authorKey = authorStr.split(',')[0].split(' ').pop()?.toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
  const yearKey = year || 'nd';
  const titleWords = title.split(/\s+/).slice(0, 3).join('_').toLowerCase().replace(/[^a-z_]/g, '');
  const citeKey = `${authorKey}_${yearKey}_${titleWords}`;

  const lines = [
    `@book{${citeKey},`,
    `  author = {${authorStr}},`,
    `  title = {${title}},`,
    `  translator = {{Source Library}},`,
  ];
  if (year) lines.push(`  year = {${year}},`);
  // Original imprint: address = place of publication, publisher = source printer.
  // Falls back to Source Library as publisher only when no original is known.
  if (placePublished) lines.push(`  address = {${placePublished}},`);
  lines.push(`  publisher = {${publisher || 'Source Library'}},`);
  if (editionVersion) lines.push(`  edition = {${editionVersion}},`);
  if (language) lines.push(`  language = {${language}},`);
  if (doi) lines.push(`  doi = {${doi}},`);
  if (pageNumber) lines.push(`  pages = {${pageNumber}},`);
  lines.push(`  url = {${buildCitableUrl(props, origin)}},`);
  const noteParts = ['AI-assisted English translation via Source Library'];
  if (format) noteParts.push(format);
  if (ustcId) noteParts.push(`USTC ${ustcId}`);
  lines.push(`  note = {${noteParts.join('; ')}}`);
  lines.push(`}`);
  return lines.join('\n');
}

export default function CiteButton({
  bookId,
  title,
  displayTitle,
  author,
  year,
  publisher,
  placePublished,
  format,
  ustcId,
  language,
  doi,
  pageNumber,
  editionVersion,
  tenantSlug,
  className = '',
  iconOnly = false,
}: CiteButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const origin = getRuntimeOrigin();

  const props = { bookId, title, displayTitle, author, year, publisher, placePublished, format, ustcId, language, doi, pageNumber, editionVersion, tenantSlug };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    trackEvent('cite', { bookId, format: id, page: pageNumber, hasDoi: !!doi });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${className}`}
        title="Cite this book"
      >
        {copiedId ? <Check className="w-4 h-4 text-green-400" /> : <Quote className="w-4 h-4" />}
        {!iconOnly && 'Cite'}
      </button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-[9998] sm:bg-transparent bg-black/30"
            onClick={() => setShowMenu(false)}
          />
          {/* Desktop: absolute dropdown. Mobile: fixed bottom sheet */}
          <div className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-1 z-[9999] bg-white sm:rounded-lg rounded-t-xl shadow-lg border border-stone-200 py-1 sm:min-w-[240px]">
            <div className="sm:hidden w-10 h-1 bg-stone-300 rounded-full mx-auto mt-2 mb-1" />
            {/* Header with close (mobile bottom sheet) */}
            <div className="sm:hidden flex items-center justify-between px-4 pb-2 mb-1 border-b border-stone-100">
              <span className="text-[15px] font-semibold text-stone-900">Cite</span>
              <button type="button" onClick={() => setShowMenu(false)} className="text-sm font-medium text-stone-500 hover:text-stone-800 px-2 py-1 -mr-2">Close</button>
            </div>
            {/* APA */}
            <button
              onClick={() => {
                copyToClipboard(generateApa(props, origin), 'apa');
                setShowMenu(false);
              }}
              className="w-full min-h-[52px] sm:min-h-0 px-4 sm:px-3 py-3 sm:py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
            >
              {copiedId === 'apa' ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4 text-stone-400" />}
              Copy APA Citation
            </button>

            {/* BibTeX */}
            <button
              onClick={() => {
                copyToClipboard(generateBibtex(props, origin), 'bibtex');
                setShowMenu(false);
              }}
              className="w-full min-h-[52px] sm:min-h-0 px-4 sm:px-3 py-3 sm:py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
            >
              {copiedId === 'bibtex' ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4 text-stone-400" />}
              Copy BibTeX
            </button>

            {/* Preview */}
            <hr className="my-1 border-stone-100" />
            <div className="px-4 sm:px-3 py-2 text-xs text-stone-500 font-mono break-all leading-relaxed">
              {generateApa(props, origin)}
            </div>
            <div className="sm:hidden h-[env(safe-area-inset-bottom)]" />
          </div>
        </>
      )}
    </div>
  );
}
