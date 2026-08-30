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

// Scholarly romanization for normalized polytonic Greek (lowercase input).
const ROM: Record<string, string> = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'ē', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'ō', ϝ: 'w',
};
const VOWELS = 'αεηιου';

export function romanize(word: string): string {
  // Per-character mark handling (a word-level pass gets three things wrong:
  // iota subscripts land at the word end, initial ῥ becomes h…r instead of
  // rh, and stripping the diaeresis merges the very diphthong it blocks).
  const nfd = word.normalize('NFD');
  const tokens: Array<{ base: string; iotaSub: boolean; diaeresis: boolean; rough: boolean }> = [];
  for (const ch of nfd) {
    if (/[̀-ͯͅ]/.test(ch)) {
      const t = tokens[tokens.length - 1];
      if (!t) continue;
      if (ch === 'ͅ') t.iotaSub = true;
      else if (ch === '̈') t.diaeresis = true;
      else if (ch === '̔') t.rough = true;
    } else {
      tokens.push({ base: ch, iotaSub: false, diaeresis: false, rough: false });
    }
  }
  const rough = tokens.some((t) => t.rough);
  const initialRho = tokens[0]?.base === 'ρ' && tokens[0].rough;
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (i === 0 && initialRho) { out += 'rh'; continue; }
    if (t.base === 'γ' && next && 'γκξχ'.includes(next.base)) { out += 'n'; if (t.iotaSub) out += 'i'; continue; }
    if (
      t.base === 'υ' && i > 0 && VOWELS.includes(tokens[i - 1].base) &&
      tokens[i - 1].base !== 'υ' && !t.diaeresis
    ) { out += 'u'; if (t.iotaSub) out += 'i'; continue; }
    out += ROM[t.base] ?? t.base;
    if (t.iotaSub) out += 'i';
  }
  return (rough && !initialRho ? 'h' : '') + out;
}

export default function ShapeCloud() {
  const [word, setWord] = useState<(typeof WORDS)[number]>(WORDS[0]);
  const [picked, setPicked] = useState<{ form: string; count: number; parse: string } | null>(null);
  const [roman, setRoman] = useState(false);

  const { forms, total } = shapeData[word.headword];
  const placed = useMemo(() => {
    const max = forms[0][1] as number;
    // Collision-aware spiral: each label walks outward along the golden-angle
    // spiral until its estimated box clears everything already placed (and
    // the center medallion). Deterministic — no randomness.
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [
      { x: 350 - 62, y: 265 - 62, w: 124, h: 124 },
    ];
    const out: Array<{ form: string; count: number; parse: string; label: string; x: number; y: number; size: number }> = [];
    (forms as Array<[string, number, string?]>).forEach(([form, count, parse], i) => {
      const size = 8.5 + 18 * Math.sqrt(Math.log(count + 1) / Math.log(max + 1));
      const label = roman ? romanize(form) : form;
      const w = label.length * size * 0.55 + 4;
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
          out.push({ form, count, parse: parse ?? '', label, x, y, size });
          return;
        }
      }
      // no space left — drop the tail form rather than overlap
    });
    return out;
  }, [forms, roman]);

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
            <span className="opacity-70" lang="grc-Latn"> {romanize(w.headword)}</span>
            <span className="opacity-70"> · {shapeData[w.headword].total} shapes</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setRoman((v) => !v); }}
          aria-pressed={roman}
          className={`ml-auto px-3 py-1.5 rounded-full text-sm border transition-colors ${
            roman ? 'bg-stone-700 text-white border-stone-700' : 'bg-white text-stone-600 border-stone-300 hover:border-stone-500'
          }`}
        >
          {roman ? 'Greek letters' : 'Roman letters'}
        </button>
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
                onMouseEnter={() => setPicked({ form: p.form, count: p.count, parse: p.parse })}
                onClick={() => setPicked({ form: p.form, count: p.count, parse: p.parse })}
              >
                {p.label}
              </text>
            ))}
            <circle cx={350} cy={265} r={54} fill="#fef9ef" stroke="#e7e5e4" />
            <text x={350} y={250} textAnchor="middle" fontSize="26" fontWeight="700" fill="#c45d3a" lang="grc">
              {word.headword}
            </text>
            <text x={350} y={270} textAnchor="middle" fontSize="13" fill="#a8a29e">
              {romanize(word.headword)}
            </text>
            <text x={350} y={287} textAnchor="middle" fontSize="12" fill="#78716c" fontStyle="italic">
              {word.gloss}
            </text>
          </g>
        </svg>
        <div className="px-4 py-2.5 border-t border-stone-200 text-sm text-stone-600 min-h-[2.6rem]" aria-live="polite">
          {picked ? (
            <>
              <span lang="grc" className="font-semibold text-stone-800">{picked.form}</span>
              {' '}<span className="text-stone-500">({romanize(picked.form)})</span>
              {picked.parse && (
                <> &mdash; <span className="text-accent-rust">{picked.parse}</span> of{' '}
                <span lang="grc" className="font-semibold text-stone-800">{word.headword}</span>,{' '}
                <span className="italic">{word.gloss}</span></>
              )}
              {'. '}Appears <span className="font-semibold">{picked.count.toLocaleString()}</span>{' '}
              times across our Greek books.
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
