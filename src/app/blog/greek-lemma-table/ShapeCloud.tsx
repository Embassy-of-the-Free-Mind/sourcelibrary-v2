'use client';

/**
 * Explorable for the lemma-table post: every (unambiguous) attested shape of
 * one Greek word, orbiting its dictionary headword. Sizes follow corpus
 * frequency; hover/tap a shape for its count. Data is baked from the
 * published dataset (shape-data.json — forms attributable to exactly one
 * lemma, so the figure never shows the multi-lemma noise class).
 */

import { useMemo, useState } from 'react';
import shapeData from './shape-data.json';

const WORDS: Array<{ headword: keyof typeof shapeData; gloss: string }> = [
  { headword: 'εἰμί', gloss: 'to be' },
  { headword: 'ποιέω', gloss: 'to make, do' },
  { headword: 'λέγω', gloss: 'to say' },
];

const GOLDEN = 137.508;

export default function ShapeCloud() {
  const [word, setWord] = useState<(typeof WORDS)[number]>(WORDS[0]);
  const [picked, setPicked] = useState<{ form: string; count: number } | null>(null);

  const { forms, total } = shapeData[word.headword];
  const placed = useMemo(() => {
    const max = forms[0][1] as number;
    return (forms as Array<[string, number]>).map(([form, count], i) => {
      const angle = (i * GOLDEN * Math.PI) / 180;
      const r = 62 + 15.5 * Math.sqrt(i + 1);
      const size = 10 + 21 * Math.sqrt(Math.log(count + 1) / Math.log(max + 1));
      return { form, count, x: 350 + r * Math.cos(angle), y: 265 + r * 0.82 * Math.sin(angle), size };
    });
  }, [forms]);

  return (
    <figure className="my-10">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {WORDS.map((w) => (
          <button
            key={w.headword}
            type="button"
            onClick={() => { setWord(w); setPicked(null); }}
            aria-pressed={word.headword === w.headword}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              word.headword === w.headword
                ? 'bg-accent-rust text-white border-accent-rust'
                : 'bg-white text-stone-600 border-stone-300 hover:border-accent-rust'
            }`}
            lang="grc"
          >
            {w.headword}
            <span className="opacity-70"> · {shapeData[w.headword].total} shapes</span>
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-stone-200 bg-white overflow-hidden">
        <svg viewBox="0 0 700 530" className="w-full h-auto" role="img" aria-label={`Word cloud: the attested shapes of ${word.headword} in the Source Library corpus, sized by frequency`}>
          <g key={word.headword}>
            {placed.map((p) => (
              <text
                key={p.form}
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={p.size}
                fill={picked?.form === p.form ? '#c45d3a' : '#78716c'}
                opacity={picked && picked.form !== p.form ? 0.35 : 0.9}
                style={{ cursor: 'pointer', transition: 'opacity 200ms, fill 200ms' }}
                lang="grc"
                onMouseEnter={() => setPicked({ form: p.form, count: p.count })}
                onClick={() => setPicked({ form: p.form, count: p.count })}
              >
                {p.form}
              </text>
            ))}
            <circle cx={350} cy={265} r={54} fill="#fef9ef" stroke="#e7e5e4" />
            <text x={350} y={256} textAnchor="middle" fontSize="26" fontWeight="700" fill="#c45d3a" lang="grc">
              {word.headword}
            </text>
            <text x={350} y={280} textAnchor="middle" fontSize="12" fill="#78716c" fontStyle="italic">
              {word.gloss}
            </text>
          </g>
        </svg>
        <div className="px-4 py-2.5 border-t border-stone-200 text-sm text-stone-600 min-h-[2.6rem]" aria-live="polite">
          {picked ? (
            <>
              <span lang="grc" className="font-semibold text-stone-800">{picked.form}</span>
              {' '}appears <span className="font-semibold">{picked.count.toLocaleString()}</span> times
              across our Greek books &mdash; every one of them findable under{' '}
              <span lang="grc" className="font-semibold text-stone-800">{word.headword}</span>.
            </>
          ) : (
            <>Hover or tap a shape. Showing the {placed.length} most frequent of {total} shapes
            attributable to this word alone.</>
          )}
        </div>
      </div>
      <figcaption className="text-sm text-stone-500 mt-3">
        Real attested spellings and inflections from 471,544 scanned pages, sized by how often
        they occur. Shapes shared with other dictionary words are excluded here &mdash; ποιέω
        alone has {shapeData['ποιέω'].total} unambiguous shapes.
      </figcaption>
    </figure>
  );
}
