import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import byLanguage from '@/data/quality-by-language.json';
import ocrEvidence from '@/data/ocr-benchmark-evidence.json';
import ErrorLadder from './ErrorLadder';
import { KEY_FINDINGS } from './findings';

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
  { path: 'scripts/eval/results/quality-paper-stats-2026-10-01/report.md', what: 'Chance-corrected judge agreement, held-out screen performance and AUC, Wilson intervals on small counts, and the reader panel’s sample sizes (scripts/eval/quality-paper-stats.mjs).' },
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

/* ── Numbers read from the OCR evidence table, so the prose cannot drift from it ── */
function latinCell(engine: string) {
  const c = ocrEvidence.cells.find(x => x.factor === 'language' && x.level === 'Latin' && x.engine === engine);
  const r = c?.cer_vs_reference as { n: number; median: number; ci95: [number, number] } | null | undefined;
  return { books: c?.n_referenced ?? 0, pages: r?.n ?? 0, median: r?.median ?? 0, ci: r?.ci95 ?? [0, 0] };
}
const LATIN_FLASH = latinCell('gemini-3-flash-preview');
const LATIN_LITE = latinCell('gemini-3.1-flash-lite');
const CELL_GRADES = ocrEvidence.totals.cells_by_grade as Record<string, number>;
const pc1 = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const n0 = (x: number) => x.toLocaleString('en-US');

/* ── By language: the grid the paper is organised around ── */
// Generated by scripts/eval/quality-by-language.mjs from the OCR evidence table and every
// random-sample translation audit; regenerate after a benchmark or a monthly audit.
type LangRow = (typeof byLanguage.rows)[number];
const cer = (x: number | null) => (x == null ? '—' : x < 0.01 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 1000) / 10}%`);
const GH_ISSUE = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';

function ShareBar({ row }: { row: LangRow }) {
  const t = row.translation;
  const W = 110, x = (v: number) => 4 + v * (W - 8);
  const label = `${t.rated_4_or_5} of ${t.books} books rated 4–5 (${pct(t.share)}; 95% CI ${pct(t.ci[0])}–${pct(t.ci[1])})`;
  return (
    <svg viewBox={`0 0 ${W} 14`} className="w-[6.9rem] h-auto shrink-0" role="img" aria-label={label}>
      <title>{label}</title>
      <line x1={x(0)} x2={x(1)} y1={7} y2={7} stroke="var(--border-light)" strokeWidth="1" />
      <line x1={x(0.5)} x2={x(0.5)} y1={4} y2={10} stroke="var(--border-light)" strokeWidth="1" />
      <line x1={x(t.ci[0])} x2={x(t.ci[1])} y1={7} y2={7} stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={x(t.share)} cy={7} r="3.5" fill="var(--accent-rust)" />
    </svg>
  );
}

function GradeChip({ grade }: { grade: string }) {
  const g = (grade in GRADE_STYLE ? grade : 'exploratory') as Grade;
  return <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${GRADE_STYLE[g]}`}>{grade}</span>;
}

function LanguageGrid() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="text-left text-muted align-bottom">
            <th className="py-1 pr-3 font-medium" rowSpan={2}>Language</th>
            <th className="py-1 pr-3 font-medium text-right" rowSpan={2}>Share of translated pages</th>
            <th className="py-1 pr-3 font-medium border-b border-light" colSpan={2}>Transcription: character error</th>
            <th className="py-1 pr-3 font-medium border-b border-light" colSpan={2}>Translation: rated faithful by the judge</th>
            <th className="py-1 pr-3 font-medium" rowSpan={2}>Readers</th>
            <th className="py-1 font-medium" rowSpan={2}>What is missing</th>
          </tr>
          <tr className="text-left text-muted text-xs border-b border-light">
            <th className="py-1 pr-3 font-normal">Flash-Lite (current) · books</th>
            <th className="py-1 pr-3 font-normal">Flash</th>
            <th className="py-1 pr-3 font-normal">0–100%, 95% CI</th>
            <th className="py-1 pr-3 font-normal">books</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {byLanguage.rows.map(r => {
            const o = r.ocr.current, t = r.translation;
            return (
              <tr key={r.language} className="border-b border-light align-top">
                <td className="py-2 pr-3 text-primary font-medium">{r.language}</td>
                <td className="py-2 pr-3 text-right text-secondary">{r.share_of_translated_pages == null ? '—' : `${r.share_of_translated_pages}%`}</td>
                <td className="py-2 pr-3 text-secondary">
                  {o.median_cer == null ? <span className="text-muted">no reference</span> : <>{cer(o.median_cer)} <span className="text-muted">· {o.books_referenced}</span></>}
                  <div className="mt-1"><GradeChip grade={o.grade} /></div>
                </td>
                <td className="py-2 pr-3 text-muted">{cer(r.ocr.flash.median_cer)}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <ShareBar row={r} />
                    <span className="text-secondary">{pct(t.share)}</span>
                  </div>
                </td>
                <td className="py-2 pr-3 text-secondary">
                  {t.books}
                  <div className="mt-1"><GradeChip grade={t.grade} /></div>
                </td>
                <td className="py-2 pr-3 text-muted">none yet</td>
                <td className="py-2 text-muted text-xs leading-snug max-w-[16rem]">
                  {r.caveat ? <>{r.caveat.text}{'issue' in r.caveat && r.caveat.issue ? <> <a href={`${GH_ISSUE}${r.caveat.issue}`} className="text-accent-rust hover:underline">#{r.caveat.issue}</a></> : null}</> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Decisions the evidence drove: which engine does what, and the experiment behind it ── */
// Plain-language rows from scripts/eval/DECISIONS.md (the ledger is the source of truth; update it first).
type Decision = { area: 'OCR' | 'Translation'; question: string; compared: string; evidence: string; result: string; decision: string; status: 'decided' | 'pending' | 'open'; issue: number };
const DECISIONS: Decision[] = [
  { area: 'OCR', question: 'English print 1800–1930: is the cheaper engine good enough?', compared: 'Gemini Flash-Lite vs Gemini Flash', evidence: 'Accuracy against published texts, 114 books (decision-grade)', result: 'Flash read better on 14 pages, Flash-Lite on 3, 75 tied; median difference 0. Both refused 15–18% of pages as recitation.', decision: 'Keep Flash-Lite; add a fallback for refused pages.', status: 'decided', issue: 5182 },
  { area: 'OCR', question: 'English print: can an open-source engine take a share?', compared: 'MinerU vs Gemini Flash-Lite', evidence: 'Accuracy, 114 books (decision-grade)', result: 'Flash-Lite better page by page, 49 to 10. MinerU dropped footnotes, which is fixable.', decision: 'Proposed: MinerU only as a fallback when Gemini refuses, after the footnote fix.', status: 'pending', issue: 5182 },
  { area: 'OCR', question: 'Internet Archive imports: can the Archive’s own OCR replace a paid read?', compared: 'Archive OCR vs Gemini Flash-Lite', evidence: 'Accuracy, 122 books (directional)', result: 'Flash-Lite better 57 to 5. The Archive misreads about 1.5% of printed numbers.', decision: 'Archive text kept only as a provisional first read.', status: 'decided', issue: 5186 },
  { area: 'OCR', question: 'Chinese manuscripts: a cheaper open model?', compared: 'PaddleOCR-VL 1.6 vs Gemini Flash-Lite', evidence: 'Accuracy against Kanripo and CBETA, 69 books (decision-grade)', result: 'Within the preset margin of Flash-Lite; not a better reader.', decision: 'Adopted as a cost lane, to be verified on live pages.', status: 'pending', issue: 4743 },
  { area: 'OCR', question: 'Siku Quanshu manuscripts (7,894 held books): which engine before they go live?', compared: 'PaddleOCR-VL vs Gemini Flash-Lite vs Flash', evidence: 'Accuracy against Kanripo and CBETA, 433 books (decision-grade); preregistered', result: 'Pages read catastrophically wrong (over half the characters): Flash-Lite 10.6%, Flash 3.7%, Paddle 0.9%. Median error is 18–26% for all three, which points at edition differences in the reference.', decision: 'Proposed: Paddle for the whole cohort, after removing duplicates. Follow-up tests whether Kanripo text can replace OCR where it exists (#5568).', status: 'pending', issue: 5547 },
  { area: 'OCR', question: 'Greek, 1450–1799: which engine per period?', compared: 'Gemini Flash, Flash-Lite, Kraken (open source)', evidence: 'Accuracy against Perseus and First1KGreek, 56 and 53 books (decision-grade)', result: 'Flash passed in both periods. Kraken read better than Flash-Lite before 1700 and failed after.', decision: 'Flash for Greek. Since 11 September all new OCR runs on Flash-Lite instead (see below).', status: 'open', issue: 4744 },
  { area: 'OCR', question: 'Syriac: can Gemini read it?', compared: 'Gemini vs Kraken models from Beth Mardutho', evidence: 'Accuracy against published editions', result: 'Gemini returned fluent scripture that was not on the page; 19% of pages matched the right passage.', decision: 'Never Gemini for Syriac; a Kraken lane reads it.', status: 'decided', issue: 4883 },
  { area: 'OCR', question: 'Tibetan: is Flash-Lite trustworthy?', compared: 'Gemini vs the BDRC model', evidence: 'Agreement with the Derge e-text', result: 'BDRC 0.88 identity vs Gemini 0.41; Flash-Lite failed on about a third of pages (loops, wrong script, recitation).', decision: 'Flash-Lite not used as a reader; pages re-read with Yigdzin.', status: 'decided', issue: 4523 },
  { area: 'OCR', question: 'Japanese cursive (kuzushiji): who can read it?', compared: 'NDL classical OCR v3 vs Gemini Flash and Flash-Lite', evidence: '45 pages read by eye; no reference texts', result: 'NDL coherent where both Gemini engines looped or invented.', decision: 'NDL proposed for cursive pages; how many is undecided.', status: 'pending', issue: 4745 },
  { area: 'OCR', question: 'German, French, Dutch: may they stay on Flash-Lite?', compared: 'Gemini Flash-Lite vs Flash', evidence: 'Agreement only (0.97, 0.95, 0.92), not accuracy', result: 'Agreement cannot settle it.', decision: 'Unjudged until reference texts exist.', status: 'open', issue: 5124 },
  { area: 'Translation', question: 'Non-Latin scripts: translate with the cheaper engine?', compared: 'Gemini Flash-Lite vs Flash', evidence: '137 books, 303 paired pages, a blind judge on 30 (preference, not accuracy)', result: 'No comprehension failures on Flash-Lite.', decision: 'Flash-Lite for all translation.', status: 'decided', issue: 4759 },
  { area: 'Translation', question: 'Batch API at half the price?', compared: 'Batch lane vs production lane', evidence: 'Source-grounded judge', result: 'Production more faithful, 25 to 18; the batch repair step dropped carried text.', decision: 'Not adopted.', status: 'decided', issue: 4681 },
  { area: 'Translation', question: 'Prompt v15 with verified notes?', compared: 'Prompt v13 vs v15', evidence: 'Preregistered A/B', result: 'Verified notes rose from 67% to 96%, but interpretive notes fell 36% and body text 26%.', decision: 'Not adopted.', status: 'decided', issue: 4767 },
  { area: 'Translation', question: 'Tibetan retranslation: which engine?', compared: 'Gemini Flash, Flash-Lite, MITRA-MT', evidence: 'Accuracy against 84000 human translations, 21 pages (exploratory)', result: 'MITRA invented on half its pages; Flash and Flash-Lite both scored a median 5 of 5.', decision: 'MITRA rejected; engine choice pending.', status: 'pending', issue: 4742 },
];
const STATUS_STYLE: Record<Decision['status'], string> = {
  decided: 'text-primary border-accent-rust',
  pending: 'text-secondary border-light',
  open: 'text-muted border-dashed border-light',
};

function DecisionsTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-light text-left text-muted">
            <th className="py-2 pr-3 font-medium">Question</th>
            <th className="py-2 pr-3 font-medium">Compared</th>
            <th className="py-2 pr-3 font-medium">Evidence</th>
            <th className="py-2 pr-3 font-medium">Result</th>
            <th className="py-2 font-medium">Decision</th>
          </tr>
        </thead>
        {(['OCR', 'Translation'] as const).map(area => (
          <tbody key={area}>
            <tr><td colSpan={5} className="pt-4 pb-1 text-primary font-semibold">{area === 'OCR' ? 'Transcription engines' : 'Translation engines and prompts'}</td></tr>
            {DECISIONS.filter(d => d.area === area).map(d => (
              <tr key={d.question} className="border-b border-light align-top">
                <td className="py-2 pr-3 text-primary leading-snug">{d.question}</td>
                <td className="py-2 pr-3 text-secondary leading-snug">{d.compared}</td>
                <td className="py-2 pr-3 text-muted leading-snug">{d.evidence}</td>
                <td className="py-2 pr-3 text-secondary leading-snug">{d.result}</td>
                <td className="py-2 text-secondary leading-snug">
                  <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] mr-1.5 ${STATUS_STYLE[d.status]}`}>{d.status}</span>
                  {d.decision}{' '}
                  <a href={`${GH_ISSUE}${d.issue}`} className="text-accent-rust hover:underline whitespace-nowrap">#{d.issue}</a>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/* ── Page furniture for the results part: block headings, callouts, key findings, contents ── */
function Block({ id, title, lede, children }: { id: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-24">
      <h2 className="text-xl md:text-2xl text-primary mb-3 text-balance">{title}</h2>
      {lede && <p className="text-secondary leading-relaxed mb-5 max-w-3xl">{lede}</p>}
      {children}
    </section>
  );
}

function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="my-6 border-l-2 border-accent-rust bg-white/60 rounded-r px-4 py-3 max-w-3xl">
      <div className="text-sm font-semibold text-primary mb-1">{title}</div>
      <div className="text-sm text-secondary leading-relaxed">{children}</div>
    </aside>
  );
}



function KeyFindings() {
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 list-none p-0 m-0">
      {KEY_FINDINGS.map(f => (
        <li key={f.figure} className="border border-light rounded bg-white/60 p-3 min-w-0">
          <a href={f.href} className="block group">
            <div className="text-2xl text-primary font-serif tabular-nums mb-1">{f.figure}</div>
            <div className="text-sm text-secondary leading-snug group-hover:text-primary">{f.text}</div>
          </a>
        </li>
      ))}
    </ol>
  );
}

const CONTENTS: { group: string; items: [string, string][] }[] = [
  { group: 'Results', items: [['#by-language', 'Quality by language'], ['#error-ladder', 'What an error rate looks like'], ['#engines', 'The engines'], ['#decisions', 'Which engine does what, and why'], ['#at-a-glance', 'Quality by test']] },
  { group: 'The paper', items: [['#s1', '1. The reader’s question'], ['#s2', '2. Related work'], ['#s3', '3. Transcription'], ['#s4', '4. Translation'], ['#s5', '5. What none of this measures'], ['#s6', '6. The reader panel'], ['#s7', '7. Limitations'], ['#s8', '8. Data and code'], ['#s9', '9. References']] },
];

function Contents() {
  return (
    <nav aria-label="Contents" className="grid gap-6 sm:grid-cols-2 text-sm border-y border-light py-5">
      {CONTENTS.map(g => (
        <div key={g.group}>
          <div className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-2">{g.group}</div>
          <ul className="list-none p-0 m-0 space-y-1">
            {g.items.map(([href, label]) => (
              <li key={href}><a href={href} className="text-secondary hover:text-accent-rust">{label}</a></li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ── The engines: what each reader of a page is ── */
type Engine = { name: string; maker: string; kind: 'commercial API' | 'open model' | 'existing text'; role: string; strengths: string; failures: string; issue?: number };
const ENGINES: Engine[] = [
  { name: 'Gemini 3.1 Flash-Lite', maker: 'Google', kind: 'commercial API', role: 'Reads every new transcription batch since 11 September 2026, in every language, and translates every page.', strengths: 'Cheapest Gemini model; close to Flash on clean European print.', failures: 'On hard scripts it can write plausible text that is not on the page (Tibetan, Jawi, Syriac); refuses about one English page in seven as “recitation”; loops on some manuscripts.' },
  { name: 'Gemini 3 Flash', maker: 'Google', kind: 'commercial API', role: 'Read most non-Latin-script pages before 11 September 2026.', strengths: 'Lower error than Flash-Lite on Greek and Chinese in our benchmarks.', failures: 'About twice the input price of Flash-Lite; shares its recitation and refusal behaviour on famous texts.' },
  { name: 'PaddleOCR-VL 1.6', maker: 'Baidu (PaddlePaddle)', kind: 'open model', role: 'Proposed reader for Chinese manuscripts; piloted on our own server.', strengths: 'On Siku Quanshu manuscripts, 0.9% of pages catastrophically wrong against Flash-Lite’s 10.6%.', failures: 'Its output does not yet fit our page format; no writer accepts it today.', issue: 5547 },
  { name: 'Kraken', maker: 'open source, with community-trained models', kind: 'open model', role: 'Reads Syriac (Beth Mardutho models); tested for Greek.', strengths: 'Reads what is on the leaf instead of a remembered text; trainable on a script.', failures: 'Only as good as the model for the script and hand; rejected for 18th-century Greek.', issue: 4883 },
  { name: 'Yigdzin (BDRC)', maker: 'Buddhist Digital Resource Center', kind: 'open model', role: 'Re-reads Tibetan pages.', strengths: '0.88 identity with the Derge e-text, against 0.41 for Gemini.', failures: 'Specialised to Tibetan; needs its own page-layout handling.', issue: 4523 },
  { name: 'NDL classical OCR v3', maker: 'National Diet Library, Japan', kind: 'open model', role: 'Proposed for Japanese cursive (kuzushiji).', strengths: 'Coherent on cursive pages where both Gemini models looped or invented.', failures: 'No reference texts yet, so its accuracy is unmeasured.', issue: 4745 },
  { name: 'MinerU', maker: 'OpenDataLab', kind: 'open model', role: 'Candidate fallback for English print when Gemini refuses.', strengths: 'Never refuses; strong on layout.', failures: 'Read worse than Flash-Lite page by page (10 to 49) and dropped footnotes before a fix.', issue: 5182 },
  { name: 'Internet Archive text layer', maker: 'the Internet Archive', kind: 'existing text', role: 'The OCR text published with each Archive scan; kept as a provisional first read on import.', strengths: 'Free and already there.', failures: 'Flash-Lite read better on 57 books to 5; misreads about 1.5% of printed numbers.', issue: 5186 },
];

function EngineCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {ENGINES.map(e => (
        <article key={e.name} className="border border-light rounded bg-white/60 p-4 min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
            <h3 className="text-lg text-primary font-semibold">{e.name}</h3>
            <span className="text-xs text-muted">{e.maker} · {e.kind}</span>
          </div>
          <dl className="text-sm leading-snug space-y-1.5">
            <div><dt className="inline text-muted">Role: </dt><dd className="inline text-secondary">{e.role}</dd></div>
            <div><dt className="inline text-muted">Good at: </dt><dd className="inline text-secondary">{e.strengths}</dd></div>
            <div><dt className="inline text-muted">Fails by: </dt><dd className="inline text-secondary">{e.failures}</dd></div>
          </dl>
          {e.issue && <a href={`${GH_ISSUE}${e.issue}`} className="text-xs text-accent-rust hover:underline mt-2 inline-block">Evidence: #{e.issue}</a>}
        </article>
      ))}
    </div>
  );
}

/* ── At a glance: every instrument, what it was checked against, and how much evidence ── */
// Proportions carry k/n so the interval is computed here; other rows quote the cited source.
// Grade uses the paper's own rule on independent units (books or pages): <30 exploratory,
// 30–49 directional, ≥50 decision-grade.
type Grade = 'decision-grade' | 'directional' | 'exploratory' | 'not run';
type GlanceRow = {
  test: string;
  against: string;
  result: string;
  bar?: { k: number; n: number } | { p: number; lo: number; hi: number };
  barLabel?: string;
  grade: Grade;
  note: number[];
};
const GLANCE: { link: string; rows: GlanceRow[] }[] = [
  {
    link: '1. Leaf — the image shown is the leaf transcribed',
    rows: [
      { test: 'Three-read signature', against: 'Scans read by a model', result: 'Caught 6 of 6 known wrong leaves; no false alarm on 258 right leaves', bar: { k: 6, n: 6 }, barLabel: 'known wrong leaves caught', grade: 'exploratory', note: [4, 13] },
      { test: 'How often the leaf is wrong', against: 'Scans read by a model', result: '2 of 20 audited pages', bar: { k: 2, n: 20 }, barLabel: 'pages showing the wrong leaf', grade: 'exploratory', note: [7, 13] },
    ],
  },
  {
    link: '2. Transcription — the text matches the image',
    rows: [
      { test: 'Accuracy, Latin print, Flash', against: 'Published e-texts', result: `Median character error ${pc1(LATIN_FLASH.median)} (CI ${pc1(LATIN_FLASH.ci[0])}–${pc1(LATIN_FLASH.ci[1])}), ${LATIN_FLASH.books} books`, grade: 'decision-grade', note: [1] },
      { test: 'Accuracy, Latin print, Flash-Lite', against: 'Published e-texts', result: `Median character error ${pc1(LATIN_LITE.median)} (CI ${pc1(LATIN_LITE.ci[0])}–${pc1(LATIN_LITE.ci[1])}), ${LATIN_LITE.books} books`, grade: 'decision-grade', note: [1] },
      { test: 'Printed numbers, English 1800–1930', against: 'Crops read blind by a model', result: 'Flash-Lite 1.8% wrong, Archive OCR 5.1%; 5,212 numbers', grade: 'directional', note: [3] },
      { test: 'Two-read screen for garble', against: 'The judge’s garble flag', result: 'AUC 0.79–0.83; held out, finds 55–58% of garble, 28% of flags are garble', grade: 'exploratory', note: [4, 13] },
      { test: 'Japanese, Sanskrit, Arabic, Korean, Persian, Ge’ez, Pali', against: 'No reference pages', result: 'Accuracy unknown', grade: 'not run', note: [2] },
    ],
  },
  {
    link: '3. Translation — the English matches the transcription',
    rows: [
      { test: 'Judge catches planted faults', against: 'Swapped and cut translations', result: '30 of 30 caught', bar: { k: 30, n: 30 }, barLabel: 'planted faults caught', grade: 'directional', note: [6, 13] },
      { test: 'Judge agrees with a second judge', against: 'Claude Sonnet, 107 pages', result: 'Sound or not: κ 0.56 (CI 0.32–0.76); 1–5 scale: weighted κ 0.73', grade: 'decision-grade', note: [13] },
      { test: 'Judge’s flags hold up on the scan', against: 'Scans read by a model', result: '20 of 21 flagged defects confirmed', bar: { k: 20, n: 21 }, barLabel: 'flags confirmed', grade: 'exploratory', note: [7, 13] },
      { test: 'Served pages the judge rates 4–5', against: 'The judge, 311 books', result: '89% (CI 85.5–92.5); 87–89% across weightings', bar: { p: 0.891, lo: 0.855, hi: 0.925 }, barLabel: 'pages rated faithful', grade: 'decision-grade', note: [6] },
    ],
  },
  {
    link: 'All three links at once',
    rows: [
      { test: 'Readers of the source language', against: 'People', result: 'Preregistered, not yet run (§6)', grade: 'not run', note: [10] },
    ],
  },
];

function GlanceBar({ bar, label }: { bar: NonNullable<GlanceRow['bar']>; label: string }) {
  const { p, lo, hi } = 'k' in bar ? { p: bar.k / bar.n, lo: wilson(bar.k, bar.n)[0], hi: wilson(bar.k, bar.n)[1] } : bar;
  const W = 120, x = (v: number) => 4 + v * (W - 8);
  const text = `${'k' in bar ? `${bar.k}/${bar.n}, ` : ''}${pct(p)} ${label} (95% CI ${pct(lo)}–${pct(hi)})`;
  return (
    <svg viewBox={`0 0 ${W} 14`} className="w-[7.5rem] h-auto shrink-0" role="img" aria-label={text}>
      <title>{text}</title>
      <line x1={x(0)} x2={x(1)} y1={7} y2={7} stroke="var(--border-light)" strokeWidth="1" />
      <line x1={x(0)} x2={x(0)} y1={3} y2={11} stroke="var(--border-light)" strokeWidth="1" />
      <line x1={x(1)} x2={x(1)} y1={3} y2={11} stroke="var(--border-light)" strokeWidth="1" />
      <line x1={x(lo)} x2={x(hi)} y1={7} y2={7} stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={x(p)} cy={7} r="3.5" fill="var(--accent-rust)" />
    </svg>
  );
}

const GRADE_STYLE: Record<Grade, string> = {
  'decision-grade': 'text-primary border-accent-rust',
  directional: 'text-secondary border-light',
  exploratory: 'text-muted border-light',
  'not run': 'text-muted border-dashed border-light',
};

function GlanceTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-light text-left text-muted">
            <th className="py-2 pr-3 font-medium">Test</th>
            <th className="py-2 pr-3 font-medium">Checked against</th>
            <th className="py-2 pr-3 font-medium">Result</th>
            <th className="py-2 pr-3 font-medium">0–100%, 95% CI</th>
            <th className="py-2 font-medium">Evidence</th>
          </tr>
        </thead>
        {GLANCE.map(g => (
          <tbody key={g.link}>
            <tr>
              <td colSpan={5} className="pt-4 pb-1 text-primary font-semibold">{g.link}</td>
            </tr>
            {g.rows.map(r => (
              <tr key={r.test} className="border-b border-light align-top">
                <td className="py-2 pr-3 text-primary leading-snug">{r.test}</td>
                <td className="py-2 pr-3 text-secondary leading-snug">{r.against}</td>
                <td className="py-2 pr-3 text-secondary leading-snug tabular-nums">
                  {r.result}
                  {r.note.map(n => <N key={n} n={n} />)}
                </td>
                <td className="py-2 pr-3">{r.bar && r.barLabel ? <GlanceBar bar={r.bar} label={r.barLabel} /> : null}</td>
                <td className="py-2">
                  <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-xs ${GRADE_STYLE[r.grade]}`}>{r.grade}</span>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
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
  /** Holding institution and rights, checked against image_source.rights_normalized and the source on 2026-10-01 (#5495). */
  credit: { text: string; href: string };
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
    credit: { text: 'Scan: Harvard Library, Harvard University. Public domain.', href: 'https://nrs.lib.harvard.edu/URN-3:FHCL:1184543:MANIFEST:2' },
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
    credit: { text: 'Scan: Duke University Libraries, digitised by the Internet Archive. Public domain.', href: 'https://archive.org/details/oxyrhynchuspapyrunse_69' },
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
    credit: { text: 'Scan: Dharmartha Trust, Raghunath Temple, Jammu, via the Internet Archive. CC0 1.0.', href: 'https://archive.org/details/PrashnaDeepakamAlm28Shlf36289DevanagariJyotish' },
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
        The scan {s.scanNote}. {s.note}{' '}
        <a href={s.credit.href} className="text-accent-rust hover:underline">{s.credit.text}</a>
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
            <strong className="text-primary">Transcription.</strong> Where a reference text exists, we measure accuracy. On Latin print the character error rate is {pc1(LATIN_FLASH.median)} for one engine and {pc1(LATIN_LITE.median)} for the cheaper one, which now reads every new page. Most scripts and periods still have too few reference pages to decide anything. Reading a page twice and comparing the reads is a cheaper screen. On pages held out from tuning it finds a little over half of the pages a judge called garbled, and only about 30% of the pages it flags are garbled. It also caught all six pages we already knew showed the wrong leaf, and found a seventh.
          </p>
          <p className="text-secondary leading-relaxed mb-4">
            <strong className="text-primary">Translation.</strong> A source-grounded model judge (Claude Opus) rated one random page from each of 311 books. With planted controls passing, it rated 89% of pages faithful to their transcription (95% CI 85–92), and 71% for non-Latin scripts. The judge reads text only. A model check of 20 of those pages against their scans found two that showed a different page from the one transcribed. The judge could not have seen either.
          </p>
          <p className="text-secondary leading-relaxed mb-4">
            <strong className="text-primary">By language.</strong> The picture is uneven. Latin, English and German, two-thirds of translated pages, have measured transcription (0.6–5.3% character error on the current engine) and the judge rated 92–97% of their pages faithful. Greek, a tenth of the library, is the largest gap: 11% character error on the current engine (6.6% on Flash) and 75% rated faithful. French, Italian, Dutch and Spanish, about 13% of translated pages, have no transcription measurement at all, and most smaller languages have too few judged books to compare with each other. Chinese shows 19–25% character error, but against other editions of the same texts, so part of that may be variant characters rather than misreads. The grid below gives every language.
          </p>
          <p className="text-secondary leading-relaxed">
            <strong className="text-primary">The missing part.</strong> None of these measurements involves a human reader. We preregister a standing panel of volunteers who read the source languages. Each is asked one question about one page drawn from the judge&rsquo;s own monthly sample. We will report how often the readers agree with the judge, what each side misses, and how many volunteers answer when asked.
          </p>
        </section>

        {/* ── Key findings and contents ── */}
        <section aria-label="Key findings" className="mb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3"><h2 className="text-xs uppercase tracking-[0.16em] text-muted font-semibold">Key findings</h2><Link href="/research/quality/summary" className="text-sm text-accent-rust hover:underline">One-page summary, for printing</Link></div>
          <KeyFindings />
        </section>
        <Contents />

        {/* ── Results ── */}
        <div className="mt-12">
          <div className="text-xs uppercase tracking-[0.16em] text-muted font-semibold">Results</div>
        </div>

        <Block id="by-language" title="Quality by language">

          <p className="text-secondary leading-relaxed mb-4">
            One row per catalogue language, largest first. The question for each row is how good its pages are and how sure we are. Character error is measured against a published e-text, one page per book; Flash-Lite has read every new page since 11 September 2026, and Flash, which read most non-Latin pages before then, is shown for comparison. The translation column is the share of pages a model judge rated faithful (4 or 5 of 5), which is a model&rsquo;s judgement and not accuracy. No row has yet been checked by a person who reads the language (§6).
          </p>
          <LanguageGrid />
          <p className="text-xs text-muted leading-relaxed mt-3">
            Grades count the books behind a cell: under 30 exploratory, 30 to 49 directional, 50 or more decision-grade. Translation figures pool every monthly random-sample audit, counting each book once ({byLanguage.translation_books} books so far). Share of translated pages is each language&rsquo;s share of live translated pages at the audit draw. Generated {byLanguage.generated} by scripts/eval/quality-by-language.mjs.<N n={1} /><N n={6} />
          </p>
        
        </Block>

        <Block id="error-ladder" title="What an error rate looks like" lede="A character error rate or a judge rating means little until it is seen. Each rung is a real page from the measurements above, with what that level of error allows a reader to do.">
          <ErrorLadder />
        </Block>

        <Block id="engines" title="The engines" lede="A page can be read by a commercial model or by an open model trained for one script. These are the readers in use or under test, what each is good at, and how each fails.">
          <EngineCards />
        </Block>

        <Block id="decisions" title="Which engine does what, and why">

          <p className="text-secondary leading-relaxed mb-4">
            The measurements above exist to choose engines and prompts. Each row is one of those choices: what was compared, on what evidence, what it found, and what was decided. A rule for each comparison was written down before the run. &ldquo;Decided&rdquo; means a person signed off; &ldquo;pending&rdquo; means the result is in and the decision is not; &ldquo;open&rdquo; means the evidence cannot yet settle it, or practice differs from it.
          </p>
          <DecisionsTable />
          <Callout title="One decision cuts across the transcription rows">
            Since 11 September 2026, to hold down cost, every new transcription batch runs on Gemini Flash-Lite, in every language. The per-script choices above (Flash for Greek, Chinese and other non-Latin scripts) describe pages read before that date and the routing the experiments support; Syriac and Tibetan are read outside Gemini and are unaffected. The full ledger, with every run and its re-measure trigger, is <a href={`${GH}scripts/eval/DECISIONS.md`} className="text-accent-rust hover:underline">scripts/eval/DECISIONS.md</a>.
          </Callout>

        
        </Block>

        <Block id="at-a-glance" title="Quality by test">

          <p className="text-secondary leading-relaxed mb-4">
            Every quality test in this draft, grouped by the link it checks. &ldquo;Checked against&rdquo; is the point: only the rows checked against published texts measure accuracy, and no row is yet checked against a person. The evidence grade counts independent books or pages: under 30 is exploratory, 30 to 49 directional, 50 or more decision-grade.
          </p>
          <GlanceTable />
          <p className="text-xs text-muted leading-relaxed mt-3">
            Bars show a share on a 0–100% scale, with the dot at the estimate and the line spanning the 95% interval; rows without a bar report a quantity that is not a share. A grade says how many units stand behind a row, not that the row measures the right thing.
          </p>
        
        </Block>

        <div className="mt-16 text-xs uppercase tracking-[0.16em] text-muted font-semibold">The paper</div>

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
            caption={<>Three pages from the translation audit (§4), each shown as a crop of the scan the reader sees, an excerpt of the transcription, and an excerpt of the English, as served on 30 September 2026. Ellipses mark omitted text. Each scan was opened and read for this figure. Panel (a) is garble that a text-only judge can catch because it is visible in the transcription. Panel (b) is a failure no text-only instrument can see. Panel (c) is a translation error proper. Each panel credits the institution that holds the original; rights were checked for each scan before use.<N n={7} /><N n={8} /></>}
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
            On Latin, with {LATIN_FLASH.books} referenced books, the median character error rate is {pc1(LATIN_FLASH.median)} for Gemini 3 Flash ({LATIN_FLASH.pages} aligned pages, 95% CI {pc1(LATIN_FLASH.ci[0])}–{pc1(LATIN_FLASH.ci[1])}) and {pc1(LATIN_LITE.median)} for Gemini 3.1 Flash-Lite, the cheaper engine that has read every new page in every language since 11 September 2026 ({LATIN_LITE.pages} pages, CI {pc1(LATIN_LITE.ci[0])}–{pc1(LATIN_LITE.ci[1])}). Both cells are decision-grade.<N n={1} /> Most cells are not. Of the {n0(ocrEvidence.totals.cells)} cells in the evidence table, {CELL_GRADES['decision-grade']} are decision-grade, {CELL_GRADES.directional} directional and {n0(CELL_GRADES.exploratory)} exploratory.<N n={1} /> The language grid above shows where the decision-grade cells fall. Japanese, Sanskrit, Arabic, Korean, Persian, Ge&rsquo;ez and Pali have no reference pages at all, and Hebrew has four, all in square script.<N n={2} /> For those scripts we cannot yet say how accurate the transcription is.
          </P>
          <P>
            One narrower accuracy check reads the numbers. On English books printed 1800–1930, every printed number on which two engines disagreed was cropped from the page image and read blind by a model, with no engine&rsquo;s reading on the sheet. Of 5,212 printed numbers across 82 books, the Internet Archive&rsquo;s own OCR had 5.1% wrong (CI 3.8–7.4) and Flash-Lite 1.8% (CI 1.1–3.1). This is directional, and the reader of the crops was a model, not a person.<N n={3} />
          </P>
          <P>
            <strong>A screen where no reference exists.</strong> Reading a page a second time and comparing the two reads costs a tenth to a fifth of a cent per page. We tested it on 327 pages the translation judge (§4) had rated, one per book, using the judge&rsquo;s garble flag as the label: 32 pages were flagged. A fresh Flash-Lite read that agreed with the served text on less than 70% of its tokens flagged 70 pages, 20 of them garbled: precision 29%, recall 74%. A fresh Flash read gave 30% and 70%.<N n={4} /><N n={5} /> Those figures are flattering, because the 0.7 threshold was chosen on these same pages. Choosing the threshold on a random half and scoring it on the other half, repeated a thousand times, recall falls to 55% (lite) and 58% (Flash), and precision stays near 28%. A measure that needs no threshold says the same: a garbled page has a lower agreement than a sound one 79% of the time for the lite read (AUC 0.79, CI 0.70–0.88) and 83% for Flash (CI 0.77–0.89).<N n={13} /> The screen finds about half the garbled pages and mostly flags pages that are not. On Latin-script pages it does not separate at all (precision about 10%); 24 of the 30 garbled pages it could judge were in non-Latin scripts.<N n={4} />
          </P>
          <P>
            Two cautions keep these numbers in proportion. The label is itself a model&rsquo;s: re-run on the same pages, the judge reproduced its own garble flag with a precision of 51–58% (Figure 3). So the screen cannot reach a high precision against this label even if it were perfect. Corrected for chance, the screen agrees with the label at κ = 0.29.<N n={13} /> And when model readers looked at 18 of the &ldquo;hard&rdquo; pages against the scan, the served text was unreliable on 8 (44%, CI 25–66).<N n={4} />
          </P>
          <P>
            The same reads did one thing cleanly. When the served text disagrees with both fresh reads (agreement under 0.3) while the fresh reads agree with each other (0.9 or more), the served text is likely to belong to a different leaf. All six wrong-leaf pages known before the test had this signature, and it found a seventh; all seven pages that carried it showed the wrong leaf when read against the scan, and none of the 258 pages confirmed as the right leaf carried it.<N n={4} /> These are small counts. Six of six is consistent with a true catch rate as low as 61%, and 0 of 258 with a false-alarm rate up to 1.5% (95% Wilson intervals).<N n={13} /> This is the instrument in Figure 1 that reaches link 1.
          </P>

          <Figure
            n={3}
            caption={<>The two-read screen at the 0.7 agreement threshold, scored against the judge&rsquo;s garble flag on the audited pages. These are in-sample figures, on the pages the threshold was chosen on; held out, recall is 55–58% (§3). Dots are point estimates with 95% Wilson intervals<span className="whitespace-nowrap"> {cite('wilson1927')}</span> computed from the counts shown; the &ldquo;hard page&rdquo; recall is reported without a count. The judge&rsquo;s own repeat is drawn as the range over three re-runs: it shows how well the label agrees with itself, a practical limit on what any screen can score against it. The approach is related to Consensus Entropy {cite('zhang2025')}, which uses agreement between several vision-language models to flag bad OCR.<N n={4} /><N n={5} /></>}
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
            <strong>Controls first.</strong> Before any rating is read, planted items test the judge. Fifteen translations were swapped for the translation of another page; the judge rated all 15 at 2 or lower. Fifteen had their middle third removed; it flagged omission on all 15. Fifteen items were judged twice; 11 got the identical rating and all 15 were within one point.<N n={6} /> Fifteen planted items each is enough to show the judge is not blind to these faults, not to measure how often it misses them: 15 of 15 is consistent with a catch rate as low as 80%, and 11 of 15 identical with anything from 48% to 89%.<N n={13} /> The run would not have been reported had the controls failed.
          </P>

          <Figure n={4} caption={<>Planted controls, 15 items each. Filled squares pass. For the repeat control, outlined squares are items whose second rating differed by one point. The gate was set before the run.<N n={6} /></>}>
            <ControlsFigure />
          </Figure>

          <P>
            <strong>The estimate.</strong> The quantity estimated is the share of served translated pages, in the 15 sampled languages, that the judge rates 4 or 5. Each language&rsquo;s share of the sample is re-weighted to its share of live translated pages (Latin 40%, English 16%, German 12%, Greek 10%, the other eleven 22%), and the interval is a bootstrap over books within each language. Weighted this way, the judge rated 89.1% of served pages 4 or 5 (95% CI 85.5–92.5), 3.4% at 2 or lower, and found a major defect on 11.4% (CI 7.6–15.6). The headline does not depend much on the weighting. Weighting each book by its number of translated pages, so that the unit is a random page and not a random book, gives 89.3%. Correcting for the sample&rsquo;s even split between the two translation models, which production does not share, gives 87.2%. The share with a major defect moves more, from 11.4% to 14.4%. The most common flags were omission (14.8%), invention (11.2%), garble carried through from the transcription (6.6%), and inversion (3.9%).<N n={6} /> For Latin-script books the share at 4 or 5 was 92.9% (198 books); for non-Latin scripts, 70.8% (113 books).<N n={6} /> Figure 5 gives the per-language counts. Most cells are small, and the intervals say so.
          </P>

          <Figure
            n={5}
            caption={<>Share of audited pages the judge rated 4 or 5, by catalogue language, one page per book, with 95% Wilson intervals {cite('wilson1927')} computed from the counts in the audit report. The dashed line is the language-weighted estimate for all pages. *Catalogue label only: in the hand-read subset, an &ldquo;Arabic&rdquo; page was German and a &ldquo;Korean&rdquo; page was Classical Chinese.<N n={6} /><N n={7} /></>}
          >
            <LanguageFigure />
          </Figure>

          <P>
            <strong>Checking the judge.</strong> A second judge (Claude Sonnet) rated 107 of the same pages; the two gave the identical rating on 67.3% and were within one point on all 107.<N n={6} /> Raw agreement flatters a scale where most ratings are 4 or 5. Corrected for chance, the agreement on the 1–5 scale is a quadratic-weighted κ of 0.73 (CI 0.60–0.83). On the decision the estimate rests on, sound (4–5) or not, the two agree on 89% of pages, but κ is 0.56 (CI 0.32–0.76): moderate. Gwet&rsquo;s AC1, which is less affected by how rare one answer is, gives 0.85 (CI 0.75–0.93). Opus is the more lenient of the two: it called 88% of these pages sound, Sonnet 82%.<N n={13} /> That is agreement between two models of one family, not accuracy. For a stronger check, a model opened the scan of 20 pages, drawn at random from the audit, and read it against the transcription and the English. Of 21 defects the judge had flagged on those pages, 20 were confirmed (95% CI 77–99%) and none rejected; on the 9 pages the judge rated 5, no major defect had been missed.<N n={7} /><N n={13} /> But on 2 of the 20 pages, both Internet Archive scans, the image shown was a different printed page from the one transcribed and translated. The judge rated both translations as faithful, correctly, because they are faithful to their text. Figure 2 shows one of them.
          </P>

          <P>
            <strong>What &ldquo;invention&rdquo; covers.</strong> The judge flagged invention on 45 of the 311 audited pages (14 of them major). We read each flag against the transcription, the neighbouring pages and, where the claim turned on it, the scan.<N n={6} /> The flags fall into four kinds, and only one of them is text made from nothing.
          </P>
          <ul className="list-disc pl-6 space-y-3 text-base leading-relaxed mb-6">
            <li>
              <strong>Text from the next or previous page (14 pages, 8 of the 14 major).</strong> A page that ends mid-sentence is translated to the end of the sentence, and sometimes to the end of the paragraph. For 13 of the 14, the added English is on the adjacent page. On a page of the <em>Nongzheng quanshu</em> (1782) that stops at 內六十四成積五億, the English goes on to &ldquo;576,000,000 bu &hellip; 5,760,000 mu &hellip; 173,629.44 mu&rdquo;. Those are the sums that open the next page. A Dutch voyage account of 1706 ends at &ldquo;na dat hy ontrent 4 mij-&rdquo;, and the English supplies the next page&rsquo;s paragraph on the <em>Susanna</em> and the 53 dead. On a page of <em>Ideal Suggestion</em> (1893) that carries only &ldquo;SEVENTEENTH SUGGESTION&rdquo; and &ldquo;I LISTEN&rdquo;, the English is the previous page&rsquo;s meditation. The text is real, but it is attached to the wrong page, and a reader who quotes it cites the wrong page. The judge sees one page at a time, so it counts this as invention. This is a page-boundary defect, not a fabrication.
            </li>
            <li>
              <strong>Unreadable source filled with plausible content (6 pages, 5 major).</strong> Here the source cannot support the English. A page of the Herculaneum papyri facsimiles (1871) is almost blank in the scan, and its English is a paragraph of Epicurean theology. On a tenth-century manuscript of the Greek alchemists (Marcianus gr. 299), the passage on pounding gold ore in stone mortars (ὅλμοις λιθίνοις, legible in the scan) becomes sentences about laws, elders and purification. A Dunhuang Vinaya scroll whose transcription is garbled acquires a numbered fifteen-item list. All six are manuscripts, damaged pages or garbled transcriptions. This is the kind a reader cannot detect, because the English reads fluently.
            </li>
            <li>
              <strong>Editorial additions in notes, headings and summaries (21 pages, 1 major).</strong> The translation of the page is sound, but a note or heading asserts something the page does not say. Examples: a first name (&ldquo;Samuel G. Fenton&rdquo; for &ldquo;Fenton, S. G.&rdquo;), an author and a date for a Korean poem collection, expansions of one-character Japanese place abbreviations given as fact, a volume number in a running head, and a description of an illustration on a page that has none.
            </li>
            <li>
              <strong>Bracketed glosses (4 pages, none major).</strong> Words the translator marked as its own, such as &ldquo;[Marriage] is the most happy&rdquo;. They are interpretive, but they are labelled.
            </li>
          </ul>
          <P>
            The two translation models differ mainly in the third kind. Flash added unsupported editorial matter on 17 of the 21 pages, Flash-Lite on 4. On the other kinds they are close: 6 and 8 for page-boundary text, 4 and 2 for unreadable source. A separate paired run, which translated the same 304 pages with both models, points the same way. The judge flagged invention on 15.8% of Flash pages against 8.2% of Flash-Lite pages, with no measurable difference in the share rated 4 or 5.<N n={6} /> The invention rate above therefore overstates fabrication. Text with no source behind it was found on 6 of the 311 pages; page-boundary text on 14.
          </P>

        </Section>

        {/* ── 5 ── */}
        <Section n={5} title="What none of this measures">
          <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-3">
            <li><strong>A human reading.</strong> Every instrument above is a model, or a model reading an image. None has been checked against a person who reads the source language. The judge&rsquo;s own error rate is therefore unknown.<N n={9} /></li>
            <li><strong>Leaf identity at scale.</strong> We have a signature that catches wrong leaves and a count of two in twenty on one hand-read sample. Two in twenty is consistent with anything from 3% to 30% of pages.<N n={13} /> We do not have a rate. A sample large enough to give one to within a few points is the cheapest measurement missing from this draft.<N n={2} /></li>
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
            The pages are the judge&rsquo;s own monthly random draw, one interior page per book, starting with the 30 September audit less its wrong-leaf pages. Readers get pages in the language they named and never see the judge&rsquo;s verdict. Pages alternate between those the judge called defective and those it called sound, each in seeded random order. Only about one page in seven is judged defective, so under plain random order a reader would rarely see one: about 265 answers before 40 fell on defective pages.<N n={13} /> Each answer is stored with a hash of the transcription and of the translation it was given against, so an answer on text that has since changed is set aside.<N n={10} />
          </P>
          <P>
            Second readers serve two purposes, kept apart. One answered page in five, chosen by a seeded draw before the first answer is read, goes to a second reader whatever the first one said. Those pages measure how often two readers agree with each other, which is the ceiling for any judge: if two readers agree on 85% of pages, a judge that agrees with readers 85% of the time is doing as well as a reader. Every page where a reader and the judge disagree also goes to a second reader, but only for the catalogue of findings. Checking only the disagreements would let a second reader overturn a reader but never a reader who agreed with the judge, so it could only push measured agreement up. Diagnostic-test research knows this as discrepant resolution.<N n={10} />
          </P>
          <P>
            We will report, monthly and cumulatively: agreement with the judge, separately for pages it called sound and pages it called defective, each with n, the number of readers, and an interval that allows for one reader answering many pages; the overall figure, re-weighted to the draw&rsquo;s own mix because defective pages are over-represented; agreement between two readers, as κ, once 40 pages have been double-read; a catalogue of what readers found that the judge missed and the reverse, each with its page and the reader&rsquo;s words; and the response funnel, from letters sent to pages answered, by language. For agreement on sound pages (expected near 90%), 34 answers give an interval of ±10 points. For defective pages, where agreement may be nearer 50–70%, the same precision takes 78–93 answers; month 0 holds 47 such pages. Figures are marked preliminary until they reach these sizes. Sensitivity and specificity, treating readers as the reference, are reported only next to the reader–reader figure; per-language rates wait for 30 answers in a language.<N n={10} /><N n={13} />
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
            <li><strong>The screen was tuned on its own sample.</strong> The 0.7 threshold and the three-read classes were chosen on the same 327 pages they are reported on. Cross-validation on those pages lowers the recall from 70–74% to 55–58%, but it is not a replication on a new draw.<N n={4} /><N n={13} /></li>
            <li><strong>Many cells, no correction.</strong> The evidence table has 1,188 cells and Figure 5 has fifteen languages. We test no hypotheses and rank no languages. With this many intervals, some will miss their true value by chance alone, so a single cell that stands out should be re-measured before it is acted on.</li>
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
