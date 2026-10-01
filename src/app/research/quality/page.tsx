import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Every number on this page is embedded at build from a committed file in
// scripts/eval/ (see SOURCES). No request-time fetch, so ISR cannot cache a
// fallback; the window only matters if the layout around it changes.
export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'How Page Quality Is Measured (draft) — Source Library Research',
  description:
    'Does this English say what is printed on this leaf? We split the reader’s question into three links and ask which link each of our quality instruments measures. A paper draft, with the data.',
  alternates: { canonical: '/research/quality' },
  openGraph: {
    title: 'How page quality is measured',
    description:
      'Three links between a scan and its English, and which instrument covers which. A paper draft from Source Library, with the data and code.',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', width: 1200, height: 630, alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
};

const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';

/* ── Sources: every number on the page cites one of these by note number ── */
const SOURCES = [
  { path: 'src/data/ocr-benchmark-evidence.json', what: 'OCR benchmark evidence table: character error rate against a published reference, per cell, with grades (Latin language cells; totals by grade).' },
  { path: 'scripts/eval/DECISIONS.md', what: 'Decision ledger: per-stratum evidence, measure, grade, and which strata have no reference pages.' },
  { path: 'scripts/eval/experiments/2026-09-30-which-engine-reads-printed-numbers-correctly-engine-disagreements-adjudicated-5224.md', what: 'Printed numbers, two engines, disagreements read blind on the page image (#5224).' },
  { path: 'scripts/eval/experiments/2026-09-30-does-disagreement-between-two-reads-of-one-page-find-5313.md', what: 'Two reads of one page as a garble screen and a wrong-leaf check (#5313).' },
  { path: 'scripts/eval/results/two-read-garble-5313-2026-09-30/report.json', what: 'Per-arm counts behind Figure 3 (sweep row “ratio < 0.7”, three-read classes, judge vs itself).' },
  { path: 'scripts/eval/results/translation-corpus-audit-2026-09-30/report.md', what: 'Translation corpus audit: controls, post-stratified estimate, per-language counts, inter-judge agreement (#5274).' },
  { path: 'scripts/eval/results/translation-corpus-audit-2026-09-30/eye-notes.md', what: 'Model read of 20 audited pages against their scans: flag precision, leaf identity.' },
  { path: 'scripts/eval/results/translation-corpus-audit-2026-09-30/items.jsonl', what: 'The transcription and translation of each audited page as served on the audit date (specimens in Figure 2).' },
  { path: '.claude/docs/eval-design.md', what: 'Measurement vocabulary (§2) and the reader’s chain table (§2.1) behind Figure 1.' },
  { path: 'scripts/eval/translation-corpus-audit/HUMAN-CALIBRATION.md', what: 'Protocol for the reader panel (§6 of this draft).' },
  { path: '.claude/docs/ocr-memorization-paper.md', what: 'Working paper on the memorisation subsidy: matched canonical and non-canonical passages on pages of the same books.' },
  { path: 'scripts/eval/experiments/2026-09-16-is-our-syriac-ocr-a-reading-of-the-page-4883.md', what: 'Syriac OCR against published Syriac and published English: wrong passages and text not in the Bible (#4883).' },
] as const;

function N({ n }: { n: number }) {
  return (
    <sup className="text-[0.7em] ml-0.5">
      <a href={`#source-${n}`} className="text-accent-rust hover:underline">{n}</a>
    </sup>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section id={`s${n}`} className="mt-14">
      <h2 className="text-2xl md:text-3xl text-primary mb-6">
        <span className="text-muted tabular-nums mr-3">{n}.</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-secondary leading-relaxed mb-6">{children}</p>;
}

function Figure({ n, caption, children }: { n: number; caption: ReactNode; children: ReactNode }) {
  return (
    <figure id={`fig${n}`} className="my-10">
      {children}
      <figcaption className="text-sm text-muted mt-3 leading-relaxed">
        <span className="font-semibold text-secondary">Figure {n}.</span> {caption}
      </figcaption>
    </figure>
  );
}

/** Wilson score interval (Wilson 1927), 95%. */
function wilson(k: number, n: number, z = 1.96): [number, number] {
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/* ── Figure 1: the chain ── */
type Cover = 'yes' | 'part' | 'no';
const CHAIN_ROWS: { instrument: string; cells: [Cover, string][] }[] = [
  {
    instrument: 'Accuracy against a published reference',
    cells: [
      ['no', 'none'],
      ['part', 'decision-grade in a few strata only'],
      ['part', 'Tibetan against 84000 only'],
    ],
  },
  {
    instrument: 'Screen: a second read of the same page',
    cells: [
      ['yes', 'three-read signature, 7 of 7 known cases'],
      ['part', 'two-read screen: most garble found, imprecisely'],
      ['no', 'none'],
    ],
  },
  {
    instrument: 'Source-grounded model judge',
    cells: [
      ['no', 'blind: it sees no image'],
      ['part', 'only garble the translation carried through'],
      ['yes', 'corpus audit, monthly rerun'],
    ],
  },
  {
    instrument: 'A human who reads the original',
    cells: [
      ['yes', 'not yet run (§6)'],
      ['yes', 'not yet run (§6)'],
      ['yes', 'not yet run (§6)'],
    ],
  },
];
const LINKS = [
  { n: 1, name: 'Leaf', q: 'the image shown is the leaf transcribed', fail: 'wrong leaf' },
  { n: 2, name: 'Transcription', q: 'the transcription matches the image', fail: 'misread, garble, recitation' },
  { n: 3, name: 'Translation', q: 'the English matches the transcription', fail: 'omission, invention, inversion' },
];

function CoverMark({ c }: { c: Cover }) {
  const label = c === 'yes' ? 'covers' : c === 'part' ? 'partly' : 'does not cover';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="inline-block mr-1.5 -mt-0.5 shrink-0" role="img" aria-label={label}>
      <circle cx="7" cy="7" r="5.5" fill={c === 'yes' ? 'var(--accent-rust)' : 'none'} stroke={c === 'no' ? 'var(--text-muted)' : 'var(--accent-rust)'} strokeWidth="1.5" />
      {c === 'part' && <path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5 Z" fill="var(--accent-rust)" />}
    </svg>
  );
}

function ChainFigure() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[600px]">
        {/* the chain itself */}
        <div className="grid grid-cols-[11rem_1fr_1fr_1fr] gap-x-3 items-end mb-2">
          <div />
          <div className="col-span-2 flex items-center justify-between text-primary font-serif text-lg px-2">
            <span>Scan</span>
            <span className="flex-1 border-t border-dashed border-light mx-3" />
            <span>Transcription</span>
          </div>
          <div className="flex items-center justify-between text-primary font-serif text-lg px-2">
            <span className="flex-1 border-t border-dashed border-light mr-3" />
            <span>English</span>
          </div>
        </div>
        <div className="grid grid-cols-[11rem_1fr_1fr_1fr] gap-x-3 border-b border-light pb-3">
          <div className="text-xs text-muted self-end">Instrument ↓ / link →</div>
          {LINKS.map(l => (
            <div key={l.n} className="text-sm">
              <div className="text-primary font-semibold">{l.n}. {l.name}</div>
              <div className="text-secondary leading-snug">{l.q}</div>
              <div className="text-muted text-xs mt-1">fails as: {l.fail}</div>
            </div>
          ))}
        </div>
        {CHAIN_ROWS.map(r => (
          <div key={r.instrument} className="grid grid-cols-[11rem_1fr_1fr_1fr] gap-x-3 border-b border-light py-3 text-sm">
            <div className="text-primary leading-snug">{r.instrument}</div>
            {r.cells.map(([c, t], i) => (
              <div key={i} className="flex items-start text-secondary leading-snug">
                <CoverMark c={c} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="flex gap-5 text-xs text-muted mt-3">
          <span className="flex items-center"><CoverMark c="yes" />covers</span>
          <span className="flex items-center"><CoverMark c="part" />partly</span>
          <span className="flex items-center"><CoverMark c="no" />does not cover</span>
        </div>
      </div>
    </div>
  );
}

/* ── Figure 2: specimens ── */
// Crop boxes are in the display image's own pixels (checked by eye on 2026-10-01).
type Specimen = {
  key: string;
  title: string;
  book: string;
  href: string;
  image: string;
  size: [number, number];
  crop: { x: number; y: number; w: number; h: number };
  alt: string;
  scanNote: ReactNode;
  transcription: string;
  transcriptionLang: string;
  english: string;
  note: ReactNode;
};

const SPECIMENS: Specimen[] = [
  {
    key: 'garble',
    title: 'a. Garble carried into English',
    book: 'Harak isu (manuscript, 1632), p. 117',
    href: '/book/harak-isu-chen/page/69f33b96876dd827cbc58fd6',
    image: 'https://images.sourcelibrary.org/pages/69f33b96876dd827cbc58f61/0117.jpg',
    size: [2000, 3100],
    crop: { x: 1820, y: 20, w: 180, h: 900 },
    alt: 'The first column of a semi-cursive Chinese manuscript page, reading from the top 象曰山下有雷頤',
    scanNote: <>reads 象曰山下有雷頤, the Image text of <em>Yijing</em> hexagram 27</>,
    transcription: '象白山下有雷願子者。慎言語。節飲食。…\n人皆云。雷願視赤子願。…',
    transcriptionLang: 'zh',
    english: 'The Image says: Thunder at the foot of the Mountain. … People all say: The "Thunder Vow" … is like the vow of a child.',
    note: <>The transcription has 白 for 曰 and 願 for 頤. The English translates the misread faithfully, so the hexagram&rsquo;s name becomes &ldquo;Thunder Vow&rdquo;. The judge flagged it as garble carried through, and the model read of the scan confirmed it.</>,
  },
  {
    key: 'leaf',
    title: 'b. Wrong leaf',
    book: 'The Oxyrhynchus Papyri, Part V (1908), image 240',
    href: '/book/the-oxyrhynchus-papyri-part-5-hunt/page/69cf7bb9878f40c5945f1fda',
    image: 'https://images.sourcelibrary.org/pages/69cf7bb9878f40c5945f1eea/0240.jpg',
    size: [2000, 2944],
    crop: { x: 300, y: 320, w: 1640, h: 300 },
    alt: 'The head of a printed page numbered 224, THE OXYRHYNCHUS PAPYRI, beginning “magistrates that they enjoyed the privileges of the league”',
    scanNote: <>is printed page 224, on the Boeotian constitution</>,
    transcription: '842. THEOPOMPUS (OR CRATIPPUS), HELLENICA 223\n\nprisoner in 407, but released (Xen. Hell. i. 5. 19). …',
    transcriptionLang: 'en',
    english: '842. THEOPOMPUS (OR CRATIPPUS), HELLENICA 223 … He was taken prisoner in 407 BCE, but was later released …',
    note: <>The text is printed page 223. The translation is faithful to it, and the judge rated it 5 of 5; it could not have known that the reader sees page 224 beside it. Text as served on 30 September 2026; the page has since been re-read from its image.</>,
  },
  {
    key: 'inversion',
    title: 'c. Inversion',
    book: 'Prashna Deepakam (Sanskrit manuscript), p. 16',
    href: '/book/prashna-deepakam/page/69907c5a5f855ec553e74a2c',
    image: 'https://images.sourcelibrary.org/pages/69907c595f855ec553e74a1b/0016.jpg',
    size: [2000, 1303],
    crop: { x: 250, y: 150, w: 1500, h: 220 },
    alt: 'Two lines of Devanagari in dark ink on a ruled leaf, ending …नामन / हीस्मरेत् ३',
    scanNote: <>ends the sentence <em>nāma na hi smaret</em>, &ldquo;one should not remember the name&rdquo;</>,
    transcription: 'दिशातु अपरानेदेवतानामरात्रौनामन\nहीस्मरेत् ३',
    transcriptionLang: 'sa',
    english: 'One should remember the names of the deities of the directions in the afternoon and at night\n\nIndeed, one should remember them. 3',
    note: <>The transcription has the negative (<em>na hi smaret</em>, split across the line break). The English drops it and turns a prohibition into an injunction.</>,
  },
];

function ScanCrop({ s }: { s: Specimen }) {
  const { x, y, w, h } = s.crop;
  const [W] = s.size;
  return (
    <div className="relative overflow-hidden rounded border border-light bg-white" style={{ aspectRatio: `${w} / ${h}` }}>
      <img
        src={s.image}
        alt={s.alt}
        loading="lazy"
        className="absolute max-w-none"
        style={{ width: `${(W / w) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }}
      />
    </div>
  );
}

function SpecimenRow({ s }: { s: Specimen }) {
  const vertical = s.crop.h > s.crop.w;
  return (
    <div className="border-t border-light pt-5 mt-5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 mb-3">
        <h3 className="text-lg text-primary font-semibold">{s.title}</h3>
        <Link href={s.href} className="text-sm text-accent-rust hover:underline">{s.book}</Link>
      </div>
      <div className={`grid gap-4 ${vertical ? 'grid-cols-[5rem_1fr] md:grid-cols-[6rem_1fr_1fr]' : 'md:grid-cols-3'}`}>
        <div className={vertical ? 'row-span-2 md:row-span-1' : ''}>
          <div className="text-xs uppercase tracking-wider text-muted mb-1.5">Scan</div>
          <div className={vertical ? 'max-w-[6rem]' : ''}>
            <ScanCrop s={s} />
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1.5">Transcription</div>
          <p lang={s.transcriptionLang} className="text-secondary text-sm leading-relaxed whitespace-pre-line">{s.transcription}</p>
        </div>
        <div className={vertical ? 'col-start-2 md:col-start-auto' : ''}>
          <div className="text-xs uppercase tracking-wider text-muted mb-1.5">English</div>
          <p className="text-secondary text-sm leading-relaxed whitespace-pre-line">{s.english}</p>
        </div>
      </div>
      <p className="text-sm text-muted leading-relaxed mt-3">
        The scan {s.scanNote}. {s.note}
      </p>
    </div>
  );
}

/* ── Figure 5: judge rating by language ── */
// From report.md "By language": n books and the 1/2/3/4/5 counts; k = ratings 4 + 5.
// Arabic and Korean are catalogue labels: the hand read found pages in both
// cells written in another language (German; Classical Chinese).
const BY_LANGUAGE: { lang: string; n: number; k: number; catalogue?: boolean }[] = [
  { lang: 'Latin', n: 60, k: 56 },
  { lang: 'English', n: 36, k: 33 },
  { lang: 'German', n: 36, k: 35 },
  { lang: 'Greek', n: 36, k: 27 },
  { lang: 'French', n: 24, k: 23 },
  { lang: 'Italian', n: 18, k: 16 },
  { lang: 'Dutch', n: 18, k: 15 },
  { lang: 'Chinese', n: 18, k: 14 },
  { lang: 'Sanskrit', n: 12, k: 6 },
  { lang: 'Hebrew', n: 12, k: 10 },
  { lang: 'Arabic', n: 12, k: 9, catalogue: true },
  { lang: 'Tibetan', n: 11, k: 7 },
  { lang: 'Korean', n: 6, k: 3, catalogue: true },
  { lang: 'Spanish', n: 6, k: 6 },
  { lang: 'Japanese', n: 6, k: 4 },
];
const CORPUS_ESTIMATE = 0.891; // post-stratified fidelity ≥ 4, report.md

function LanguageFigure() {
  const rows = BY_LANGUAGE.map(r => ({ ...r, p: r.k / r.n, ci: wilson(r.k, r.n) })).sort((a, b) => b.p - a.p || b.n - a.n);
  const L = 132, R = 600, top = 26, rowH = 24;
  const x = (v: number) => L + v * (R - L);
  const H = top + rows.length * rowH + 8;
  return (
    <>
      <svg viewBox={`0 0 680 ${H}`} className="w-full h-auto" role="img" aria-labelledby="fig5-title">
        <title id="fig5-title">Share of pages the judge rated 4 or 5, by language, with 95% Wilson intervals</title>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 6} stroke="var(--border-light)" strokeWidth="1" />
            <text x={x(t)} y={top - 12} textAnchor="middle" fontSize="11" fill="var(--text-muted)">{t * 100}%</text>
          </g>
        ))}
        <line x1={x(CORPUS_ESTIMATE)} x2={x(CORPUS_ESTIMATE)} y1={top - 6} y2={H - 6} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3 3" />
        {rows.map((r, i) => {
          const cy = top + i * rowH + rowH / 2;
          return (
            <g key={r.lang}>
              <title>{`${r.lang}${r.catalogue ? ' (catalogue label)' : ''}: ${r.k} of ${r.n} books rated 4–5 (${pct(r.p)}; 95% CI ${pct(r.ci[0])}–${pct(r.ci[1])})`}</title>
              <rect x={0} y={cy - rowH / 2} width={680} height={rowH} fill="transparent" />
              <text x={L - 10} y={cy + 4} textAnchor="end" fontSize="12" fill="var(--text-primary)">
                {r.lang}{r.catalogue ? '*' : ''}
                <tspan fill="var(--text-muted)" fontSize="11">{`  n=${r.n}`}</tspan>
              </text>
              <line x1={x(r.ci[0])} x2={x(r.ci[1])} y1={cy} y2={cy} stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
              <circle cx={x(r.p)} cy={cy} r="4.5" fill="var(--accent-rust)" stroke="var(--bg-cream, #fdfcf9)" strokeWidth="2" />
              <text x={R + 14} y={cy + 4} fontSize="11" fill="var(--text-secondary)" className="tabular-nums">{pct(r.p)}</text>
            </g>
          );
        })}
        <text x={x(CORPUS_ESTIMATE) - 4} y={H - 0} textAnchor="end" fontSize="10" fill="var(--text-muted)">all languages, weighted: 89%</text>
      </svg>
      <details className="mt-2 text-sm text-secondary">
        <summary className="cursor-pointer text-muted">Table view</summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-light text-left text-muted">
              <th className="py-1.5 pr-4 font-medium">Language</th>
              <th className="py-1.5 pr-4 font-medium text-right">Books</th>
              <th className="py-1.5 pr-4 font-medium text-right">Rated 4–5</th>
              <th className="py-1.5 pr-4 font-medium text-right">Share</th>
              <th className="py-1.5 font-medium text-right">95% Wilson interval</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map(r => (
              <tr key={r.lang} className="border-b border-light">
                <td className="py-1.5 pr-4">{r.lang}{r.catalogue ? '*' : ''}</td>
                <td className="py-1.5 pr-4 text-right">{r.n}</td>
                <td className="py-1.5 pr-4 text-right">{r.k}</td>
                <td className="py-1.5 pr-4 text-right">{pct(r.p)}</td>
                <td className="py-1.5 text-right">{pct(r.ci[0])}–{pct(r.ci[1])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/* ── Figure 4: planted controls ── */
const CONTROLS: { name: string; planted: string; pass: string; full: number; partial: number; partialLabel?: string }[] = [
  { name: 'Swap', planted: 'the translation of another page', pass: 'rated 2 or lower', full: 15, partial: 0 },
  { name: 'Drop', planted: 'the middle ~35% of the translation removed', pass: 'flagged omission', full: 15, partial: 0 },
  { name: 'Repeat', planted: 'the same item judged twice', pass: 'identical rating', full: 11, partial: 4, partialLabel: 'within one point' },
];

function ControlsFigure() {
  const cell = 16, gap = 3;
  const w = 15 * (cell + gap);
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      {CONTROLS.map(c => (
        <div key={c.name}>
          <div className="text-primary font-semibold">{c.name}</div>
          <div className="text-sm text-muted leading-snug mb-2 min-h-[2.5rem]">{c.planted}</div>
          <svg viewBox={`0 0 ${w} ${cell}`} className="w-full max-w-[18rem] h-auto" role="img" aria-label={`${c.name}: ${c.full} of 15 ${c.pass}${c.partial ? `, ${c.partial} more ${c.partialLabel}` : ''}`}>
            {Array.from({ length: 15 }, (_, i) => {
              const kind = i < c.full ? 'full' : i < c.full + c.partial ? 'partial' : 'miss';
              return (
                <rect
                  key={i}
                  x={i * (cell + gap) + 1}
                  y={1}
                  width={cell - 2}
                  height={cell - 2}
                  rx="3"
                  fill={kind === 'full' ? 'var(--accent-rust)' : 'none'}
                  stroke={kind === 'miss' ? 'var(--text-muted)' : 'var(--accent-rust)'}
                  strokeWidth="1.5"
                >
                  <title>{kind === 'full' ? c.pass : kind === 'partial' ? c.partialLabel : 'missed'}</title>
                </rect>
              );
            })}
          </svg>
          <div className="text-sm text-secondary mt-2 tabular-nums">
            <strong className="text-primary">{c.full}/15</strong> {c.pass}
            {c.partial > 0 && <><br /><span className="text-muted">{c.full + c.partial}/15 {c.partialLabel} (outlined)</span></>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Figure 3: the two-read screen ── */
// report.json, kinds["pilot:served-vs-L" | "pilot:served-vs-F"].audit.sweep, rule "ratio < 0.7";
// three_read_classes["hard-page"]; judge_vs_itself (range over three re-runs).
type Screen = { label: string; detail: string; precision: { k: number; n: number } | [number, number]; recall: { k: number; n: number } | [number, number] | number };
const SCREENS: Screen[] = [
  { label: 'Fresh lite read', detail: 'vs the served text, agreement < 0.7', precision: { k: 20, n: 70 }, recall: { k: 20, n: 27 } },
  { label: 'Fresh flash read', detail: 'vs the served text, agreement < 0.7', precision: { k: 21, n: 71 }, recall: { k: 21, n: 30 } },
  { label: 'Three reads: “hard page”', detail: 'served agrees, fresh reads disagree', precision: { k: 19, n: 47 }, recall: 0.7 },
  { label: 'The judge, re-run', detail: 'its own flag on a second pass (three re-runs)', precision: [0.51, 0.58], recall: [0.62, 0.66] },
];

function metric(v: Screen['precision'] | Screen['recall']): { p: number; lo: number; hi: number; text: string; range: boolean } {
  if (typeof v === 'number') return { p: v, lo: v, hi: v, text: pct(v), range: false };
  if (Array.isArray(v)) return { p: (v[0] + v[1]) / 2, lo: v[0], hi: v[1], text: `${pct(v[0])}–${pct(v[1])}`, range: true };
  const [lo, hi] = wilson(v.k, v.n);
  return { p: v.k / v.n, lo, hi, text: `${v.k}/${v.n} = ${pct(v.k / v.n)}`, range: false };
}

function ScreenPanel({ title, pick }: { title: string; pick: (s: Screen) => Screen['precision'] | Screen['recall'] }) {
  const L = 8, R = 292, rowH = 46, top = 22;
  const x = (v: number) => L + v * (R - L);
  const H = top + SCREENS.length * rowH;
  return (
    <div>
      <div className="text-primary font-semibold mb-1">{title}</div>
      <svg viewBox={`0 0 300 ${H}`} className="w-full h-auto" role="img" aria-label={title}>
        {[0, 0.5, 1].map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 4} y2={H} stroke="var(--border-light)" strokeWidth="1" />
            <text x={x(t)} y={top - 8} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} fontSize="10" fill="var(--text-muted)">{t * 100}%</text>
          </g>
        ))}
        {SCREENS.map((s, i) => {
          const m = metric(pick(s));
          const cy = top + i * rowH + 30;
          return (
            <g key={s.label}>
              <title>{`${s.label}: ${title.toLowerCase()} ${m.text}${!m.range && m.hi > m.lo ? ` (95% CI ${pct(m.lo)}–${pct(m.hi)})` : ''}`}</title>
              <text x={L} y={cy - 12} fontSize="11" fill="var(--text-primary)">{s.label}</text>
              <text x={R} y={cy - 12} textAnchor="end" fontSize="11" fill="var(--text-secondary)" className="tabular-nums">{m.text}</text>
              {m.hi > m.lo && (
                <line x1={x(m.lo)} x2={x(m.hi)} y1={cy} y2={cy} stroke={m.range ? 'var(--accent-rust)' : 'var(--text-muted)'} strokeWidth={m.range ? 6 : 2} strokeLinecap="round" />
              )}
              {!m.range && <circle cx={x(m.p)} cy={cy} r="4.5" fill="var(--accent-rust)" stroke="var(--bg-cream, #fdfcf9)" strokeWidth="2" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ScreenFigure() {
  return (
    <>
      <div className="grid gap-8 sm:grid-cols-2">
        <ScreenPanel title="Precision" pick={s => s.precision} />
        <ScreenPanel title="Recall" pick={s => s.recall} />
      </div>
      <ul className="text-xs text-muted mt-3 space-y-0.5">
        {SCREENS.map(s => <li key={s.label}><span className="text-secondary">{s.label}</span>: {s.detail}</li>)}
      </ul>
    </>
  );
}

/* ── References ── */
// Alphabetical; numbers are positions in this list, so cite() renumbers itself.
// Related-work entries verified in the #5495 comment that supplied them.
const REFERENCES: { key: string; text: ReactNode; href: string }[] = [
  { key: 'begg1983', text: <>Begg, C. B. &amp; Greenes, R. A. (1983). Assessment of diagnostic tests when disease verification is subject to selection bias. <em>Biometrics</em> 39(1), 207–215.</>, href: 'https://doi.org/10.2307/2530820' },
  { key: 'carlini2021', text: <>Carlini, N., Tramèr, F., Wallace, E., Jagielski, M., Herbert-Voss, A., Lee, K., Roberts, A., Brown, T. et al. (2021). Extracting training data from large language models. arXiv:2012.07805.</>, href: 'https://arxiv.org/abs/2012.07805' },
  { key: 'causer2012', text: <>Causer, T., Tonra, J. &amp; Wallace, V. (2012). Transcription maximized; expense minimized? Crowdsourcing and editing The Collected Works of Jeremy Bentham. <em>Literary and Linguistic Computing</em> 27(2), 119–137.</>, href: 'https://doi.org/10.1093/llc/fqs004' },
  { key: 'eveleigh2014', text: <>Eveleigh, A., Jennett, C., Blandford, A., Brohan, P. &amp; Cox, A. L. (2014). Designing for dabblers and deterring drop-outs in citizen science. In <em>Proceedings of CHI 2014</em>, 2985–2994.</>, href: 'https://doi.org/10.1145/2556288.2557262' },
  { key: '84000', text: <>84000: Translating the Words of the Buddha (n.d.).</>, href: 'https://84000.co' },
  { key: 'freitag2021', text: <>Freitag, M., Foster, G., Grangier, D., Ratnakar, V., Tan, Q. &amp; Macherey, W. (2021). Experts, errors, and context: a large-scale study of human evaluation for machine translation. <em>Transactions of the Association for Computational Linguistics</em> 9, 1460–1474.</>, href: 'https://doi.org/10.1162/tacl_a_00437' },
  { key: 'freitag2022', text: <>Freitag, M., Rei, R., Mathur, N., Lo, C., Stewart, C. et al. (2022). Results of WMT22 Metrics Shared Task: stop using BLEU, neural metrics are better and more robust. In <em>Proceedings of WMT 2022</em>.</>, href: 'https://aclanthology.org/2022.wmt-1.2/' },
  { key: 'guerreiro2023', text: <>Guerreiro, N. M., Rei, R., van Stigt, D., Coheur, L., Colombo, P. &amp; Martins, A. F. T. (2023). xCOMET: transparent machine translation evaluation through fine-grained error detection. arXiv:2310.10482.</>, href: 'https://arxiv.org/abs/2310.10482' },
  { key: 'kocmi2023', text: <>Kocmi, T. &amp; Federmann, C. (2023a). Large language models are state-of-the-art evaluators of translation quality. EAMT 2023. arXiv:2302.14520.</>, href: 'https://arxiv.org/abs/2302.14520' },
  { key: 'kocmi2023b', text: <>Kocmi, T. &amp; Federmann, C. (2023b). GEMBA-MQM: detecting translation quality error spans with GPT-4. WMT 2023. arXiv:2310.13988.</>, href: 'https://arxiv.org/abs/2310.13988' },
  { key: 'krippendorff2011', text: <>Krippendorff, K. (2011). Computing Krippendorff&rsquo;s alpha-reliability. Annenberg School for Communication Departmental Papers 43, University of Pennsylvania.</>, href: "https://www.asc.upenn.edu/sites/default/files/2021-03/Computing%20Krippendorff's%20Alpha-Reliability.pdf" },
  { key: 'liu2023', text: <>Liu, Y., Li, Z., Huang, M., Yang, B., Yu, W., Li, C., Yin, X., Liu, C., Jin, L. &amp; Bai, X. (2023). OCRBench: on the hidden mystery of OCR in large multimodal models. arXiv:2305.07895.</>, href: 'https://arxiv.org/abs/2305.07895' },
  { key: 'muehlberger2019', text: <>Muehlberger, G., Seaward, L., Terras, M., Ares Oliveira, S., Vicente, B., Colutto, S. et al. (2019). Transforming scholarship in the archives through handwritten text recognition: Transkribus as a case study. <em>Journal of Documentation</em> 75(5), 954–976.</>, href: 'https://doi.org/10.1108/JD-07-2018-0114' },
  { key: 'nehrdich2026', text: <>Nehrdich, S. &amp; Keutzer, K. (2026). MITRA: a large-scale parallel corpus and multilingual pretrained language model for machine translation and semantic retrieval for Pali, Sanskrit, Buddhist Chinese, and Tibetan. arXiv:2601.06400.</>, href: 'https://arxiv.org/abs/2601.06400' },
  { key: 'neudecker2019', text: <>Neudecker, C., Baierer, K., Federbusch, M., Boenig, M., Würzner, K.-M., Hartmann, V. &amp; Herrmann, E. (2019). OCR-D: an end-to-end open source OCR framework for historical printed documents. In <em>Proceedings of DATeCH 2019</em>.</>, href: 'https://doi.org/10.1145/3322905.3322917' },
  { key: 'quinjica2026', text: <>Quinjica, O., Bennett, E., Yang, X., Schonebaum, A. &amp; Carpuat, M. (2026). Do evaluation metrics detect errors in Classical Chinese to English translations? arXiv:2608.08283.</>, href: 'https://arxiv.org/abs/2608.08283' },
  { key: 'rei2022', text: <>Rei, R., Treviso, M., Guerreiro, N. M., Zerva, C., Farinha, A. C., Maroti, C., de Souza, J. G. C., Glushkova, T., Alves, D., Coheur, L., Lavie, A. &amp; Martins, A. F. T. (2022). CometKiwi: IST-Unbabel 2022 submission for the quality estimation shared task. In <em>Proceedings of WMT 2022</em>.</>, href: 'https://aclanthology.org/2022.wmt-1.60/' },
  { key: 'rigaud2019', text: <>Rigaud, C., Doucet, A., Coustaty, M. &amp; Moreux, J.-P. (2019). ICDAR 2019 competition on post-OCR text correction. In <em>Proceedings of ICDAR 2019</em>, 1588–1593.</>, href: 'https://www.semanticscholar.org/paper/ICDAR-2019-Competition-on-Post-OCR-Text-Correction-Rigaud-Doucet/f094c79e2e1e0d28537d8aed5ab3c40a46d2c196' },
  { key: 'simpson2014', text: <>Simpson, R., Page, K. R. &amp; De Roure, D. (2014). Zooniverse: observing the world&rsquo;s largest citizen science platform. In <em>WWW &rsquo;14 Companion</em>, 1049–1054.</>, href: 'https://doi.org/10.1145/2567948.2579215' },
  { key: 'stroebel2022', text: <>Ströbel, P. B., Volk, M., Clematide, S., Schwitter, R., Hodel, T. &amp; Schoch, D. (2022). Evaluation of HTR models without ground truth material. In <em>Proceedings of LREC 2022</em>.</>, href: 'https://aclanthology.org/2022.lrec-1.467/' },
  { key: 'vanstrien2020', text: <>van Strien, D., Beelen, K., Coll Ardanuy, M., Hosseini, K., McGillivray, B. &amp; Colavizza, G. (2020). Assessing the impact of OCR quality on downstream NLP tasks. In <em>Proceedings of ICAART 2020</em>, 484–496.</>, href: 'https://doi.org/10.5220/0009169004840496' },
  { key: 'wang2023', text: <>Wang, X., Wei, J., Schuurmans, D., Le, Q., Chi, E., Narang, S., Chowdhery, A. &amp; Zhou, D. (2023). Self-consistency improves chain of thought reasoning in language models. ICLR 2023.</>, href: 'https://arxiv.org/abs/2203.11171' },
  { key: 'wilson1927', text: <>Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. <em>Journal of the American Statistical Association</em> 22(158), 209–212.</>, href: 'https://doi.org/10.1080/01621459.1927.10502953' },
  { key: 'zhang2025', text: <>Zhang, Y., Liang, T., Huang, X., Cui, E., Wang, G., Guo, X., Li, C. &amp; Liu, G. (2025). Consensus Entropy: harnessing multi-VLM agreement for self-verifying and self-improving OCR. arXiv:2504.11101.</>, href: 'https://arxiv.org/abs/2504.11101' },
  { key: 'zheng2023', text: <>Zheng, L., Chiang, W.-L., Sheng, Y., Zhuang, S., Wu, Z. et al. (2023). Judging LLM-as-a-judge with MT-Bench and Chatbot Arena. NeurIPS 2023 Datasets and Benchmarks.</>, href: 'https://arxiv.org/abs/2306.05685' },
];

const REFERENCE_TEXTS: { name: string; use: string; href: string }[] = [
  { name: 'Wikisource', use: 'European print', href: 'https://wikisource.org/' },
  { name: 'Perseus Digital Library', use: 'Greek and Latin', href: 'https://www.perseus.tufts.edu/hopper/' },
  { name: 'First1KGreek', use: 'Greek', href: 'https://opengreekandlatin.github.io/First1KGreek/' },
  { name: 'CBETA', use: 'the Chinese Buddhist canon', href: 'https://www.cbeta.org/' },
  { name: 'Kanseki Repository (Kanripo)', use: 'the Chinese classics, including the Siku Quanshu', href: 'https://github.com/kanripo' },
  { name: '84000: Translating the Words of the Buddha', use: 'human English translations of Tibetan texts', href: 'https://84000.co/' },
  { name: 'GRETIL', use: 'Sanskrit and other Indic e-texts', href: 'https://gretil.sub.uni-goettingen.de/gretil.html' },
];

const REFERENCE_LICENCES: { source: string; supplies: string; licence: string; use: string }[] = [
  { source: 'Project Gutenberg', supplies: 'English print, 1800–1930', licence: 'Public domain in the US', use: 'Scoring; export allowed' },
  { source: 'English Wikisource', supplies: 'English print', licence: 'CC BY-SA 4.0', use: 'Scoring; export with attribution, share-alike' },
  { source: 'Perseus canonical-greekLit, First1KGreek', supplies: 'Greek', licence: 'CC BY-SA 4.0 (repository licence)', use: 'Scoring; export with attribution, share-alike' },
  { source: 'Kanseki Repository (Kanripo)', supplies: 'Classical Chinese', licence: 'CC BY-SA (“all content created by us”)', use: 'Scoring; export with attribution, share-alike' },
  { source: 'CBETA', supplies: 'Chinese Buddhist canon', licence: 'CC BY-NC-SA 4.0, non-commercial; some base editions are excluded', use: 'Scoring only; blocked from export' },
  { source: '84000', supplies: 'Human English translations of the Tibetan canon', licence: 'To be confirmed from 84000’s permissions page', use: 'Scoring only until confirmed' },
];

const cite = (key: string) => {
  const i = REFERENCES.findIndex(r => r.key === key);
  return <a href={`#ref-${key}`} className="text-accent-rust hover:underline">[{i + 1}]</a>;
};

export default function ResearchQualityPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Does this English say what is printed on this leaf?"
          subtitle="How Source Library measures the quality of a page, and what each measurement can and cannot see"
        >
          <p className="text-stone-400 text-sm mt-4">Working draft &middot; 1 October 2026</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link href="/research" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Research
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* ── Abstract (Derek's draft, verbatim) ── */}
        <section className="border-l-2 border-accent-rust pl-5 md:pl-6 mb-10">
          <h2 className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-4">Abstract</h2>
          <p className="text-secondary leading-relaxed mb-4">
            Source Library publishes AI transcriptions and English translations of historical books in more than fifteen languages. A reader asks one thing of any page: does this English say what is printed on this leaf? We split that question into three links: the image shown is the leaf transcribed, the transcription matches the image, and the translation matches the transcription. We then ask which link each of our quality instruments actually measures.
          </p>
          <p className="text-secondary leading-relaxed mb-4">
            Transcription. Where a reference text exists, we measure accuracy. On Latin print the character error rate is 0.7% for one engine and 1.7% for the cheaper one. Most scripts and periods still have too few reference pages to decide anything. Reading a page twice and comparing the reads is a cheaper screen. It finds 70–74% of the pages a judge called garbled, but only about 30% of the pages it flags are garbled. It also identified all seven known cases where the image shown was not the leaf transcribed.
          </p>
          <p className="text-secondary leading-relaxed mb-4">
            Translation. A source-grounded model judge (Claude Opus) rated one random page from each of 311 books. With planted controls passing, it rated 89% of pages faithful to their transcription (95% CI 85–92), and 71% for non-Latin scripts. The judge reads text only. A model check of 20 of those pages against their scans found two that showed a different page from the one transcribed. The judge could not have seen either.
          </p>
          <p className="text-secondary leading-relaxed">
            The missing part. None of these measurements involves a human reader. We preregister a standing panel of volunteers who read the source languages. Each is asked one question about one page drawn from the judge&rsquo;s own monthly sample. We will report how often the readers agree with the judge, what each side misses, and how many volunteers answer when asked.
          </p>
        </section>

        {/* ── 1 ── */}
        <Section n={1} title="The reader's question">
          <P>
            Someone opens a page of a book in the reader. On the left is a photograph of a leaf; on the right, an English text. The one thing they need to know is whether that English says what the leaf says. Everything we call quality is an attempt to answer that question for pages nobody on our side has read.
          </P>
          <P>
            The answer depends on three links, and each can break on its own. The image shown must be the leaf that was transcribed: an imported scan can be one leaf out of step with its text. The transcription must match the image: a model can misread, produce garble, or recite a familiar text it was not shown. The translation must match the transcription: it can drop a clause, add one, or reverse a sense. A page is right for the reader only when all three hold.
          </P>
          <P>
            We use four words for measurements and keep them apart.<N n={9} /> <strong>Accuracy</strong> compares a reading with an independent reference for the same leaf, usually a published edition. <strong>Agreement</strong> compares one engine&rsquo;s reading with another&rsquo;s; it cannot see errors both share. <strong>Stability</strong> compares an engine with itself on a repeat read. <strong>Judged</strong> is a model&rsquo;s rating of a translation against the transcription it was shown, with no reference and no image. Only the first is a measurement of quality. The others are screens, and Figure 1 shows which links each one reaches.
          </P>

          <Figure
            n={1}
            caption={<>The chain from scan to English, and which instrument covers which link. A filled mark means the instrument measures that link; a half mark, that it measures part of it; an empty mark, that it cannot see it. Only a person who reads the original spans all three, and that check has not yet been run (§6). After the table in the evaluation design.<N n={9} /></>}
          >
            <ChainFigure />
          </Figure>

          <P>
            Figure 2 shows what a broken link looks like on a real page. Each specimen comes from the translation audit described in §4, and each breaks a different link.
          </P>

          <Figure
            n={2}
            caption={<>Three pages from the translation audit (§4), each shown as a crop of the scan the reader sees, an excerpt of the transcription, and an excerpt of the English, as served on 30 September 2026. Ellipses mark omitted text. Each scan was opened and read for this figure. Panel (a) is garble that a text-only judge can catch because it is visible in the transcription. Panel (b) is a failure no text-only instrument can see. Panel (c) is a translation error proper.<N n={7} /><N n={8} /></>}
          >
            <div>
              {SPECIMENS.map(s => <SpecimenRow key={s.key} s={s} />)}
            </div>
          </Figure>
        </Section>

        {/* ── 2: Related work (text from the #5495 comment, verbatim; author-year cites rendered as numbers) ── */}
        <Section n={2} title="Related work">
          <h3 className="text-lg text-primary font-semibold mb-3">2.1 Evaluating OCR and handwriting recognition of historical documents</h3>
          <P>
            Evaluation of historical text recognition is conventionally done by character and word error rate against a transcribed reference. Community resources supply those references and shared tooling: the OCR-D project built an open workflow and ground-truth practice for historical German printed books {cite('neudecker2019')}, Transkribus provides handwritten text recognition for archives {cite('muehlberger2019')}, and the ICDAR 2019 competition on post-OCR text correction released a gold-standard corpus of about 22 million characters in ten European languages, scored on error detection and correction {cite('rigaud2019')}. Because OCR errors propagate, extrinsic studies measure their effect on downstream tasks; van Strien et al. {cite('vanstrien2020')} report a consistent impact of OCR quality on sentence segmentation, named entity recognition, dependency parsing, retrieval, topic modelling and language-model fine-tuning, with some tasks harmed more than others. Where no reference exists, quality has to be estimated: Ströbel et al. {cite('stroebel2022')} compare lexicon-based, language-model and masked-language-model scores for evaluating handwriting recognition without ground truth, and find that transformer-based scores can match lexicon-based ones. We measure character error rate where a reference e-text exists, but most of our corpus (Greek, Chinese, Sanskrit, Tibetan, Hebrew, Arabic, Japanese kuzushiji) has none, so our work adds a reference-free screen based on two independent reads of the same leaf and treats it as a flag for garble, not as a measure of accuracy.
          </P>
          <h3 className="text-lg text-primary font-semibold mb-3">2.2 Vision-language models as OCR, fabrication, agreement and memorisation</h3>
          <P>
            General-purpose multimodal models are now evaluated as text readers. OCRBench assembles 29 datasets covering text recognition, document question answering, key information extraction and handwritten mathematical expression recognition, and uses them to evaluate large multimodal models including GPT-4V and Gemini {cite('liu2023')}. For judging whether a given output can be trusted, Zhang et al. {cite('zhang2025')} propose Consensus Entropy, a training-free score that estimates reliability from the agreement of several vision-language models, and use it to flag and improve OCR output. A separate literature shows that language models can reproduce training text verbatim: Carlini et al. {cite('carlini2021')} extracted hundreds of verbatim sequences from the training data of GPT-2 by querying it. We take this as a reason for caution, not as a measurement of vision-language OCR: where a page holds a canonical text, a reader that has seen the text may reproduce it, so two reads can agree on a wrong output. Our two-read screen differs from Consensus Entropy in using repeated reads by the same engine family and in stating that agreement cannot establish correctness, which is why we calibrate it against human readers.
          </P>
          <h3 className="text-lg text-primary font-semibold mb-3">2.3 Language-model judges of translation</h3>
          <P>
            Human translation evaluation at fine grain follows the Multidimensional Quality Metrics framework; Freitag et al. {cite('freitag2021')} apply it with professional translators and document context and report that expert ratings produce different system rankings than crowd ratings. Large language models have been used to automate such judgments: GEMBA prompts a GPT model to score translations with or without a reference {cite('kocmi2023')}, and GEMBA-MQM prompts GPT-4 to mark error spans without reference translations {cite('kocmi2023b')}. Learned reference-free estimators are the established alternative, including CometKiwi {cite('rei2022')} and xCOMET, which pairs a sentence score with error span detection {cite('guerreiro2023')}. Judge reliability has known weaknesses; Zheng et al. {cite('zheng2023')} identify position, verbosity and self-enhancement biases in LLM judges of chat assistants, and Wang et al. {cite('wang2023')} show for reasoning tasks that sampling several outputs and taking the most frequent answer improves over a single greedy output, which motivates repeated judging. Our judge differs from these in task and in what it reads: it scores fidelity of an English page against its transcription, not against the leaf image or a reference translation, and we plant swapped, truncated and repeated pages to test whether it can fail in the ways we care about.
          </P>
          <h3 className="text-lg text-primary font-semibold mb-3">2.4 Validating automatic metrics against human judgment</h3>
          <P>
            Metric validation in machine translation is organised by the WMT metrics shared tasks, which correlate automatic scores with expert human ratings; the 2022 edition reports that learned neural metrics clearly outperform overlap-based metrics {cite('freitag2022')}. Agreement among human raters is reported with chance-corrected coefficients such as Krippendorff&rsquo;s alpha {cite('krippendorff2011')}. A further problem arises when the human reference is collected on only some items: Begg and Greenes {cite('begg1983')} show for diagnostic tests that restricting estimates to cases that receive definitive verification can seriously bias sensitivity and specificity, and that adjustment requires assumptions about how cases were selected for verification. Our volunteer panel answers on the judge&rsquo;s own random monthly sample, so pages are not selected for checking by the judge&rsquo;s verdict. Selection still enters through which volunteers answer and which pages they decline as unreadable, so we report agreement separately for pages the judge called sound and defective, with intervals, and report declines and non-response by language.
          </P>
          <h3 className="text-lg text-primary font-semibold mb-3">2.5 Volunteer and crowd transcription of cultural heritage</h3>
          <P>
            Volunteer transcription of heritage material has been studied in several settings. Causer et al. {cite('causer2012')} describe Transcribe Bentham, which crowdsourced transcription of the manuscripts of Jeremy Bentham and examined the editing effort and cost that followed. The Zooniverse platform hosts many volunteer projects and has been described as a platform operating at scale {cite('simpson2014')}. Studies of participation find that many volunteers contribute briefly: Eveleigh et al. {cite('eveleigh2014')} describe &ldquo;dabblers&rdquo;, users who make small and intermittent contributions, and discuss designing for them and for retaining them. Distributed Proofreaders and Wikisource apply multi-pass volunteer proofreading to page images. These projects ask volunteers to produce text. Ours asks volunteers one question per page, by email, as a standing panel with a preregistered protocol, so that their answers serve as reference data for the judge and not as a transcription.
          </P>
          <h3 className="text-lg text-primary font-semibold mb-3">2.6 Translation of low-resource classical languages</h3>
          <P>
            Parallel data for classical languages is thin and unevenly available. MITRA assembles 1.74 million parallel sentence pairs across Pali, Sanskrit, Buddhist Chinese and Tibetan and reports machine translation and retrieval results among these languages {cite('nehrdich2026')}. For Classical Chinese to English, Quinjica et al. {cite('quinjica2026')} test whether metrics built for modern languages detect errors, using minimal pairs that capture error types salient in scholarly use, and report that all metrics have limitations, with MetricX24 performing best of those tested. Human translations, such as those published by the 84000 project for the Tibetan canon {cite('84000')}, are the natural references where they exist; we use them for Tibetan. Our setting differs in that most of our pages have no human reference translation at all, and the judge must work from the transcription.
          </P>
        </Section>

        {/* ── 3 ── */}
        <Section n={3} title="Transcription">
          <P>
            <strong>Accuracy where a reference exists.</strong> We draw one page per book, seal the draw before any engine reads it, and score each engine&rsquo;s reading against a window of a published e-text that prints the same passage. The unit is the book, and a cell is graded by how many referenced books it holds: under 30 is exploratory, 30 to 49 directional, 50 or more decision-grade. The design is described in a <Link href="/blog/how-we-measure-ocr-quality" className="text-accent-rust hover:underline">separate note</Link>.
          </P>
          <P>
            On Latin, with 77 referenced books, the median character error rate is 0.7% for Gemini 3 Flash (68 aligned pages, 95% CI 0.4–1.2%) and 1.7% for Gemini 3.1 Flash-Lite, the cheaper engine that reads Latin-script pages in production (62 pages, CI 0.7–3.7%). Both cells are decision-grade.<N n={1} /> Most cells are not. Of the 1,188 cells in the evidence table, 80 are decision-grade, 33 directional and 1,075 exploratory.<N n={1} /> Japanese, Sanskrit, Arabic, Korean, Persian, Ge&rsquo;ez and Pali have no reference pages at all, and Hebrew has four, all in square script.<N n={2} /> For those scripts we cannot yet say how accurate the transcription is.
          </P>
          <P>
            One narrower accuracy check reads the numbers. On English books printed 1800–1930, every printed number on which two engines disagreed was cropped from the page image and read blind by a model, with no engine&rsquo;s reading on the sheet. Of 5,212 printed numbers across 82 books, the Internet Archive&rsquo;s own OCR had 5.1% wrong (CI 3.8–7.4) and Flash-Lite 1.8% (CI 1.1–3.1). This is directional, and the reader of the crops was a model, not a person.<N n={3} />
          </P>
          <P>
            <strong>A screen where no reference exists.</strong> Reading a page a second time and comparing the two reads costs a tenth to a fifth of a cent per page. We tested it on 327 pages the translation judge (§4) had rated, one per book, using the judge&rsquo;s garble flag as the label: 32 pages were flagged. A fresh Flash-Lite read that agreed with the served text on less than 70% of its tokens flagged 70 pages, 20 of them garbled: precision 29%, recall 74%. A fresh Flash read gave 30% and 70%.<N n={4} /><N n={5} /> The screen finds most garbled pages and mostly flags pages that are not. On Latin-script pages it does not separate at all (precision about 10%); 24 of the 30 garbled pages it could judge were in non-Latin scripts.<N n={4} />
          </P>
          <P>
            Two cautions keep these numbers in proportion. The label is itself a model&rsquo;s: re-run on the same pages, the judge reproduced its own garble flag with a precision of 51–58% (Figure 3). So the screen cannot reach a high precision against this label even if it were perfect. And when model readers looked at 18 of the &ldquo;hard&rdquo; pages against the scan, the served text was unreliable on 8 (44%, CI 25–66).<N n={4} />
          </P>
          <P>
            The same reads did one thing cleanly. When the served text disagrees with both fresh reads (agreement under 0.3) while the fresh reads agree with each other (0.9 or more), the served text is likely to belong to a different leaf. All seven known wrong-leaf pages had this signature, and none of the 258 pages confirmed by eye as the right leaf did.<N n={4} /> This is the instrument in Figure 1 that reaches link 1.
          </P>

          <Figure
            n={3}
            caption={<>The two-read screen at the 0.7 agreement threshold, scored against the judge&rsquo;s garble flag on the audited pages. Dots are point estimates with 95% Wilson intervals<span className="whitespace-nowrap"> {cite('wilson1927')}</span> computed from the counts shown; the &ldquo;hard page&rdquo; recall is reported without a count. The judge&rsquo;s own repeat is drawn as the range over three re-runs: it shows how well the label agrees with itself, a practical limit on what any screen can score against it. The approach is related to Consensus Entropy {cite('zhang2025')}, which uses agreement between several vision-language models to flag bad OCR.<N n={4} /><N n={5} /></>}
          >
            <ScreenFigure />
          </Figure>
        </Section>

        {/* ── 4 ── */}
        <Section n={4} title="Translation">
          <P>
            We drew one interior page from each of 311 books across 15 catalogue languages (seed 20260930) and asked Claude Opus to rate each served translation against the transcription it was made from, on a 1–5 fidelity scale, and to list each defect by type and severity.<N n={6} /> The judge sees the transcription and the English. It does not see the scan, and it has no reference translation. Its defect categories (omission, invention, inversion, mistranslation and others, each minor or major) are close to the MQM error typology {cite('freitag2021')}. Asking a large model for a direct judgement of translation quality follows GEMBA {cite('kocmi2023')}, with the difference that our judge is given the source text.
          </P>
          <P>
            <strong>Controls first.</strong> Before any rating is read, planted items test the judge. Fifteen translations were swapped for the translation of another page; the judge rated all 15 at 2 or lower. Fifteen had their middle third removed; it flagged omission on all 15. Fifteen items were judged twice; 11 got the identical rating and all 15 were within one point.<N n={6} /> The run would not have been reported had the controls failed.
          </P>

          <Figure n={4} caption={<>Planted controls, 15 items each. Filled squares pass. For the repeat control, outlined squares are items whose second rating differed by one point. The gate was set before the run.<N n={6} /></>}>
            <ControlsFigure />
          </Figure>

          <P>
            <strong>The estimate.</strong> Weighted by language, the judge rated 89.1% of served pages 4 or 5 (95% CI 85.5–92.5), 3.4% at 2 or lower, and found a major defect on 11.4% (CI 7.6–15.6). The most common flags were omission (14.8%), invention (11.2%), garble carried through from the transcription (6.6%), and inversion (3.9%).<N n={6} /> For Latin-script books the share at 4 or 5 was 92.9% (198 books); for non-Latin scripts, 70.8% (113 books).<N n={6} /> Figure 5 gives the per-language counts. Most cells are small, and the intervals say so.
          </P>

          <Figure
            n={5}
            caption={<>Share of audited pages the judge rated 4 or 5, by catalogue language, one page per book, with 95% Wilson intervals {cite('wilson1927')} computed from the counts in the audit report. The dashed line is the language-weighted estimate for all pages. *Catalogue label only: in the hand-read subset, an &ldquo;Arabic&rdquo; page was German and a &ldquo;Korean&rdquo; page was Classical Chinese.<N n={6} /><N n={7} /></>}
          >
            <LanguageFigure />
          </Figure>

          <P>
            <strong>Checking the judge.</strong> A second judge (Claude Sonnet) rated 107 of the same pages; the two gave the identical rating on 67.3% and were within one point on all 107.<N n={6} /> That is agreement between two models of one family, not accuracy. For a stronger check, a model opened the scan of 20 pages, drawn at random from the audit, and read it against the transcription and the English. Of 21 defects the judge had flagged on those pages, 20 were confirmed and none rejected; on the 9 pages the judge rated 5, no major defect had been missed.<N n={7} /> But on 2 of the 20 pages, both Internet Archive scans, the image shown was a different printed page from the one transcribed and translated. The judge rated both translations as faithful, correctly, because they are faithful to their text. Figure 2 shows one of them.
          </P>

        </Section>

        {/* ── 5 ── */}
        <Section n={5} title="What none of this measures">
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-3">
            <li><strong>A human reading.</strong> Every instrument above is a model, or a model reading an image. None has been checked against a person who reads the source language. The judge&rsquo;s own error rate is therefore unknown.<N n={9} /></li>
            <li><strong>Leaf identity at scale.</strong> We have a signature that catches wrong leaves and a count of two in twenty on one hand-read sample. We do not have a rate.<N n={2} /></li>
            <li><strong>Transcription accuracy in most scripts.</strong> Where no reference exists, a second read measures agreement. Two engines that share a training corpus can agree on the same error, or on a familiar text that is not on the page.</li>
            <li><strong>Scripts the judge reads poorly.</strong> The judge&rsquo;s rating of a Rashi-script or kuzushiji page is only as good as its reading of that script, and we have not measured that.</li>
            <li><strong>The book&rsquo;s metadata.</strong> Title, author and date against the title page are a fourth link, for the book rather than the page. Only a by-eye check on a few books per stratum covers it.<N n={9} /></li>
          </ul>
        </Section>

        {/* ── 6 ── */}
        <Section n={6} title="The reader panel (preregistered, not yet run)">
          <P>
            The panel asks volunteers who read a source language the reader&rsquo;s question directly. Each receives one page at a time by email: the scan, the transcription and the English. They answer one question: <em>Does the English say what this page says?</em> The answers are Yes; No, with a line on where; or Can&rsquo;t tell. The question covers the whole chain, and the &ldquo;where&rdquo; line tells us which link failed.<N n={10} />
          </P>
          <P>
            The pages are the judge&rsquo;s own monthly random draw, one interior page per book, starting with the 30 September audit less its wrong-leaf pages. Readers get pages in the language they named, in seeded random order, and never see the judge&rsquo;s verdict. Each answer is stored with a hash of the transcription and of the translation it was given against, so an answer on text that has since changed is set aside. When a reader and the judge disagree, the page goes to a second reader of that language; if the second reader agrees with the first, the human verdict stands, and otherwise the page is listed as unresolved with both answers.<N n={10} />
          </P>
          <P>
            We will report three things, monthly and cumulatively: how often readers agree with the judge, with n and a Wilson interval, separately for pages the judge called sound and pages it called defective; a catalogue of what readers found that the judge missed and the reverse, each with its page and the reader&rsquo;s words; and the response funnel, from letters sent to pages answered, by language. Sensitivity, specificity and per-language rates wait until there are enough answers to support them.<N n={10} />
          </P>
          <P>
            Status on the date of this draft: the protocol is written and awaits sign-off and an ethics approval. No page has been sent and there are no results. Readers will be credited by name in the acknowledgements unless they prefer not to be.<N n={10} />
          </P>
        </Section>

        {/* ── 7 ── */}
        <Section n={7} title="Limitations">
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-3">
            <li><strong>One sample, one judge.</strong> The audit is one draw of 311 pages, rated by one judge with one prompt. The by-language cells are mostly under 20 books, and the per-language rankings in Figure 5 are within each other&rsquo;s intervals for most pairs.</li>
            <li><strong>The translation models are not compared.</strong> Pages were translated by whichever model the book went through, so model and book are confounded. The audit does not say which model translates better.<N n={2} /></li>
            <li><strong>The screen was tuned on its own sample.</strong> The 0.7 threshold and the three-read classes were chosen on the same 327 pages they are reported on, and the result has not been replicated.<N n={4} /></li>
            <li><strong>&ldquo;By eye&rdquo; means a model reading an image.</strong> The leaf-identity counts, the flag precision and the number adjudication all rest on model readers of scans. That is stronger than a text-only check and weaker than a person.<N n={9} /></li>
            <li><strong>The catalogue language is not always the page&rsquo;s.</strong> Two of the 20 hand-read pages were in a different language from their catalogue label, so per-language figures describe catalogue strata, not scripts on the page.<N n={7} /></li>
            <li><strong>Pages change.</strong> Served text is re-read and repaired. The specimen in Figure 2b has been fixed since the audit; every figure here is dated to the run that produced it.</li>
          </ul>

          {/* Text from the #5495 comments, verbatim, with the canary correction applied. */}
          <h3 className="text-lg text-primary font-semibold mb-3">Memorisation, recitation and training data</h3>
          <P>
            The reference texts we can score against are mostly famous, openly published texts, and those are the texts most likely to be in a model&rsquo;s training data. A model that has memorised Homer can reproduce the passage without reading the page. On matched pages from the same books, our working paper measures this &ldquo;memorisation subsidy&rdquo; at about 1 percentage point of accuracy for large models and about 5 for small ones.<N n={11} /> In its extreme form the output is fabrication: on Syriac manuscripts, Gemini returned fluent scripture that was not on the page.<N n={12} /> Accuracy cells built on canonical references therefore overstate how well an engine reads rare material, so we label each cell with the memorisation risk of its references.
          </P>
          <P>
            Agreement shares the blind spot. Two reads that both recite the same text agree perfectly. The two-read screen can flag garble, but it cannot catch recitation.
          </P>
          <P>
            Gemini sometimes refuses to output text that matches its training data (the <code>RECITATION</code> stop). These refusals cluster on the cleanest canonical print, so the pages they remove are the easiest ones. We report refusals per stratum as an outcome, and never drop them silently.
          </P>
          <P>
            Translation has the same risk in two places. The translating model may reproduce a remembered published English translation instead of translating the page, and a modern published translation may be under copyright. We have not measured how often this happens. The judge may also know the canonical text and rate a translation against its memory rather than the transcription it was given. The swapped-page control shows that it reads the page it is given, but it does not rule out memory on famous texts. Readers holding the scan are the one check that is independent of any training data.
          </P>
          <P>
            Publishing feeds future training. Once our pages and reference passages are public, later models may memorise them, and a benchmark built on our own corpus will drift upward without any real improvement. We keep a sealed reserve of benchmark pages whose reference text is never published, and we plan to mark the published dataset with a canary string so its presence in training data can be detected.
          </P>
          <P>
            We can estimate, book by book, whether a model already knows a work. Our membership survey (<Link href="/blog/did-the-ai-read-this" className="text-accent-rust hover:underline">&ldquo;Did the AI Read This?&rdquo;</Link>) combines a bibliographic prior with behavioural probes of two models. The prior asks whether an English translation exists in any of twelve catalogues. The probes ask the model whether it recognises the work. The two are combined by Bayes&rsquo; rule into a posterior per book. On a random sample of 1,000 of 16,871 transcribed books, about 43% were confidently new to the models and about 21% were confidently known. The survey measures whether a model recognises the work, not whether it has seen our scan. That is the right quantity here, because a model that recognises a work can recite it. The posterior gives a book-level memorisation label. Accuracy and judge ratings can then be reported separately for known and unknown works, instead of relying on the canonical/non-canonical label alone.
          </P>
          <P>
            Recognition also overrides the image. In <Link href="/blog/reciting-not-reading" className="text-accent-rust hover:underline">&ldquo;Reciting, Not Reading&rdquo;</Link> we covered four lines of Genesis on a 1566 Vulgate with an opaque grey box. The production model transcribed them anyway, correctly and without a warning. Four prompts asking it to mark what it could not read all failed. A transcription of a known work can therefore be right for the wrong reason, and an accuracy score cannot tell the two apart.
          </P>
        </Section>

        {/* ── 8 ── */}
        <Section n={8} title="Data and code">
          <P>
            The draws, judge prompts, verdicts, scores and scripts are in the public repository under{' '}
            <a href={`${GH.replace('/blob/', '/tree/')}scripts/eval`} className="text-accent-rust hover:underline">scripts/eval</a>, under the AGPL. Each number on this page cites the file it came from:
          </P>
          <ol className="list-none pl-0 text-sm text-secondary leading-relaxed space-y-2 mb-6">
            {SOURCES.map((s, i) => (
              <li key={s.path} id={`source-${i + 1}`} className="flex gap-3 scroll-mt-24">
                <span className="text-muted tabular-nums shrink-0 w-5 text-right">{i + 1}.</span>
                <span>
                  <a href={`${GH}${s.path}`} className="text-accent-rust hover:underline break-all">{s.path}</a>
                  <span className="text-muted"> — {s.what}</span>
                </span>
              </li>
            ))}
          </ol>

          <h3 className="text-lg text-primary font-semibold mb-3">Datasets</h3>
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-3">
            <li>
              <strong>Source Library quality dataset, v1.</strong> One downloadable bundle behind this draft, split by licence (#5531):{' '}
              <a href={`${GH.replace('/blob/', '/tree/')}scripts/eval/dataset/quality-v1`} className="text-accent-rust hover:underline break-all">scripts/eval/dataset/quality-v1</a>. DOI to follow.
            </li>
            <li>
              <strong>Result folders behind the figures.</strong>{' '}
              <a href={`${GH.replace('/blob/', '/tree/')}scripts/eval/results/translation-corpus-audit-2026-09-30`} className="text-accent-rust hover:underline break-all">translation-corpus-audit-2026-09-30</a>{' '}
              (Figures 2, 4 and 5: draw, verdicts, controls, eye notes) and{' '}
              <a href={`${GH.replace('/blob/', '/tree/')}scripts/eval/results/two-read-garble-5313-2026-09-30`} className="text-accent-rust hover:underline break-all">two-read-garble-5313-2026-09-30</a>{' '}
              (Figure 3: reads, sweep, three-read classes), both under scripts/eval/results.
            </li>
          </ul>

          {/* Text from the #5495 comment, verbatim; licences checked against each source on 2026-10-01. */}
          <h3 className="text-lg text-primary font-semibold mb-3">Reference texts and their licences</h3>
          <P>
            We do not buy or license reference texts. Every reference is either in the public domain or published by its maker under an open licence that permits research use, and we use each one only for scoring. A reference text is never served to readers and is never included in an exported dataset unless its licence allows that.
          </P>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm text-secondary">
              <thead>
                <tr className="border-b border-light text-left text-muted">
                  <th className="py-1.5 pr-4 font-medium">Source</th>
                  <th className="py-1.5 pr-4 font-medium">What it supplies</th>
                  <th className="py-1.5 pr-4 font-medium">Licence (as stated by the source)</th>
                  <th className="py-1.5 font-medium">How we use it</th>
                </tr>
              </thead>
              <tbody>
                {REFERENCE_LICENCES.map(r => (
                  <tr key={r.source} className="border-b border-light align-top">
                    <td className="py-1.5 pr-4 text-primary">{r.source}</td>
                    <td className="py-1.5 pr-4">{r.supplies}</td>
                    <td className="py-1.5 pr-4">{r.licence}</td>
                    <td className="py-1.5">{r.use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P>
            Several of these texts are copyrighted editions, such as the Taishō canon inside CBETA or the TEI encodings in Perseus. We use them because their rights holders released them under these terms, not because the underlying works are old. Where the terms are non-commercial, the reference is used for research scoring inside Source Library and is never part of anything we sell or license.
          </P>
          <P>Two further routes are open but unused:</P>
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-3">
            <li><strong>Text and data mining exceptions.</strong> EU law (Directive 2019/790, Articles 3 and 4) allows text and data mining of lawfully accessed works for scientific research. A copyrighted modern edition could then serve as a reference without the publisher&rsquo;s licence. We have not relied on this. If we do, it will be through the research partner, with counsel&rsquo;s view first.</li>
            <li><strong>Quotation.</strong> Short excerpts shown in a paper, such as a line of reference beside the engine&rsquo;s reading, fall under the quotation right. Excerpts are kept to what the comparison needs.</li>
          </ul>
          <P>
            Volunteer readers&rsquo; answers are contributed data, not reference texts. Letter 1 asks for consent to publish them, and the dataset credits readers by name unless they decline.
          </P>
        </Section>

        {/* ── 9 ── */}
        <Section n={9} title="References">
          <ol className="list-none pl-0 text-sm text-secondary leading-relaxed space-y-2 mb-8">
            {REFERENCES.map((r, i) => (
              <li key={r.key} id={`ref-${r.key}`} className="flex gap-3 scroll-mt-24">
                <span className="text-muted tabular-nums shrink-0 w-6">[{i + 1}]</span>
                <span>
                  {r.text}{' '}
                  <a href={r.href} className="text-accent-rust hover:underline break-all">{r.href.replace('https://', '')}</a>
                </span>
              </li>
            ))}
          </ol>
          <h3 className="text-lg text-primary font-semibold mb-3">Reference texts used as ground truth</h3>
          <ul className="list-none pl-0 text-sm text-secondary leading-relaxed space-y-1.5 mb-12">
            {REFERENCE_TEXTS.map(r => (
              <li key={r.name}>
                <a href={r.href} className="text-accent-rust hover:underline">{r.name}</a>
                <span className="text-muted"> — {r.use}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted leading-relaxed mb-12">
            A working draft, not peer-reviewed. Corrections and questions:{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">team@sourcelibrary.org</a>.
          </p>
        </Section>
      </article>
    </ContentPageLayout>
  );
}
