'use client';

import { useState } from 'react';
import { Quote, Copy, Check } from 'lucide-react';

interface CiteButtonProps {
  bookId: string;
  title: string;
  displayTitle?: string;
  author: string;
  year?: string;
  publisher?: string;
  placePublished?: string;
  language?: string;
  doi?: string;
  pageNumber?: number;
  editionVersion?: string;
  className?: string;
}

function generateApa(props: CiteButtonProps): string {
  const { author, title, displayTitle, year, doi, bookId, pageNumber, editionVersion } = props;
  const url = `https://sourcelibrary.org/book/${bookId}`;
  const displayName = displayTitle || title;
  const yearStr = year || 'n.d.';
  const authorStr = author || 'Anonymous';
  const version = editionVersion ? `, v${editionVersion}` : '';
  const page = pageNumber ? `, p. ${pageNumber}` : '';

  if (doi) {
    return `${authorStr}. ${displayName}, trans. Source Library (${yearStr})${version}${page}. https://doi.org/${doi}`;
  }
  return `${authorStr}. (${yearStr}). ${displayName}. Source Library${page}. ${url}`;
}

function generateBibtex(props: CiteButtonProps): string {
  const { author, title, year, doi, bookId, language, pageNumber, editionVersion } = props;
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
  lines.push(`  publisher = {Source Library},`);
  if (editionVersion) lines.push(`  edition = {${editionVersion}},`);
  if (language) lines.push(`  language = {${language}},`);
  if (doi) lines.push(`  doi = {${doi}},`);
  if (pageNumber) lines.push(`  pages = {${pageNumber}},`);
  lines.push(`  url = {https://sourcelibrary.org/book/${bookId}},`);
  lines.push(`  note = {AI-assisted English translation via Source Library}`);
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
  language,
  doi,
  pageNumber,
  editionVersion,
  className = '',
}: CiteButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const props = { bookId, title, displayTitle, author, year, publisher, placePublished, language, doi, pageNumber, editionVersion };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
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
        Cite
      </button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-[9998] sm:bg-transparent bg-black/30"
            onClick={() => setShowMenu(false)}
          />
          {/* Desktop: absolute dropdown. Mobile: fixed bottom sheet */}
          <div className="fixed inset-x-0 bottom-0 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-1 z-[9999] bg-white sm:rounded-lg rounded-t-xl shadow-lg border border-stone-200 py-1 sm:min-w-[240px]">
            <div className="sm:hidden w-10 h-1 bg-stone-300 rounded-full mx-auto my-2" />
            {/* APA */}
            <button
              onClick={() => {
                copyToClipboard(generateApa(props), 'apa');
                setShowMenu(false);
              }}
              className="w-full px-4 sm:px-3 py-3 sm:py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
            >
              {copiedId === 'apa' ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4 text-stone-400" />}
              Copy APA Citation
            </button>

            {/* BibTeX */}
            <button
              onClick={() => {
                copyToClipboard(generateBibtex(props), 'bibtex');
                setShowMenu(false);
              }}
              className="w-full px-4 sm:px-3 py-3 sm:py-2 text-left text-sm hover:bg-stone-50 flex items-center gap-2 text-stone-700"
            >
              {copiedId === 'bibtex' ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4 text-stone-400" />}
              Copy BibTeX
            </button>

            {/* Preview */}
            <hr className="my-1 border-stone-100" />
            <div className="px-4 sm:px-3 py-2 text-xs text-stone-500 font-mono break-all leading-relaxed">
              {generateApa(props)}
            </div>
            <div className="sm:hidden h-[env(safe-area-inset-bottom)]" />
          </div>
        </>
      )}
    </div>
  );
}
