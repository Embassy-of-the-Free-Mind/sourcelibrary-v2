'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function cleanToken(word: string) {
  return word.toLowerCase().replace(/[.,;:!?"'()\[\]""—–\-·&]/g, '');
}

// Greek transliteration
const TRANSLIT: Record<string, string> = {
  'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z',
  'η': 'ē', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm',
  'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's',
  'ς': 's', 'τ': 't', 'υ': 'u', 'φ': 'ph', 'χ': 'ch', 'ψ': 'ps',
  'ω': 'ō',
};

function transliterate(text: string): string {
  let result = '';
  for (const ch of text) {
    // Strip combining diacritics to get base char
    const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    result += TRANSLIT[base] || TRANSLIT[ch] || ch;
  }
  return result;
}

function isGreekScript(text: string): boolean {
  return /[α-ωΑ-Ω]/.test(text);
}

interface Props {
  sourceText: string;
  translationText: string;
  sourceLanguage: string;
  label: string;
}

export function LiveAlignmentDemo({ sourceText, translationText, sourceLanguage, label }: Props) {
  const [highlights, setHighlights] = useState<Map<string, number>>(new Map());
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const srcEmbCache = useRef<Map<string, number[]>>(new Map());
  const enEmbCache = useRef<Map<string, number[]>>(new Map());

  const showTranslit = useMemo(() => isGreekScript(sourceText), [sourceText]);

  const srcWords = useMemo(() => {
    return sourceText.split(/(\s+)/).filter(t => t.trim()).filter(t => cleanToken(t).length > 1);
  }, [sourceText]);

  const embedTexts = useCallback(async (texts: string[]): Promise<number[][]> => {
    const res = await fetch('/api/experiments/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    const data = await res.json();
    return data.embeddings;
  }, []);

  // Pre-load source embeddings on mount
  useEffect(() => {
    const uniqueWords = [...new Set(srcWords.map(w => cleanToken(w)))].filter(w => w.length > 1);
    if (uniqueWords.length === 0 || srcEmbCache.current.size > 0) {
      setReady(true);
      return;
    }
    embedTexts(uniqueWords).then(embeddings => {
      for (let i = 0; i < uniqueWords.length; i++) {
        srcEmbCache.current.set(uniqueWords[i], embeddings[i]);
      }
      setReady(true);
    }).catch(() => setReady(true));
  }, [srcWords, embedTexts]);

  const handleEnClick = useCallback(async (word: string) => {
    const clean = cleanToken(word);
    if (!clean || clean.length < 2) return;

    if (selectedWord === clean) {
      setSelectedWord(null);
      setHighlights(new Map());
      return;
    }

    setSelectedWord(clean);

    // Check english embedding cache first
    let clickedEmb = enEmbCache.current.get(clean);
    if (!clickedEmb) {
      setLoading(true);
      try {
        [clickedEmb] = await embedTexts([clean]);
        enEmbCache.current.set(clean, clickedEmb);
      } catch (e) {
        console.error('Embedding failed:', e);
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    const matches = new Map<string, number>();
    for (const [srcWord, srcEmb] of srcEmbCache.current) {
      const sim = cosine(clickedEmb, srcEmb);
      if (sim > 0.55) {
        matches.set(srcWord, sim);
      }
    }

    const sorted = [...matches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    setHighlights(new Map(sorted));
  }, [selectedWord, embedTexts]);

  const enTokens = translationText.split(/(\s+)/);
  const allSrcTokens = sourceText.split(/(\s+)/);

  const gridCols = showTranslit ? 'md:grid-cols-3' : 'md:grid-cols-2';

  return (
    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-stone-100 bg-stone-50/50">
        <div className="text-sm text-stone-500">
          <span className="font-medium text-stone-700">{label}</span>
          {!ready && <span className="ml-2 text-xs text-amber-500 animate-pulse">loading embeddings...</span>}
        </div>
      </div>

      <div className={`grid grid-cols-1 ${gridCols} divide-y md:divide-y-0 md:divide-x divide-stone-100`}>
        {/* Source */}
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            {sourceLanguage}
          </div>
          <div className="font-serif text-[15px] leading-[1.8] text-stone-500">
            <HighlightedSource tokens={allSrcTokens} highlights={highlights} />
          </div>
        </div>

        {/* Transliteration (Greek only) */}
        {showTranslit && (
          <div className="p-6">
            <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
              Transliteration
            </div>
            <div className="font-serif text-[15px] leading-[1.8] text-stone-400 italic">
              <HighlightedSource
                tokens={allSrcTokens.map(t => /^\s+$/.test(t) ? t : transliterate(t))}
                highlights={highlights}
                originalTokens={allSrcTokens}
              />
            </div>
          </div>
        )}

        {/* English */}
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            English {loading && <span className="text-amber-500 ml-2 animate-pulse">...</span>}
          </div>
          <div className="font-serif text-[15px] leading-[1.8] text-stone-800">
            {enTokens.map((token, i) => {
              if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
              const clean = cleanToken(token);
              const isClickable = clean.length > 1;
              const isSelected = selectedWord === clean;
              return (
                <span
                  key={i}
                  onClick={isClickable ? () => handleEnClick(token) : undefined}
                  className={`transition-all duration-150 ${isClickable ? 'cursor-pointer' : ''}`}
                  style={
                    isSelected
                      ? {
                          backgroundColor: 'rgba(160, 120, 40, 0.25)',
                          borderBottom: '2px solid rgba(160, 120, 40, 0.6)',
                          borderRadius: '2px',
                          padding: '1px 2px',
                        }
                      : isClickable
                        ? { borderBottom: '1px dashed rgba(160, 120, 40, 0.2)' }
                        : undefined
                  }
                >
                  {token}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/50 text-center text-xs text-stone-400">
        Click any English word to see its source.
      </div>
    </div>
  );
}

function HighlightedSource({
  tokens,
  highlights,
  originalTokens,
}: {
  tokens: string[];
  highlights: Map<string, number>;
  originalTokens?: string[];
}) {
  return (
    <>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
        // Use original token for matching if provided (transliteration case)
        const matchToken = originalTokens ? originalTokens[i] : token;
        const clean = cleanToken(matchToken);
        const sim = highlights.get(clean);
        const isHighlighted = sim !== undefined;
        return (
          <span
            key={i}
            className={`transition-all duration-150 ${isHighlighted ? 'text-stone-900 font-medium' : ''}`}
            style={isHighlighted ? {
              backgroundColor: `rgba(160, 120, 40, ${0.03 + Math.min(1, (sim! - 0.55) / 0.25) ** 1.5 * 0.45})`,
              borderBottom: `2px solid rgba(160, 120, 40, ${0.05 + Math.min(1, (sim! - 0.55) / 0.25) ** 1.2 * 0.95})`,
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
