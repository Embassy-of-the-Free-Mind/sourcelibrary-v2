'use client';

import { useState, useRef, useCallback } from 'react';

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
  const srcEmbCache = useRef<Map<string, number[]>>(new Map());

  const srcTokens = sourceText.split(/(\s+)/).filter(t => t.trim());
  const srcWords = srcTokens.filter(t => cleanToken(t).length > 1);

  const embedTexts = useCallback(async (texts: string[]): Promise<number[][]> => {
    const res = await fetch('/api/experiments/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    const data = await res.json();
    return data.embeddings;
  }, []);

  const ensureSrcEmbeddings = useCallback(async () => {
    if (srcEmbCache.current.size > 0) return;
    const uniqueWords = [...new Set(srcWords.map(w => cleanToken(w)))].filter(w => w.length > 1);
    const embeddings = await embedTexts(uniqueWords);
    for (let i = 0; i < uniqueWords.length; i++) {
      srcEmbCache.current.set(uniqueWords[i], embeddings[i]);
    }
  }, [srcWords, embedTexts]);

  const handleEnClick = useCallback(async (word: string) => {
    const clean = cleanToken(word);
    if (!clean || clean.length < 2) return;

    if (selectedWord === clean) {
      setSelectedWord(null);
      setHighlights(new Map());
      return;
    }

    setLoading(true);
    setSelectedWord(clean);

    try {
      await ensureSrcEmbeddings();
      const [clickedEmb] = await embedTexts([clean]);

      const matches = new Map<string, number>();
      for (const [srcWord, srcEmb] of srcEmbCache.current) {
        const sim = cosine(clickedEmb, srcEmb);
        if (sim > 0.55) {
          matches.set(srcWord, sim);
        }
      }

      // Keep only top 5 matches
      const sorted = [...matches.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      setHighlights(new Map(sorted));
    } catch (e) {
      console.error('Alignment failed:', e);
    } finally {
      setLoading(false);
    }
  }, [selectedWord, ensureSrcEmbeddings, embedTexts]);

  const enTokens = translationText.split(/(\s+)/);
  const allSrcTokens = sourceText.split(/(\s+)/);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
      <div className="px-5 py-3 border-b border-stone-100 bg-stone-50/50">
        <div className="text-sm text-stone-500">
          <span className="font-medium text-stone-700">{label}</span>
          <span className="ml-2 text-xs text-stone-400">
            live &middot; gemini-embedding-001
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-100">
        {/* Source */}
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            {sourceLanguage}
          </div>
          <div className="font-serif text-[15px] leading-[1.8] text-stone-500">
            {allSrcTokens.map((token, i) => {
              if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
              const clean = cleanToken(token);
              const sim = highlights.get(clean);
              const isHighlighted = sim !== undefined;
              return (
                <span
                  key={i}
                  className={`transition-all duration-150 ${isHighlighted ? 'text-stone-900 font-medium' : ''}`}
                  style={isHighlighted ? {
                    backgroundColor: `rgba(160, 120, 40, ${0.1 + (sim! - 0.55) * 1.5})`,
                    borderBottom: `2px solid rgba(160, 120, 40, ${0.3 + (sim! - 0.55) * 1.5})`,
                    borderRadius: '2px',
                    padding: '1px 2px',
                  } : undefined}
                >
                  {token}
                </span>
              );
            })}
          </div>
        </div>

        {/* English */}
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            English {loading && <span className="text-amber-500 ml-2 animate-pulse">embedding...</span>}
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
        Click any English word. Embeddings computed live via Gemini &mdash; no pre-computed data.
      </div>
    </div>
  );
}
