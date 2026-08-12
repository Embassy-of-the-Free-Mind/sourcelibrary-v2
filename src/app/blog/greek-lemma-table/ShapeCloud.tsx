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
    // Collision-aware spiral: each label walks outward along the golden-angle
    // spiral until its estimated box clears everything already placed (and
    // the center medallion). Deterministic — no randomness.
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [
      { x: 350 - 62, y: 265 - 62, w: 124, h: 124 },
    ];
    const out: Array<{ form: string; count: number; x: number; y: number; size: number }> = [];
    (forms as Array<[string, number]>).forEach(([form, count], i) => {
      const size = 8.5 + 18 * Math.sqrt(Math.log(count + 1) / Math.log(max + 1));
      const w = form.length * size * 0.55 + 4;
      const h = size * 1.08;
      for (let t = i; t < i + 900; t++) {
        const angle = (t * GOLDEN * Math.PI) / 180;
        const r = 38 + 5.3 * Math.sqrt(t + 1);
        const x = 350 + r * Math.cos(angle);
        const y = 265 + r * 0.8 * Math.sin(angle);
        const box = { x: x - w / 2, y: y - h / 2, w, h };
        if (box.x < 6 || box.y < 6 || box.x + box.w > 694 || box.y + box.h > 524) continue;
        const hit = rects.some(
          (q) => box.x < q.x + q.w && q.x < box.x + box.w && box.y < q.y + q.h && q.y < box.y + box.h
        );
        if (!hit) {
          rects.push(box);
          out.push({ form, count, x, y, size });
          return;
        }
      }
      // no space left — drop the tail form rather than overlap
    });
    return out;
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
