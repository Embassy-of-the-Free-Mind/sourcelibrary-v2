'use client';

import { useState, useEffect, useCallback } from 'react';

interface WordLink {
  src: string;
  en: string;
  weight: number;
}

interface SentencePair {
  src: string;
  en: string;
  words: WordLink[];
}

interface AlignedPage {
  id: string;
  book: string;
  author: string;
  year: string;
  sourceLanguage: string;
  sentences: SentencePair[];
}

interface AlignmentData {
  pages: AlignedPage[];
}

function SentenceRow({
  pair,
  index,
  isHovered,
  isExpanded,
  onHover,
  onClick,
}: {
  pair: SentencePair;
  index: number;
  isHovered: boolean;
  isExpanded: boolean;
  onHover: (index: number | null) => void;
  onClick: (index: number) => void;
}) {
  return (
    <div
      className={`transition-all duration-200 ${isExpanded ? '' : 'cursor-pointer'}`}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(index)}
    >
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 py-4 px-5 rounded-xl transition-all duration-200 ${
          isHovered || isExpanded
            ? 'bg-amber-50/70 shadow-sm'
            : 'hover:bg-stone-50'
        }`}
      >
        {/* Latin */}
        <div
          className={`font-serif text-[15px] leading-[1.8] transition-colors duration-200 ${
            isHovered || isExpanded ? 'text-stone-800' : 'text-stone-500'
          }`}
          lang="la"
        >
          {pair.src}
        </div>

        {/* English */}
        <div className="font-serif text-[15px] leading-[1.8] text-stone-800">
          {isHovered || isExpanded ? (
            <HighlightedEnglish text={pair.en} words={pair.words} />
          ) : (
            pair.en
          )}
        </div>
      </div>

      {/* Word-level drill-down */}
      {isExpanded && pair.words.length > 0 && (
        <div className="px-5 pb-4">
          <div className="flex flex-wrap gap-2 pt-2 pl-1">
            {pair.words.map((w, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors"
                style={{
                  borderColor: `rgba(160, 120, 40, ${0.15 + w.weight * 0.25})`,
                  backgroundColor: `rgba(160, 120, 40, ${0.02 + w.weight * 0.06})`,
                }}
              >
                <span className="font-serif italic text-stone-500">{w.src}</span>
                <svg
                  className="w-3 h-3 text-stone-300 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className="font-serif text-stone-800">{w.en}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-stone-400 mt-2 pl-1">
            Click again to collapse
          </div>
        </div>
      )}
    </div>
  );
}

function HighlightedEnglish({ text, words }: { text: string; words: WordLink[] }) {
  if (words.length === 0) return <>{text}</>;

  // Find and highlight English words that have alignment links
  const highlights = new Map<string, number>();
  for (const w of words) {
    // Store lowercase for matching
    for (const token of w.en.split(/\s+/)) {
      highlights.set(token.toLowerCase().replace(/[.,;:!?"'()]/g, ''), w.weight);
    }
  }

  // Split text into tokens and mark which are highlighted
  const parts: { text: string; weight: number }[] = [];
  const regex = /(\S+)(\s*)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const word = match[1];
    const space = match[2];
    const clean = word.toLowerCase().replace(/[.,;:!?"'()[\]]/g, '');
    const weight = highlights.get(clean) || 0;
    parts.push({ text: word + space, weight });
  }

  return (
    <>
      {parts.map((p, i) =>
        p.weight > 0 ? (
          <span
            key={i}
            className="rounded-sm"
            style={{
              backgroundColor: `rgba(160, 120, 40, ${0.08 + p.weight * 0.18})`,
              borderBottom: `2px solid rgba(160, 120, 40, ${0.2 + p.weight * 0.4})`,
            }}
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </>
  );
}

export function WordAlignmentDemo() {
  const [data, setData] = useState<AlignmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPage, setSelectedPage] = useState(0);
  const [hoveredSentence, setHoveredSentence] = useState<number | null>(null);
  const [expandedSentence, setExpandedSentence] = useState<number | null>(null);

  useEffect(() => {
    fetch('/data/experiments/alignment-results.json')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleHover = useCallback((index: number | null) => {
    setHoveredSentence(index);
  }, []);

  const handleClick = useCallback((index: number) => {
    setExpandedSentence((prev) => (prev === index ? null : index));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-stone-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!data || data.pages.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-stone-400 text-sm">Alignment data unavailable.</div>
      </div>
    );
  }

  const page = data.pages[selectedPage];

  return (
    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 bg-stone-50/50">
        <div className="text-sm text-stone-500">
          <span className="font-medium text-stone-700">{page.author}</span>
          {', '}
          <em>{page.book}</em>
          {' '}({page.year})
        </div>
        {data.pages.length > 1 && (
          <select
            value={selectedPage}
            onChange={(e) => {
              setSelectedPage(Number(e.target.value));
              setHoveredSentence(null);
              setExpandedSentence(null);
            }}
            className="text-sm border border-stone-200 rounded-lg px-3 py-1.5 bg-white text-stone-600"
          >
            {data.pages.map((p, i) => (
              <option key={p.id} value={i}>
                {p.author} &mdash; {p.book}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 px-5 pt-4 pb-2">
        <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em]">
          {page.sourceLanguage} Source
        </div>
        <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em]">
          English Translation
        </div>
      </div>

      {/* Sentence pairs */}
      <div className="divide-y divide-stone-50">
        {page.sentences.map((pair, i) => (
          <SentenceRow
            key={i}
            pair={pair}
            index={i}
            isHovered={hoveredSentence === i}
            isExpanded={expandedSentence === i}
            onHover={handleHover}
            onClick={handleClick}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/50 text-center text-xs text-stone-400">
        Hover to see the original. Click a sentence to see word-level correspondences.
      </div>
    </div>
  );
}
