'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

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

// Build a character-level highlight map from alignment links
function buildHighlightMap(
  links: AlignmentLink[],
  hoveredRange: [number, number] | null,
  hoverSide: HoverSide,
  textLength: number,
  side: 'source' | 'translation'
): Float32Array {
  const weights = new Float32Array(textLength);
  if (!hoveredRange || !hoverSide) return weights;

  const isHoveredSide = side === hoverSide;
  if (isHoveredSide) return weights;

  // Find all links that overlap with the hovered range on the hovered side
  for (const link of links) {
    const hoveredField = hoverSide === 'source' ? 'src' : 'en';
    const targetField = side === 'source' ? 'src' : 'en';
    const [hStart, hEnd] = link[hoveredField];
    const [rStart, rEnd] = hoveredRange;

    // Check overlap
    if (hStart < rEnd && hEnd > rStart) {
      const [tStart, tEnd] = link[targetField];
      for (let i = tStart; i < Math.min(tEnd, textLength); i++) {
        weights[i] = Math.max(weights[i], link.weight);
      }
    }
  }

  return weights;
}

// Render text with character-level highlighting
function HighlightedText({
  text,
  weights,
  onHoverRange,
  side,
  isHoveredSide,
  links,
}: {
  text: string;
  weights: Float32Array;
  onHoverRange: (range: [number, number] | null, side: HoverSide) => void;
  side: 'source' | 'translation';
  isHoveredSide: boolean;
  links: AlignmentLink[];
}) {
  // Build spans: group consecutive characters with the same weight
  const spans = useMemo(() => {
    const result: { text: string; weight: number; start: number; end: number }[] = [];
    let currentWeight = weights[0] || 0;
    let spanStart = 0;

    for (let i = 1; i <= text.length; i++) {
      const w = i < text.length ? (weights[i] || 0) : -1;
      if (w !== currentWeight) {
        result.push({
          text: text.substring(spanStart, i),
          weight: currentWeight,
          start: spanStart,
          end: i,
        });
        currentWeight = w;
        spanStart = i;
      }
    }
    return result;
  }, [text, weights]);

  // Find the word boundaries around a character position
  const getWordRange = useCallback(
    (charIndex: number): [number, number] => {
      // Find the link that contains this character
      const field = side === 'source' ? 'src' : 'en';
      for (const link of links) {
        const [start, end] = link[field];
        if (charIndex >= start && charIndex < end) {
          return [start, end];
        }
      }
      // Fallback: find word boundaries
      let start = charIndex;
      let end = charIndex;
      while (start > 0 && /\S/.test(text[start - 1])) start--;
      while (end < text.length && /\S/.test(text[end])) end++;
      return [start, end];
    },
    [links, side, text]
  );

  return (
    <div className="font-serif text-base leading-relaxed whitespace-pre-wrap">
      {spans.map((span, i) => {
        const bgOpacity = span.weight > 0 ? 0.15 + span.weight * 0.55 : 0;
        const isHighlighted = span.weight > 0;
        const isHoverable = !isHoveredSide || isHighlighted;

        return (
          <span
            key={i}
            className={`transition-colors duration-150 ${
              isHoveredSide ? 'cursor-pointer' : ''
            }`}
            style={{
              backgroundColor: isHighlighted
                ? `rgba(180, 130, 50, ${bgOpacity})`
                : isHoveredSide
                  ? undefined
                  : undefined,
              borderBottom: isHighlighted ? '2px solid rgba(180, 130, 50, 0.6)' : undefined,
            }}
            onMouseEnter={() => {
              if (isHoverable) {
                const range = getWordRange(span.start);
                onHoverRange(range, side);
              }
            }}
            onMouseLeave={() => {
              onHoverRange(null, null);
            }}
          >
            {span.text}
          </span>
        );
      })}
    </div>
  );
}

function AlignmentStats({ links, label }: { links: AlignmentLink[]; label: string }) {
  const total = links.length;
  const high = links.filter((l) => l.weight >= 0.9).length;
  const mid = links.filter((l) => l.weight >= 0.5 && l.weight < 0.9).length;
  const low = links.filter((l) => l.weight < 0.5).length;

  return (
    <div className="flex items-center gap-4 text-xs text-stone-500">
      <span className="font-medium text-stone-700">{label}</span>
      <span>{total} links</span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-amber-600" /> {high} direct
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-amber-400" /> {mid} contextual
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-amber-200" /> {low} implied
      </span>
    </div>
  );
}

function AlignmentTooltip({
  links,
  hoveredRange,
  hoverSide,
}: {
  links: AlignmentLink[];
  hoveredRange: [number, number] | null;
  hoverSide: HoverSide;
}) {
  if (!hoveredRange || !hoverSide) return null;

  const matchingLinks = links.filter((link) => {
    const field = hoverSide === 'source' ? 'src' : 'en';
    const [start, end] = link[field];
    return start < hoveredRange[1] && end > hoveredRange[0];
  });

  if (matchingLinks.length === 0) return null;

  return (
    <div className="mt-3 p-3 bg-stone-50 border border-stone-200 rounded-lg text-sm">
      <div className="text-xs text-stone-500 mb-2">
        {matchingLinks.length} alignment{matchingLinks.length !== 1 ? 's' : ''} for selected text
      </div>
      <div className="space-y-1">
        {matchingLinks.slice(0, 8).map((link, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{
                backgroundColor: `rgba(180, 130, 50, ${0.3 + link.weight * 0.7})`,
              }}
            />
            <span className="font-serif italic text-stone-700">{link.src_text}</span>
            <span className="text-stone-400">&rarr;</span>
            <span className="font-serif text-stone-900">{link.en_text}</span>
            <span className="text-xs text-stone-400 ml-auto">
              {link.weight === 1 ? 'direct' : link.weight >= 0.7 ? 'contextual' : 'implied'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WordAlignmentPage() {
  const [data, setData] = useState<AlignmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPage, setSelectedPage] = useState(0);
  const [method, setMethod] = useState<Method>('llm');
  const [hoveredRange, setHoveredRange] = useState<[number, number] | null>(null);
  const [hoverSide, setHoverSide] = useState<HoverSide>(null);

  useEffect(() => {
    fetch('/data/experiments/alignment-results.json')
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        console.error('Failed to load alignment data:', e);
        setLoading(false);
      });
  }, []);

  const handleHover = useCallback(
    (range: [number, number] | null, side: HoverSide) => {
      setHoveredRange(range);
      setHoverSide(side);
    },
    []
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-stone-400">Loading alignment data...</div>
      </div>
    );
  }

  if (!data || data.pages.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-stone-500">No alignment data found.</div>
      </div>
    );
  }

  const page = data.pages[selectedPage];
  const links = page.alignments[method] || [];

  const srcWeights = buildHighlightMap(
    links,
    hoveredRange,
    hoverSide,
    page.sourceText.length,
    'source'
  );

  const transWeights = buildHighlightMap(
    links,
    hoveredRange,
    hoverSide,
    page.translationText.length,
    'translation'
  );

  // When hovering source side, highlight the hovered source range itself
  const srcDisplayWeights = new Float32Array(srcWeights);
  const transDisplayWeights = new Float32Array(transWeights);

  if (hoveredRange && hoverSide === 'source') {
    for (let i = hoveredRange[0]; i < Math.min(hoveredRange[1], page.sourceText.length); i++) {
      srcDisplayWeights[i] = Math.max(srcDisplayWeights[i], 0.5);
    }
  }
  if (hoveredRange && hoverSide === 'translation') {
    for (
      let i = hoveredRange[0];
      i < Math.min(hoveredRange[1], page.translationText.length);
      i++
    ) {
      transDisplayWeights[i] = Math.max(transDisplayWeights[i], 0.5);
    }
  }

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      {/* Header */}
      <div className="border-b border-stone-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/experiments"
                className="text-stone-400 hover:text-stone-600 transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-stone-900">Word Alignment Explorer</h1>
                <p className="text-sm text-stone-500">
                  Hover over text on either side to see translation correspondences
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Page selector */}
              <select
                value={selectedPage}
                onChange={(e) => {
                  setSelectedPage(Number(e.target.value));
                  setHoveredRange(null);
                  setHoverSide(null);
                }}
                className="text-sm border border-stone-300 rounded-lg px-3 py-1.5 bg-white"
              >
                {data.pages.map((p, i) => (
                  <option key={p.id} value={i}>
                    {p.author} &mdash; {p.book} (p.{p.page})
                  </option>
                ))}
              </select>

              {/* Method switcher */}
              <div className="flex border border-stone-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => {
                    setMethod('llm');
                    setHoveredRange(null);
                    setHoverSide(null);
                  }}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    method === 'llm'
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  LLM Alignment
                </button>
                <button
                  onClick={() => {
                    setMethod('embedding');
                    setHoveredRange(null);
                    setHoverSide(null);
                  }}
                  className={`px-3 py-1.5 text-sm transition-colors border-l border-stone-300 ${
                    method === 'embedding'
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  Embedding Similarity
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="max-w-7xl mx-auto px-6 py-3 border-b border-stone-100">
        <AlignmentStats links={links} label={method === 'llm' ? 'Gemini 2.5 Flash' : 'Cognate Heuristic'} />
      </div>

      {/* Split pane */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="grid grid-cols-2 gap-8">
          {/* Source (Latin) */}
          <div>
            <div className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">
              {page.sourceLanguage} Source
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
              <HighlightedText
                text={page.sourceText}
                weights={srcDisplayWeights}
                onHoverRange={handleHover}
                side="source"
                isHoveredSide={hoverSide === 'source'}
                links={links}
              />
            </div>
          </div>

          {/* Translation (English) */}
          <div>
            <div className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">
              English Translation
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-sm">
              <HighlightedText
                text={page.translationText}
                weights={transDisplayWeights}
                onHoverRange={handleHover}
                side="translation"
                isHoveredSide={hoverSide === 'translation'}
                links={links}
              />
            </div>
          </div>
        </div>

        {/* Tooltip / detail panel */}
        <AlignmentTooltip links={links} hoveredRange={hoveredRange} hoverSide={hoverSide} />

        {/* Explainer */}
        <div className="mt-8 prose prose-stone max-w-none">
          <h2 className="text-lg font-semibold text-stone-800">About this experiment</h2>
          <p className="text-sm text-stone-600 leading-relaxed">
            This page demonstrates two approaches to word-level alignment between Latin source text
            and English translation. <strong>LLM Alignment</strong> uses Gemini 2.5 Flash to produce
            semantically-aware mappings that handle word reordering (Latin SOV &rarr; English SVO),
            one-to-many translations, and pre-modern orthographic variation.{' '}
            <strong>Embedding Similarity</strong> uses a cognate-detection heuristic as a stand-in
            for full multilingual embedding cosine similarity (e.g., multilingual-e5). It catches
            Latin-English cognates (&ldquo;natura&rdquo; &rarr; &ldquo;nature&rdquo;) but misses
            non-cognate translations and word reordering.
          </p>
          <p className="text-sm text-stone-600 leading-relaxed">
            Highlight intensity indicates confidence: strong gold = direct translation (1.0),
            medium = contextual correspondence (0.7), faint = implied or restructured meaning (0.4).
          </p>
        </div>
      </div>
    </div>
  );
}
