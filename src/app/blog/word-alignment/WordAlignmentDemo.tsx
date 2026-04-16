'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface WordLink {
  src: string;
  translit?: string;
  en: string;
  weight: number;
}

interface SentencePair {
  src: string;
  translit?: string;
  en: string;
  words: WordLink[];
}

interface AlignedPage {
  id: string;
  book: string;
  author: string;
  year: string;
  sourceLanguage: string;
  hasTransliteration?: boolean;
  sentences: SentencePair[];
}

interface AlignmentData {
  pages: AlignedPage[];
}

function cleanToken(word: string) {
  return word.toLowerCase().replace(/[.,;:!?"'()\[\]""—–\-·']/g, '');
}

// Build lookup: English word → set of source words
function buildEnToSrcMap(sentences: SentencePair[]) {
  const map = new Map<string, Set<string>>();
  for (const s of sentences) {
    for (const w of s.words) {
      for (const enToken of w.en.toLowerCase().split(/\s+/)) {
        const clean = cleanToken(enToken);
        if (!clean) continue;
        if (!map.has(clean)) map.set(clean, new Set());
        for (const srcToken of w.src.split(/\s+/)) {
          map.get(clean)!.add(cleanToken(srcToken));
        }
      }
    }
  }
  return map;
}

// Build lookup: source word → transliteration
function buildSrcToTranslit(sentences: SentencePair[]) {
  const map = new Map<string, string>();
  for (const s of sentences) {
    for (const w of s.words) {
      if (w.translit) {
        map.set(cleanToken(w.src), w.translit);
      }
    }
  }
  return map;
}

export function WordAlignmentDemo({ pageIndex = 0 }: { pageIndex?: number }) {
  const [data, setData] = useState<AlignmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEnWord, setSelectedEnWord] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/experiments/alignment-results.json')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const page = data?.pages[pageIndex];
  const hasTranslit = page?.hasTransliteration;

  const enToSrc = useMemo(() => {
    if (!page) return new Map<string, Set<string>>();
    return buildEnToSrcMap(page.sentences);
  }, [page]);

  const srcToTranslit = useMemo(() => {
    if (!page) return new Map<string, string>();
    return buildSrcToTranslit(page.sentences);
  }, [page]);

  const highlightedSrcWords = useMemo(() => {
    if (!selectedEnWord) return new Set<string>();
    return enToSrc.get(selectedEnWord) || new Set<string>();
  }, [selectedEnWord, enToSrc]);

  const handleEnClick = useCallback((word: string) => {
    const clean = cleanToken(word);
    if (!clean) return;
    setSelectedEnWord(prev => prev === clean ? null : clean);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-stone-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!data || !page) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-stone-400 text-sm">Alignment data unavailable.</div>
      </div>
    );
  }

  const allSrcText = page.sentences.map(s => s.src).join(' ');
  const allTranslitText = hasTranslit ? page.sentences.map(s => s.translit || '').join(' ') : '';
  const allEnText = page.sentences.map(s => s.en).join(' ');

  const gridCols = hasTranslit ? 'md:grid-cols-3' : 'md:grid-cols-2';

  return (
    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-3 border-b border-stone-100 bg-stone-50/50">
        <div className="text-sm text-stone-500">
          <span className="font-medium text-stone-700">{page.author}</span>
          {', '}
          <em>{page.book}</em>
          {' '}({page.year})
        </div>
      </div>

      {/* Split pane */}
      <div className={`grid grid-cols-1 ${gridCols} divide-y md:divide-y-0 md:divide-x divide-stone-100`}>
        {/* Source */}
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            {page.sourceLanguage}
          </div>
          <div className="font-serif text-[15px] leading-[1.8] text-stone-500">
            <SourceText text={allSrcText} highlighted={highlightedSrcWords} />
          </div>
        </div>

        {/* Transliteration (only for Greek etc.) */}
        {hasTranslit && (
          <div className="p-6">
            <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
              Transliteration
            </div>
            <div className="font-serif text-[15px] leading-[1.8] text-stone-400 italic">
              <SourceText text={allTranslitText} highlighted={highlightedSrcWords} translitMap={srcToTranslit} />
            </div>
          </div>
        )}

        {/* English */}
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            English
          </div>
          <div className="font-serif text-[15px] leading-[1.8] text-stone-800">
            <EnglishText
              text={allEnText}
              hasAlignment={enToSrc}
              selected={selectedEnWord}
              onClick={handleEnClick}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/50 text-center text-xs text-stone-400">
        Click any English word to highlight its {page.sourceLanguage} source.
      </div>
    </div>
  );
}

function SourceText({
  text,
  highlighted,
  translitMap,
}: {
  text: string;
  highlighted: Set<string>;
  translitMap?: Map<string, string>;
}) {
  const tokens = text.split(/(\s+)/);

  return (
    <>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
        const clean = cleanToken(token);
        // For transliteration column, check if the source word it maps from is highlighted
        const isHighlighted = translitMap
          ? [...translitMap.entries()].some(([src, translit]) =>
              cleanToken(translit) === clean && highlighted.has(src))
            || highlighted.has(clean)
          : highlighted.has(clean);
        return (
          <span
            key={i}
            className={`transition-all duration-150 ${isHighlighted ? 'text-stone-900 font-medium' : ''}`}
            style={isHighlighted ? {
              backgroundColor: 'rgba(160, 120, 40, 0.25)',
              borderBottom: '2px solid rgba(160, 120, 40, 0.6)',
              borderRadius: '2px',
              padding: '1px 2px',
            } : undefined}
          >
            {token}
          </span>
        );
      })}
    </>
  );
}

function EnglishText({
  text,
  hasAlignment,
  selected,
  onClick,
}: {
  text: string;
  hasAlignment: Map<string, Set<string>>;
  selected: string | null;
  onClick: (word: string) => void;
}) {
  const tokens = text.split(/(\s+)/);

  return (
    <>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
        const clean = cleanToken(token);
        const isClickable = hasAlignment.has(clean);
        const isSelected = selected === clean;
        return (
          <span
            key={i}
            onClick={isClickable ? () => onClick(token) : undefined}
            className={`transition-all duration-150 ${
              isClickable ? 'cursor-pointer' : ''
            } ${isSelected ? 'text-stone-900' : ''}`}
            style={
              isSelected
                ? {
                    backgroundColor: 'rgba(160, 120, 40, 0.25)',
                    borderBottom: '2px solid rgba(160, 120, 40, 0.6)',
                    borderRadius: '2px',
                    padding: '1px 2px',
                  }
                : isClickable
                  ? { borderBottom: '1px dashed rgba(160, 120, 40, 0.3)' }
                  : undefined
            }
          >
            {token}
          </span>
        );
      })}
    </>
  );
}
