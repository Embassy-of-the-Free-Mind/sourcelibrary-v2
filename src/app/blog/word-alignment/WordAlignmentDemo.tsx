'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface AlignmentLink {
  en: [number, number];
  src: [number, number];
  en_text: string;
  src_text: string;
  weight: number;
  method: string;
}

interface AlignedPage {
  id: string;
  book: string;
  author: string;
  page: number;
  sourceLanguage: string;
  sourceText: string;
  translationText: string;
  alignments: {
    llm: AlignmentLink[];
    embedding: AlignmentLink[];
  };
}

interface AlignmentData {
  generated: string;
  pages: AlignedPage[];
}

type Method = 'llm' | 'embedding';
type HoverSide = 'source' | 'translation' | null;

function buildHighlightMap(
  links: AlignmentLink[],
  hoveredRange: [number, number] | null,
  hoverSide: HoverSide,
  textLength: number,
  side: 'source' | 'translation'
): Float32Array {
  const weights = new Float32Array(textLength);
  if (!hoveredRange || !hoverSide) return weights;
  if (side === hoverSide) return weights;

  for (const link of links) {
    const hoveredField = hoverSide === 'source' ? 'src' : 'en';
    const targetField = side === 'source' ? 'src' : 'en';
    const [hStart, hEnd] = link[hoveredField];
    const [rStart, rEnd] = hoveredRange;

    if (hStart < rEnd && hEnd > rStart) {
      const [tStart, tEnd] = link[targetField];
      for (let i = tStart; i < Math.min(tEnd, textLength); i++) {
        weights[i] = Math.max(weights[i], link.weight);
      }
    }
  }
  return weights;
}

function HighlightedText({
  text,
  weights,
  onHoverRange,
  side,
  links,
}: {
  text: string;
  weights: Float32Array;
  onHoverRange: (range: [number, number] | null, side: HoverSide) => void;
  side: 'source' | 'translation';
  links: AlignmentLink[];
}) {
  const spans = useMemo(() => {
    const result: { text: string; weight: number; start: number; end: number }[] = [];
    let currentWeight = weights[0] || 0;
    let spanStart = 0;

    for (let i = 1; i <= text.length; i++) {
      const w = i < text.length ? (weights[i] || 0) : -1;
      if (w !== currentWeight) {
        result.push({ text: text.substring(spanStart, i), weight: currentWeight, start: spanStart, end: i });
        currentWeight = w;
        spanStart = i;
      }
    }
    return result;
  }, [text, weights]);

  const getWordRange = useCallback(
    (charIndex: number): [number, number] => {
      const field = side === 'source' ? 'src' : 'en';
      for (const link of links) {
        const [start, end] = link[field];
        if (charIndex >= start && charIndex < end) return [start, end];
      }
      let start = charIndex;
      let end = charIndex;
      while (start > 0 && /\S/.test(text[start - 1])) start--;
      while (end < text.length && /\S/.test(text[end])) end++;
      return [start, end];
    },
    [links, side, text]
  );

  return (
    <div className="font-serif text-[15px] leading-[1.8] whitespace-pre-wrap text-stone-800">
      {spans.map((span, i) => {
        const isHighlighted = span.weight > 0;
        const bgOpacity = isHighlighted ? 0.12 + span.weight * 0.48 : 0;

        return (
          <span
            key={i}
            className="cursor-pointer transition-all duration-100"
            style={{
              backgroundColor: isHighlighted ? `rgba(180, 130, 50, ${bgOpacity})` : undefined,
              borderBottom: isHighlighted
                ? `2px solid rgba(180, 130, 50, ${0.3 + span.weight * 0.5})`
                : '2px solid transparent',
              borderRadius: isHighlighted ? '2px' : undefined,
              padding: isHighlighted ? '1px 0' : undefined,
            }}
            onMouseEnter={() => onHoverRange(getWordRange(span.start), side)}
            onMouseLeave={() => onHoverRange(null, null)}
          >
            {span.text}
          </span>
        );
      })}
    </div>
  );
}

function AlignmentDetail({
  links,
  hoveredRange,
  hoverSide,
}: {
  links: AlignmentLink[];
  hoveredRange: [number, number] | null;
  hoverSide: HoverSide;
}) {
  if (!hoveredRange || !hoverSide) {
    return (
      <div className="text-sm text-stone-400 italic text-center py-3">
        Hover over any word to see its alignment
      </div>
    );
  }

  const matching = links.filter((link) => {
    const field = hoverSide === 'source' ? 'src' : 'en';
    const [start, end] = link[field];
    return start < hoveredRange[1] && end > hoveredRange[0];
  });

  if (matching.length === 0) {
    return (
      <div className="text-sm text-stone-400 italic text-center py-3">
        No alignment data for this text
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3 py-2 justify-center">
      {matching.slice(0, 6).map((link, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
          style={{
            borderColor: `rgba(180, 130, 50, ${0.2 + link.weight * 0.4})`,
            backgroundColor: `rgba(180, 130, 50, ${0.03 + link.weight * 0.07})`,
          }}
        >
          <span className="font-serif italic text-stone-600 text-sm">{link.src_text}</span>
          <svg className="w-3 h-3 text-stone-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="font-serif text-stone-900 text-sm">{link.en_text}</span>
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: `rgba(180, 130, 50, ${0.3 + link.weight * 0.7})` }}
          />
        </div>
      ))}
    </div>
  );
}

export function WordAlignmentDemo() {
  const [data, setData] = useState<AlignmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPage, setSelectedPage] = useState(0);
  const [method, setMethod] = useState<Method>('llm');
  const [hoveredRange, setHoveredRange] = useState<[number, number] | null>(null);
  const [hoverSide, setHoverSide] = useState<HoverSide>(null);

  useEffect(() => {
    fetch('/data/experiments/alignment-results.json')
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleHover = useCallback((range: [number, number] | null, side: HoverSide) => {
    setHoveredRange(range);
    setHoverSide(side);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-pulse text-stone-400 text-sm">Loading alignment data...</div>
      </div>
    );
  }

  if (!data || data.pages.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-stone-400 text-sm">Alignment data unavailable.</div>
      </div>
    );
  }

  const page = data.pages[selectedPage];
  const links = page.alignments[method] || [];

  const srcWeights = buildHighlightMap(links, hoveredRange, hoverSide, page.sourceText.length, 'source');
  const transWeights = buildHighlightMap(links, hoveredRange, hoverSide, page.translationText.length, 'translation');

  // Also highlight the hovered side's own text
  const srcDisplay = new Float32Array(srcWeights);
  const transDisplay = new Float32Array(transWeights);

  if (hoveredRange && hoverSide === 'source') {
    for (let i = hoveredRange[0]; i < Math.min(hoveredRange[1], page.sourceText.length); i++) {
      srcDisplay[i] = Math.max(srcDisplay[i], 0.4);
    }
  }
  if (hoveredRange && hoverSide === 'translation') {
    for (let i = hoveredRange[0]; i < Math.min(hoveredRange[1], page.translationText.length); i++) {
      transDisplay[i] = Math.max(transDisplay[i], 0.4);
    }
  }

  const methodDescriptions: Record<Method, { label: string; sublabel: string }> = {
    llm: { label: 'LLM Alignment', sublabel: `Gemini 2.5 Flash \u00b7 ${links.length} links` },
    embedding: { label: 'Embedding Similarity', sublabel: `Cognate heuristic \u00b7 ${links.length} links` },
  };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden shadow-sm">
      {/* Controls */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 bg-stone-50/50">
        <div className="flex items-center gap-2">
          {(['llm', 'embedding'] as Method[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMethod(m); setHoveredRange(null); setHoverSide(null); }}
              className={`px-4 py-2 text-sm rounded-lg transition-all ${
                method === m
                  ? 'bg-stone-800 text-white shadow-sm'
                  : 'text-stone-500 hover:text-stone-700 hover:bg-stone-100'
              }`}
            >
              <span className="font-medium">{methodDescriptions[m].label}</span>
              <span className={`ml-2 text-xs ${method === m ? 'text-stone-300' : 'text-stone-400'}`}>
                {methodDescriptions[m].sublabel}
              </span>
            </button>
          ))}
        </div>

        <select
          value={selectedPage}
          onChange={(e) => { setSelectedPage(Number(e.target.value)); setHoveredRange(null); setHoverSide(null); }}
          className="text-sm border border-stone-200 rounded-lg px-3 py-1.5 bg-white text-stone-600"
        >
          {data.pages.map((p, i) => (
            <option key={p.id} value={i}>
              {p.author} &mdash; {p.book}
            </option>
          ))}
        </select>
      </div>

      {/* Alignment detail bar */}
      <div className="px-5 py-2 border-b border-stone-100 bg-[#fdfcfa] min-h-[52px] flex items-center">
        <AlignmentDetail links={links} hoveredRange={hoveredRange} hoverSide={hoverSide} />
      </div>

      {/* Split pane */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-100">
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            {page.sourceLanguage} Source
          </div>
          <HighlightedText
            text={page.sourceText}
            weights={srcDisplay}
            onHoverRange={handleHover}
            side="source"
            links={links}
          />
        </div>
        <div className="p-6">
          <div className="text-[11px] font-semibold text-stone-400 uppercase tracking-[0.15em] mb-4">
            English Translation
          </div>
          <HighlightedText
            text={page.translationText}
            weights={transDisplay}
            onHoverRange={handleHover}
            side="translation"
            links={links}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/50 flex items-center justify-center gap-6 text-xs text-stone-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-2 rounded-full" style={{ background: 'rgba(180,130,50,0.6)' }} />
          Direct translation
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-2 rounded-full" style={{ background: 'rgba(180,130,50,0.35)' }} />
          Contextual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-2 rounded-full" style={{ background: 'rgba(180,130,50,0.15)' }} />
          Implied / restructured
        </span>
      </div>
    </div>
  );
}
