import { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import byLanguage from '@/data/quality-by-language.json';
import covariatesJson from '@/data/quality-covariates.json';
import { KEY_FINDINGS } from '../findings';

// A two-sheet summary of /research/quality for a statistician or research partner deciding, in about
// five minutes, whether the evidence is credible and what it supports. It prints from the browser
// (Print → Save as PDF). Every figure comes from the same files as the paper; the covariate panels
// read src/data/quality-covariates.json (scripts/eval/quality-covariates.mjs, #5615).
export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Page Quality — Summary — Source Library Research',
  description: 'How good are Source Library’s transcriptions and translations, language by language, how was it measured, and do date, text density or scan size explain the differences? A two-page summary of the working paper.',
  alternates: { canonical: '/research/quality/summary' },
};

const PAPER = '/research/quality';
const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';
const PREREG = `${GH}scripts/eval/translation-corpus-audit/HUMAN-CALIBRATION.md`;
const EVAL_DESIGN = `${GH}.claude/docs/eval-design.md`;
const STATS = `${GH}scripts/eval/results/quality-paper-stats-2026-10-01/report.md`;
const AUDIT = `${GH}scripts/eval/results/translation-corpus-audit-2026-09-30/README.md`;
const COV_LOG = `${GH}scripts/eval/experiments/2026-10-02-quality-by-date-chars-resolution-5615.md`;
const COV_SCRIPT = `${GH}scripts/eval/quality-covariates.mjs`;
const COV2_LOG = `${GH}scripts/eval/experiments/2026-10-02-quality-by-manuscript-library-content-5623.md`;
const DESCRIPTOR = `${GH}scripts/eval/lib/page-descriptor.mjs`;
const DESCRIPTOR_DATA = `${GH}scripts/eval/output/page-descriptors-5623.json`;
const MS_RULE = `${GH}scripts/lib/syriac-kraken-lane.mjs`;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const cer = (x: number | null) => (x == null ? '—' : x < 0.01 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 1000) / 10}%`);

// ── the covariate file, typed ───────────────────────────────────────────────
type Ci = number[] | null;
type RateCell = { level: string; n: number; k: number; rate: number | null; ci: Ci; grade: string; non_latin: number; range?: string | null; latin: { n: number; k: number; rate: number; ci: Ci } | null; nonlatin: { n: number; k: number; rate: number; ci: Ci } | null };
type CerCell = { level: string; n: number; median: number | null; ci: Ci; grade: string; range?: string | null };
type CerSet = { n: number; char_cuts: number[]; by_period: CerCell[]; by_chars: CerCell[]; by_resolution: CerCell[]; by_manuscript: CerCell[]; by_provider: CerCell[]; by_content: CerCell[] };
type Tab = Record<string, Record<string, number>>;
type Share = { n: number; agree: number; rate: number | null; ci: Ci };
type Term = { term: string; n_at_level: number | null; odds_ratio: number; ci: number[]; p: number };
type Cov = {
  generated: string;
  translation: { n: number; char_cuts: number[]; by_period: RateCell[]; by_chars: RateCell[]; by_resolution: RateCell[]; by_manuscript: RateCell[]; by_provider: RateCell[]; by_content: RateCell[]; cross: { manuscript_by_script: Tab; manuscript_by_period: Tab; provider_by_manuscript: Tab } };
  ocr: Record<'lite' | 'flash', { engine: string; n: number; within_script: Record<'Latin' | 'Greek' | 'Han', CerSet>; cross: { manuscript_by_script: Tab } }>;
  regression: { n: number; events: number; terms: Term[]; mixed_counted_as_print: number };
  regression_without_manuscript: { terms: Term[] };
  coverage: Record<'translation' | 'ocr_lite', { n: number; page_script_src: Record<string, number>; ms_rule: Record<string, number>; content_src: Record<string, number> }>;
  format: { skipped: boolean; reason: string | null };
  descriptor: { described: number; failed: number; usd: number; agreement_with_inline_tags: { pages: number; script: Share; page_type: Share; page_type_partial: Share; has_marginalia: Share; has_illustration: Share }; agreement_on_handwritten_or_mixed_tags: { pages: number; script: Share } };
  fallback_rule_check: { n: number; agree: number; label_by_fallback: Tab };
};
const cov = covariatesJson as unknown as Cov;
const at = <T extends { level: string }>(cells: T[], level: string) => cells.find(c => c.level === level);

// ── small pieces ────────────────────────────────────────────────────────────
function MethodLinks({ links }: { links: [string, string][] }) {
  return (
    <div className="text-[11px] text-muted mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 print:mt-1">
      <span className="uppercase tracking-[0.12em] font-semibold">Read the method</span>
      {links.map(([label, href]) => (
        href.startsWith('http')
          ? <a key={href} href={href} className="text-accent-rust hover:underline">{label}</a>
          : <Link key={href} href={href} className="text-accent-rust hover:underline">{label}</Link>
      ))}
    </div>
  );
}

function H2({ id, children, kicker }: { id: string; children: ReactNode; kicker?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 mb-2">
      {kicker && <span className="text-[11px] uppercase tracking-[0.16em] text-muted font-semibold">{kicker}</span>}
      <h2 id={id} className="text-lg text-primary font-serif leading-tight">{children}</h2>
    </div>
  );
}

function Bar({ p, lo, hi }: { p: number; lo: number; hi: number }) {
  const W = 90, x = (v: number) => 3 + v * (W - 6);
  return (
    <svg viewBox={`0 0 ${W} 10`} className="w-[5.6rem] h-auto shrink-0" role="img" aria-label={`${pct(p)}, 95% CI ${pct(lo)}–${pct(hi)}`}>
      <line x1={x(0)} x2={x(1)} y1={5} y2={5} stroke="var(--border-light)" strokeWidth="1" />
      <line x1={x(lo)} x2={x(hi)} y1={5} y2={5} stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={x(p)} cy={5} r="3" fill="var(--accent-rust)" />
    </svg>
  );
}

// ── small multiples: one dot and interval per series per level, same scale across a row ──
type Series = { key: string; label: string; color: string };
type Pt = { series: string; est: number | null; ci: Ci; n: number; text: string };
type Scale = { kind: 'linear' | 'log'; min: number; max: number; ticks: [number, string][] };
const W = 120, PAD = 4;
const sx = (s: Scale, v: number) => {
  const c = Math.min(s.max, Math.max(s.min, v));
  const f = s.kind === 'log' ? (Math.log10(c) - Math.log10(s.min)) / (Math.log10(s.max) - Math.log10(s.min)) : (c - s.min) / (s.max - s.min);
  return PAD + f * (W - 2 * PAD);
};

function Dots({ pts, series, scale }: { pts: Pt[]; series: Series[]; scale: Scale }) {
  const H = series.length * 7 + 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={pts.map(p => `${series.find(s => s.key === p.series)?.label}: ${p.text}`).join('; ')}>
      {scale.ticks.map(([v]) => <line key={v} x1={sx(scale, v)} x2={sx(scale, v)} y1={0} y2={H} stroke="var(--border-light)" strokeWidth="0.5" />)}
      {series.map((s, i) => {
        const p = pts.find(q => q.series === s.key);
        if (!p || p.est == null) return null;
        const y = 4.5 + i * 7, small = p.n < 30;
        return (
          <g key={s.key}>
            {p.ci && <line x1={sx(scale, p.ci[0])} x2={sx(scale, p.ci[1])} y1={y} y2={y} stroke={s.color} strokeWidth="1.4" strokeLinecap="round" opacity={small ? 0.45 : 0.8} />}
            <circle cx={sx(scale, p.est)} cy={y} r="2.4" fill={small ? 'var(--bg-white)' : s.color} stroke={s.color} strokeWidth="1" />
          </g>
        );
      })}
    </svg>
  );
}

function Axis({ scale }: { scale: Scale }) {
  return (
    <svg viewBox={`0 0 ${W} 8`} className="w-full h-auto" aria-hidden="true">
      {scale.ticks.map(([v, label], i) => <text key={v} x={sx(scale, v)} y={6} textAnchor={i === 0 ? 'start' : i === scale.ticks.length - 1 ? 'end' : 'middle'} fontSize="5.5" fill="var(--text-muted)">{label}</text>)}
    </svg>
  );
}

function Panel({ title, note, rows, series, scale }: { title: string; note?: ReactNode; rows: { label: string; sub?: string; pts: Pt[] }[]; series: Series[]; scale: Scale }) {
  return (
    <figure className="min-w-0 print:break-inside-avoid m-0">
      <figcaption className="text-xs text-primary font-semibold mb-1">{title}</figcaption>
      <div className="grid grid-cols-[4.6rem_minmax(0,1fr)_4.4rem] gap-x-1.5 items-center">
        {rows.map(r => (
          <div key={r.label} className="contents">
            <div className="text-[11px] text-secondary leading-tight py-0.5">{r.label}{r.sub && <span className="block text-[10px] text-muted">{r.sub}</span>}</div>
            <Dots pts={r.pts} series={series} scale={scale} />
            <div className="text-[10px] text-muted tabular-nums leading-[1.35] text-right">
              {series.map(s => { const p = r.pts.find(q => q.series === s.key); return <div key={s.key}>{p && p.est != null ? p.text : '·'}</div>; })}
            </div>
          </div>
        ))}
        <div /><Axis scale={scale} /><div />
      </div>
      {note && <p className="text-[10px] text-muted leading-snug mt-0.5">{note}</p>}
    </figure>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-secondary">
      {series.map(s => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" aria-hidden="true"><circle cx="5" cy="5" r="4" fill={s.color} /></svg>{s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-muted">
        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="var(--bg-white)" stroke="var(--text-muted)" strokeWidth="1" /></svg>under 30 pages: exploratory
      </span>
    </div>
  );
}

// ── the data behind the panels ──────────────────────────────────────────────
const PERIOD_LABEL: Record<string, string> = { 'pre-1500': 'before 1500', '1500s': '1500s', '1600s': '1600s', '1700s': '1700s', '1800s': '1800s', '1900+': '1900 on', unknown: 'no date' };
const CHAR_LABEL: Record<string, string> = { fewest: 'fewest third', middle: 'middle third', most: 'most third' };
const MS_LABEL: Record<string, string> = { print: 'print', manuscript: 'manuscript', mixed: 'mixed hand and print' };
const CONTENT_LABEL: Record<string, string> = { 'plain text': 'plain text', marginalia: 'marginalia', table: 'table', illustration: 'illustration' };
const PROVIDER_NAME: Record<string, string> = { internet_archive: 'Internet Archive', bph: 'Ritman Library (BPH)', bsb: 'BSB Munich', harvard: 'Harvard', 'e-rara': 'e-rara', gallica: 'Gallica', bl: 'British Library', wikimedia_commons: 'Wikimedia Commons', other: 'other libraries' };
const RES_LABEL: Record<string, string> = { '<1500 px': 'under 1,500', '1500–2499 px': '1,500–2,499', '≥2500 px': '2,500 or more', unknown: 'external scan' };

const T_SERIES: Series[] = [
  { key: 'latin', label: 'Latin script', color: 'var(--text-primary)' },
  { key: 'nonlatin', label: 'Other scripts', color: 'var(--accent-rust)' },
];
const O_SERIES: Series[] = [
  { key: 'Latin', label: 'Latin script', color: 'var(--text-primary)' },
  { key: 'Greek', label: 'Greek', color: 'var(--accent-rust)' },
  { key: 'Han', label: 'Chinese', color: 'var(--accent-sage-dark)' },
];
const RATE_SCALE: Scale = { kind: 'linear', min: 0, max: 1, ticks: [[0, '0'], [0.5, '50%'], [1, '100%']] };
const CER_SCALE: Scale = { kind: 'log', min: 0.001, max: 0.5, ticks: [[0.001, '0.1%'], [0.01, '1%'], [0.1, '10%'], [0.5, '50%']] };

function rateRows(cells: RateCell[], labels: Record<string, string>) {
  return cells.filter(c => labels[c.level]).map(c => ({
    label: labels[c.level], sub: c.range ? `${c.range} chars` : undefined,
    pts: (['latin', 'nonlatin'] as const).map(k => {
      const s = c[k];
      return { series: k, est: s?.rate ?? null, ci: s?.ci ?? null, n: s?.n ?? 0, text: s ? `${s.k}/${s.n}` : '' };
    }),
  }));
}
// OCR cells under five pages carry no interval and are left out of the panel (counted in the note).
function cerRows(dim: 'by_period' | 'by_chars' | 'by_resolution' | 'by_manuscript' | 'by_provider' | 'by_content', labels: Record<string, string>, scripts: ('Latin' | 'Greek' | 'Han')[]) {
  const sets = cov.ocr.lite.within_script;
  return Object.keys(labels).map(level => ({
    label: labels[level],
    pts: scripts.map(sc => {
      const c = at(sets[sc][dim], level);
      return c && c.n >= 5 ? { series: sc, est: c.median, ci: c.ci, n: c.n, text: `${cer(c.median)} · ${c.n}` } : { series: sc, est: null, ci: null, n: 0, text: '' };
    }),
  })).filter(r => r.pts.some(p => p.est != null));
}

const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const providerLabels = (levels: string[]) => Object.fromEntries(levels.filter(l => l !== 'unknown').map(l => [l, PROVIDER_NAME[l] ?? l]));

// A two-way count table: rows are book labels, columns a second covariate.
function CrossTab({ caption, tab, rows, cols, colLabel }: { caption: string; tab: Tab; rows: string[]; cols: string[]; colLabel: Record<string, string> }) {
  return (
    <table className="w-full text-[11px] tabular-nums">
      <caption className="text-left text-xs text-primary font-semibold mb-1">{caption}</caption>
      <thead>
        <tr className="text-muted border-b border-light">
          <th className="py-0.5 pr-2 font-medium text-left">Book</th>
          {cols.map(c => <th key={c} className="py-0.5 px-1 font-medium text-right">{colLabel[c] ?? c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.filter(r => tab[r]).map(r => (
          <tr key={r} className="border-b border-light">
            <td className="py-0.5 pr-2 text-secondary">{MS_LABEL[r] ?? r}</td>
            {cols.map(c => <td key={c} className="py-0.5 px-1 text-right text-secondary">{tab[r]?.[c] ?? 0}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OddsRow({ t }: { t: Term }) {
  const s: Scale = { kind: 'log', min: 0.05, max: 10, ticks: [[0.1, '0.1'], [1, '1'], [10, '10']] };
  const spans = t.ci[0] < 1 && t.ci[1] > 1;
  return (
    <tr className="border-b border-light align-middle">
      <td className="py-0.5 pr-2 text-secondary">{t.term.replace(/ \(vs .*\)$/, '')}</td>
      <td className="py-0.5 pr-2 text-right text-muted">{t.n_at_level ?? '—'}</td>
      <td className="py-0.5 pr-2 text-right text-primary whitespace-nowrap">{t.odds_ratio.toFixed(2)} <span className="text-muted">({t.ci[0].toFixed(2)}–{t.ci[1].toFixed(2)})</span></td>
      <td className="py-0.5 w-[8rem]">
        <svg viewBox={`0 0 ${W} 8`} className="w-full h-auto" role="img" aria-label={`odds ratio ${t.odds_ratio}, 95% CI ${t.ci[0]}–${t.ci[1]}`}>
          <line x1={sx(s, 1)} x2={sx(s, 1)} y1={0} y2={8} stroke="var(--text-muted)" strokeWidth="0.6" />
          <line x1={sx(s, t.ci[0])} x2={sx(s, t.ci[1])} y1={4} y2={4} stroke={spans ? 'var(--text-muted)' : 'var(--accent-rust)'} strokeWidth="1.4" strokeLinecap="round" />
          <circle cx={sx(s, t.odds_ratio)} cy={4} r="2.2" fill={spans ? 'var(--text-muted)' : 'var(--accent-rust)'} />
        </svg>
      </td>
    </tr>
  );
}

const CHAIN = [
  { n: 1, name: 'Leaf', q: 'The image shown is the leaf transcribed', fail: 'wrong leaf' },
  { n: 2, name: 'Transcription', q: 'The text matches the image', fail: 'misread, garble, recitation' },
  { n: 3, name: 'Translation', q: 'The English matches the transcription', fail: 'omission, invention, inversion' },
];

export default function QualitySummaryPage() {
  const t = cov.translation, reg = cov.regression;
  const nonLatin = reg.terms.find(x => x.term.startsWith('non-Latin'))!;
  const others = reg.terms.filter(x => x !== nonLatin);
  const lowRes = at(t.by_resolution, '<1500 px');
  const lowResOr = reg.terms.find(x => x.term.startsWith('resolution <1500'));
  const gk = cov.ocr.lite.within_script.Greek, la = cov.ocr.lite.within_script.Latin, gkF = cov.ocr.flash.within_script.Greek;
  const g15 = at(gk.by_period, '1500s'), g17 = at(gk.by_period, '1700s'), g18 = at(gk.by_period, '1800s');
  const l16 = at(la.by_period, '1600s'), l18 = at(la.by_period, '1800s');
  const gMid = at(gk.by_resolution, '1500–2499 px'), gHi = at(gk.by_resolution, '≥2500 px');
  const hanLow = at(cov.ocr.lite.within_script.Han.by_resolution, '<1500 px');
  const f15 = at(gkF.by_period, '1500s'), f18 = at(gkF.by_period, '1800s');
  // #5623: manuscript, holding library, page content
  const descr = cov.descriptor, agr = descr.agreement_with_inline_tags, hands = descr.agreement_on_handwritten_or_mixed_tags;
  const msPrint = at(t.by_manuscript, 'print'), msMs = at(t.by_manuscript, 'manuscript');
  const msOr = reg.terms.find(x => x.term.startsWith('manuscript'));
  const nonLatinBase = cov.regression_without_manuscript.terms.find(x => x.term.startsWith('non-Latin'));
  const msNonLatin = t.cross.manuscript_by_script.manuscript?.['non-Latin'] ?? 0;
  const bph = at(t.by_provider, 'bph'), bphN = bph?.n ?? 0, bphLatin = bph?.latin?.n ?? 0;
  const harvardN = sum(t.cross.provider_by_manuscript.harvard), harvardMs = t.cross.provider_by_manuscript.harvard?.manuscript ?? 0;
  const bsbGk = at(gk.by_provider, 'bsb'), iaGk = at(gk.by_provider, 'internet_archive');
  const hanSet = cov.ocr.lite.within_script.Han, hanTable = at(hanSet.by_content, 'table'), hanPlain = at(hanSet.by_content, 'plain text');
  const ocrX = cov.ocr.lite.cross.manuscript_by_script, ocrMs = sum(ocrX.manuscript), ocrSl = sum(ocrX.print) + sum(ocrX.manuscript) + sum(ocrX.mixed);
  const tCovMs = cov.coverage.translation.ms_rule['OCR <script> tags, book majority'] ?? 0, tCovDesc = cov.coverage.translation.ms_rule['descriptor (this page only)'] ?? 0;
  // label_by_fallback[label][what the fallback rule says]
  const fb = cov.fallback_rule_check.label_by_fallback, fbMs = sum(fb.manuscript), fbMissed = fb.manuscript?.print ?? 0;

  return (
    <main className="bg-cream min-h-screen print:bg-white">
      <article className="max-w-5xl mx-auto px-4 py-10 print:py-0 print:px-0 text-[13px] print:text-[11px] leading-snug">
        {/* div, not <header>/<footer>: globals.css hides those in print, which dropped v1's title from the sheet */}
        <div className="border-b border-light pb-4 mb-5 print:pb-2 print:mb-3">
          <div className="text-xs uppercase tracking-[0.16em] text-muted font-semibold mb-2">
            Source Library · Page quality · summary of the working paper · data as of {byLanguage.generated}
          </div>
          <h1 className="text-2xl md:text-3xl text-primary font-serif leading-tight text-balance">Does this English say what is printed on this leaf?</h1>
          <p className="text-secondary mt-2 max-w-3xl text-sm print:text-[11px] leading-relaxed print:leading-snug">
            Source Library serves AI transcriptions and English translations of historical books in more than fifteen languages. A page is right for a reader only when three links hold. This summary gives how each link is measured, the results by language, and whether a book&rsquo;s date, the amount of text on a page or the scan&rsquo;s resolution explains the differences. All figures are observational, and no figure has yet been checked by a person who reads the source language.
          </p>
        </div>

        {/* ── the chain ── */}
        <section className="mb-5" aria-label="The three links">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CHAIN.map(c => (
              <div key={c.n} className="border-t-2 border-accent-rust pt-2">
                <div className="text-primary font-semibold">{c.n}. {c.name}</div>
                <div className="text-secondary">{c.q}</div>
                <div className="text-muted text-xs">Fails as: {c.fail}</div>
              </div>
            ))}
          </div>
          <MethodLinks links={[['The reader’s question (§1)', `${PAPER}#s1`], ['Measurement vocabulary (eval-design §2)', EVAL_DESIGN]]} />
        </section>

        {/* ── key findings ── */}
        <section aria-label="Key findings" className="mb-5">
          <ol className="grid gap-2 grid-cols-1 sm:grid-cols-5 list-none p-0 m-0">
            {KEY_FINDINGS.map(f => (
              <li key={f.figure} className="border border-light rounded bg-white/60 p-2.5 min-w-0 flex flex-col print:break-inside-avoid">
                <div className="text-xl text-primary font-serif tabular-nums">{f.figure}</div>
                <div className="text-xs text-secondary leading-snug flex-1">{f.text}</div>
                <Link href={`${PAPER}${f.href}`} className="text-[11px] text-accent-rust hover:underline mt-1 print:hidden">Method →</Link>
              </li>
            ))}
          </ol>
        </section>

        {/* ── methods in brief ── */}
        <section aria-labelledby="methods" className="mb-5 border border-light rounded bg-white/60 p-3 md:p-4 print:break-inside-avoid">
          <H2 id="methods" kicker="For the statistician">Methods in brief</H2>
          <dl className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-x-6 gap-y-2 print:gap-y-1 text-xs print:text-[10.5px] m-0">
            <div>
              <dt className="text-primary font-semibold">Unit</dt>
              <dd className="text-secondary m-0">One text page per book, drawn at random from the book&rsquo;s middle (15–95% of its pages) among machine-translated, unedited pages with at least 200 transcribed characters. Title pages, indexes, plates and blanks are excluded. A book counts once across audits (its earliest verdict), so n is books.</dd>
            </div>
            <div>
              <dt className="text-primary font-semibold">Sampling</dt>
              <dd className="text-secondary m-0">Translation: stratified by language with fixed book quotas (Latin 60 to Korean 6), books drawn uniformly at random among live translated books, seed 20260930. The 2026-09-30 audit (311 books) pooled with the September monthly draw: {byLanguage.translation_books} books. Transcription: sealed strata by script and period, one page per book, scored against published e-texts (Wikisource, First1KGreek, Kanripo, CBETA, EEBO-TCP).</dd>
            </div>
            <div>
              <dt className="text-primary font-semibold">Estimand and weights</dt>
              <dd className="text-secondary m-0">Headline: the share of live translated pages the judge rates 4 or 5 of 5, post-stratified by language (weights: live translated pages per language at the draw), 89.1% (85.3–92.5). Weighting by pages instead of books gives 89.3%. Language and covariate cells are unweighted sample shares.</dd>
            </div>
            <div>
              <dt className="text-primary font-semibold">Intervals and grades</dt>
              <dd className="text-secondary m-0">Wilson 95% for shares; percentile bootstrap (2,000 resamples, seeded) for medians and the weighted headline; Wald for odds ratios. Books behind a cell: under 30 exploratory, 30–49 directional, 50 or more decision-grade.</dd>
            </div>
            <div>
              <dt className="text-primary font-semibold">How reliable the judge is</dt>
              <dd className="text-secondary m-0">Claude Opus against Claude Sonnet on 107 pages: sound/defective κ 0.56 (0.32–0.76), AC1 0.85; on the 1–5 scale, quadratic-weighted κ 0.73 (0.60–0.83). Blinded controls in every audit: 15/15 swapped translations rated 2 or lower, 15/15 translations with the middle third removed flagged as omission (each 80–100%); 11/15 repeats given the identical rating. An audit whose controls fail is discarded.</dd>
            </div>
            <div>
              <dt className="text-primary font-semibold">Accuracy, agreement, judged</dt>
              <dd className="text-secondary m-0"><strong className="text-primary font-medium">Accuracy</strong> is error against a published text (the character error rates here). <strong className="text-primary font-medium">Agreement</strong> is two machine reads matching, which cannot see an error both share. <strong className="text-primary font-medium">Judged</strong> is a model&rsquo;s rating of fidelity: neither accuracy nor a reader&rsquo;s verdict. The human check that would calibrate the judge is preregistered and has not run.</dd>
            </div>
          </dl>
          <MethodLinks links={[['Translation (§4)', `${PAPER}#s4`], ['Transcription (§3)', `${PAPER}#s3`], ['Limitations (§7)', `${PAPER}#s7`], ['Audit design and results', AUDIT], ['Judge statistics', STATS], ['Preregistration', PREREG], ['Eval design', EVAL_DESIGN]]} />
        </section>

        {/* ── by language ── */}
        <section className="mb-5 print:mb-3" aria-labelledby="by-language">
          <H2 id="by-language" kicker="Results">Quality by language</H2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-light">
                  <th className="py-1 pr-2 font-medium">Language</th>
                  <th className="py-1 pr-2 font-medium text-right">Share of pages</th>
                  <th className="py-1 pr-2 font-medium">Character error (Flash-Lite) · books</th>
                  <th className="py-1 pr-2 font-medium">Rated faithful by the judge · books</th>
                  <th className="py-1 font-medium">What is missing</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {byLanguage.rows.map(r => {
                  const o = r.ocr.current, tr = r.translation;
                  return (
                    <tr key={r.language} className="border-b border-light align-top">
                      <td className="py-1 pr-2 text-primary font-medium">{r.language}</td>
                      <td className="py-1 pr-2 text-right text-secondary">{r.share_of_translated_pages}%</td>
                      <td className="py-1 pr-2 text-secondary">{o.median_cer == null ? <span className="text-muted">no reference</span> : <>{cer(o.median_cer)} <span className="text-muted">· {o.books_referenced}</span></>}</td>
                      <td className="py-1 pr-2">
                        <span className="flex items-center gap-1.5"><Bar p={tr.share} lo={tr.ci[0]} hi={tr.ci[1]} /><span className={tr.books < 30 ? 'text-muted' : 'text-secondary'}>{pct(tr.share)}</span><span className="text-muted">· {tr.books}</span></span>
                      </td>
                      <td className="py-1 text-muted leading-snug">{r.caveat?.text ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted mt-1.5 leading-snug">
            Character error: median against a published e-text, one page per book; Flash-Lite has read every new page since 11 September 2026. Faithful: share of one-page-per-book samples Claude Opus rated 4 or 5 of 5, with the 95% Wilson interval ({byLanguage.translation_books} books, pooled audits). Under 30 books a figure is exploratory (grey).
          </p>
          <MethodLinks links={[['The language grid', `${PAPER}#by-language`], ['What an error rate looks like', `${PAPER}#error-ladder`], ['Engines', `${PAPER}#engines`], ['Decisions', `${PAPER}#decisions`]]} />
        </section>

        {/* ── covariates ── */}
        <section className="mb-5 print:mb-3" aria-labelledby="covariates">
          <H2 id="covariates" kicker="Confounding">Do date, text density or scan size explain it?</H2>
          <p className="text-secondary text-sm print:text-[11px] leading-relaxed print:leading-snug mb-3 max-w-3xl">
            The languages differ in more than script. Their books differ in age, pages in how much text they carry, and scans in resolution. Each audited and benchmarked page was joined to all three. This analysis is exploratory and observational: nothing was randomised, and the audits over-sample non-Latin languages by design.
          </p>

          <ol className="list-none p-0 m-0 mb-4 grid gap-2 grid-cols-1 md:grid-cols-3 print:grid-cols-3">
            <li className="border-l-2 border-accent-rust pl-2.5">
              <div className="text-primary font-semibold text-xs">Script, not date, density or scan size, carries the translation gap.</div>
              <div className="text-xs text-secondary">Adjusted odds of a faithful rating for non-Latin scripts: {nonLatin.odds_ratio.toFixed(2)} ({nonLatin.ci[0].toFixed(2)}–{nonLatin.ci[1].toFixed(2)}), n = {reg.n}. {others.every(x => x.ci[0] < 1 && x.ci[1] > 1) ? <>Every other term&rsquo;s interval spans 1, the new manuscript term included.</> : <>Other terms whose interval excludes 1: {others.filter(x => !(x.ci[0] < 1 && x.ci[1] > 1)).map(x => x.term.replace(/ \(vs .*\)$/, '')).join(', ')}.</>} The low-resolution dip ({lowRes && pct(lowRes.rate ?? 0)}, n = {lowRes?.n}) is mostly non-Latin pages ({lowRes?.non_latin} of {lowRes?.n}){lowResOr && <>; adjusted odds ratio {lowResOr.odds_ratio.toFixed(2)} ({lowResOr.ci[0].toFixed(2)}–{lowResOr.ci[1].toFixed(2)})</>}.</div>
            </li>
            <li className="border-l-2 border-accent-rust pl-2.5">
              <div className="text-primary font-semibold text-xs">Within a script, transcription error falls with the book&rsquo;s date.</div>
              <div className="text-xs text-secondary">Greek on Flash-Lite: {cer(g15?.median ?? null)} for 1500s books (n = {g15?.n}), {cer(g17?.median ?? null)} for the 1700s (n = {g17?.n}), {cer(g18?.median ?? null)} for the 1800s (n = {g18?.n}). Latin script: {cer(l16?.median ?? null)} in the 1600s (n = {l16?.n}), {cer(l18?.median ?? null)} in the 1800s (n = {l18?.n}). Flash shows the same slope ({cer(f15?.median ?? null)} to {cer(f18?.median ?? null)} in Greek). The 1800s pages lean on clean reference editions, so part of this is selection.</div>
            </li>
            <li className="border-l-2 border-accent-rust pl-2.5">
              <div className="text-primary font-semibold text-xs">Above 1,500 px, bigger scans do not read better.</div>
              <div className="text-xs text-secondary">Greek: {cer(gMid?.median ?? null)} at 1,500–2,499 px (n = {gMid?.n}), {cer(gHi?.median ?? null)} at 2,500 px or more (n = {gHi?.n}); the large scans are mostly hard 1500s prints. Below 1,500 px is almost all Chinese ({hanLow?.n} pages), so resolution there cannot be separated from script.</div>
            </li>
          </ol>

          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm text-primary font-semibold m-0">Translation: share rated faithful by the judge (4 or 5 of 5), by script</h3>
            <Legend series={T_SERIES} />
          </div>
          <div className="grid gap-x-5 gap-y-3 grid-cols-1 md:grid-cols-3 print:grid-cols-3 mb-4">
            <Panel title="By the book’s date" rows={rateRows(t.by_period, PERIOD_LABEL)} series={T_SERIES} scale={RATE_SCALE} />
            <Panel title="By characters on the page (thirds)" rows={rateRows(t.by_chars, CHAR_LABEL)} series={T_SERIES} scale={RATE_SCALE} />
            <Panel title="By scan long edge (px)" rows={rateRows(t.by_resolution, RES_LABEL)} series={T_SERIES} scale={RATE_SCALE} note={<>{t.n} books. Count shown is rated faithful / books.</>} />
          </div>

          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm text-primary font-semibold m-0">Transcription: median character error, Flash-Lite, against a published text (log scale)</h3>
            <Legend series={O_SERIES} />
          </div>
          <div className="grid gap-x-5 gap-y-3 grid-cols-1 md:grid-cols-3 print:grid-cols-3 mb-2">
            <Panel title="By the book’s date" rows={cerRows('by_period', PERIOD_LABEL, ['Latin', 'Greek'])} series={O_SERIES.slice(0, 2)} scale={CER_SCALE} note={<>Chinese is left out: {at(cov.ocr.lite.within_script.Han.by_period, 'unknown')?.n} of its {cov.ocr.lite.within_script.Han.n} pages carry no catalogue date.</>} />
            <Panel title="By characters on the page (thirds within script)" rows={cerRows('by_chars', CHAR_LABEL, ['Latin', 'Greek', 'Han'])} series={O_SERIES} scale={CER_SCALE} note={<>Thirds cut at {la.char_cuts.join(' / ')} (Latin), {gk.char_cuts.join(' / ')} (Greek), {cov.ocr.lite.within_script.Han.char_cuts.join(' / ')} (Chinese) characters.</>} />
            <Panel title="By scan long edge (px)" rows={cerRows('by_resolution', RES_LABEL, ['Latin', 'Greek', 'Han'])} series={O_SERIES} scale={CER_SCALE} note={<>&ldquo;External scan&rdquo;: reference pages from Wikisource or pinned editions, not Source Library images. Cells under five pages are omitted.</>} />
          </div>

          <div className="mt-4 grid gap-4 grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] print:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
            <div className="min-w-0">
              <h3 className="text-sm text-primary font-semibold mb-1">One model: odds of a faithful rating</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-left text-muted border-b border-light">
                      <th className="py-0.5 pr-2 font-medium">Term (reference level)</th>
                      <th className="py-0.5 pr-2 font-medium text-right">n</th>
                      <th className="py-0.5 pr-2 font-medium text-right">OR (95% CI)</th>
                      <th className="py-0.5 font-medium"><span className="sr-only">Plot</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <OddsRow t={nonLatin} />
                    {others.map(x => <OddsRow key={x.term} t={x} />)}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="text-[11px] text-muted leading-snug">
              <p className="m-0 mb-1.5">Logistic regression, fitted by IRLS, Wald 95% intervals, unweighted, one page per book: judge ≥ 4 on script class, manuscript, period, log₂ characters (per doubling) and resolution band. References: Latin script, print, 1600s, 1,500–2,499 px. The manuscript term is new (<a href="#manuscript-library-content" className="text-accent-rust hover:underline">below</a>); without it the script odds ratio is {nonLatinBase?.odds_ratio.toFixed(2)}. Unknown date and resolution are kept as levels. n = {reg.n}, {reg.events} rated faithful. Exploratory and observational; language within script is not modelled.</p>
              <p className="m-0">Period is parsed from the catalogue&rsquo;s free-text date only when it pins one century; a reprint carries its work&rsquo;s date. Characters are the served transcription without its tags. Resolution is the stored master scan, not the reader&rsquo;s display copy, which is capped at 2,000 px wide.</p>
            </div>
          </div>
          <MethodLinks links={[['Experiment log', COV_LOG], ['Script', COV_SCRIPT], ['Transcription (§3)', `${PAPER}#s3`], ['Translation (§4)', `${PAPER}#s4`]]} />

          {/* ── manuscript, holding library, page content (#5623) ── */}
          <h3 id="manuscript-library-content" className="text-base text-primary font-serif leading-tight mt-6 mb-2">Is it really manuscript against print, or the library that holds the book?</h3>
          <p className="text-secondary text-sm print:text-[11px] leading-relaxed print:leading-snug mb-3 max-w-3xl">
            Three more properties were joined to the same pages: whether the book is a manuscript, which library holds the scan, and what is on the page besides running text. Where a transcription carried no tag saying so, one image-only model call per page supplied it ({descr.described - agr.pages - hands.pages} pages, plus {agr.pages + hands.pages} already-tagged pages as a check; ${descr.usd.toFixed(2)} in all). Format (folio, quarto, octavo) was left out: {cov.format.reason}.
          </p>
          <ol className="list-none p-0 m-0 mb-4 grid gap-2 grid-cols-1 md:grid-cols-3 print:grid-cols-3">
            <li className="border-l-2 border-accent-rust pl-2.5">
              <div className="text-primary font-semibold text-xs">Manuscripts score lower, mostly because most are in other scripts.</div>
              <div className="text-xs text-secondary">Rated faithful: {msPrint && pct(msPrint.rate ?? 0)} of printed books (n = {msPrint?.n}), {msMs && pct(msMs.rate ?? 0)} of manuscripts (n = {msMs?.n}). {msNonLatin} of the {msMs?.n} manuscripts are in non-Latin scripts. Within non-Latin scripts the gap narrows to {msMs?.nonlatin && pct(msMs.nonlatin.rate)} against {msPrint?.nonlatin && pct(msPrint.nonlatin.rate)}. Adjusted for script, date, density and resolution, manuscript odds ratio {msOr && <>{msOr.odds_ratio.toFixed(2)} ({msOr.ci[0].toFixed(2)}–{msOr.ci[1].toFixed(2)})</>}; the script term moves from {nonLatinBase?.odds_ratio.toFixed(2)} to {nonLatin.odds_ratio.toFixed(2)}. Manuscript and script cannot be fully separated in a sample this size.</div>
            </li>
            <li className="border-l-2 border-accent-rust pl-2.5">
              <div className="text-primary font-semibold text-xs">The holding library mostly stands in for script and manuscript.</div>
              <div className="text-xs text-secondary">Each library&rsquo;s books lean to one kind: the Ritman Library&rsquo;s are {bphLatin} Latin-script of {bphN}; Harvard&rsquo;s {harvardMs} of {harvardN} are manuscripts. Within one script, libraries differ little. In the Greek transcription benchmark, BSB Munich scans read at {cer(bsbGk?.median ?? null)} (n = {bsbGk?.n}) and Internet Archive scans at {cer(iaGk?.median ?? null)} (n = {iaGk?.n}).</div>
            </li>
            <li className="border-l-2 border-accent-rust pl-2.5">
              <div className="text-primary font-semibold text-xs">The transcription benchmark is almost all print.</div>
              <div className="text-xs text-secondary">{ocrMs} of {ocrSl} benchmark pages with a Source Library scan are manuscripts, so character error says nothing yet about reading hands. Page content does show there: Chinese pages laid out as tables read at {cer(hanTable?.median ?? null)} (n = {hanTable?.n}) against {cer(hanPlain?.median ?? null)} for plain text (n = {hanPlain?.n}).</div>
            </li>
          </ol>

          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm text-primary font-semibold m-0">Translation: share rated faithful by the judge (4 or 5 of 5), by script</h3>
            <Legend series={T_SERIES} />
          </div>
          <div className="grid gap-x-5 gap-y-3 grid-cols-1 md:grid-cols-3 print:grid-cols-3 mb-4">
            <Panel title="Manuscript or print (book)" rows={rateRows(t.by_manuscript, MS_LABEL)} series={T_SERIES} scale={RATE_SCALE} note={<>A book&rsquo;s label is the majority of its pages&rsquo; tags. Mixed books are counted with print in the model ({reg.mixed_counted_as_print}).</>} />
            <Panel title="Holding library" rows={rateRows(t.by_provider, providerLabels(t.by_provider.map(c => c.level)))} series={T_SERIES} scale={RATE_SCALE} note={<>Libraries with fewer than 15 sampled books are &ldquo;other&rdquo;.</>} />
            <Panel title="What is on the page" rows={rateRows(t.by_content, CONTENT_LABEL)} series={T_SERIES} scale={RATE_SCALE} note={<>One class per page, the first that applies: illustration, table, marginalia. The audits exclude plates, so illustration means an inline picture.</>} />
          </div>

          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm text-primary font-semibold m-0">Transcription: median character error, Flash-Lite, against a published text (log scale)</h3>
            <Legend series={O_SERIES} />
          </div>
          <div className="grid gap-x-5 gap-y-3 grid-cols-1 md:grid-cols-3 print:grid-cols-3 mb-2">
            <Panel title="Holding library" rows={cerRows('by_provider', providerLabels(Object.keys(PROVIDER_NAME)), ['Latin', 'Greek', 'Han'])} series={O_SERIES} scale={CER_SCALE} note={<>Reference pages from Wikisource or pinned editions have no Source Library scan and are left out. Cells under five pages are omitted.</>} />
            <Panel title="What is on the page" rows={cerRows('by_content', CONTENT_LABEL, ['Latin', 'Greek', 'Han'])} series={O_SERIES} scale={CER_SCALE} />
            <div className="min-w-0 grid gap-3">
              <CrossTab caption="Translation sample: manuscript by script" tab={t.cross.manuscript_by_script} rows={['print', 'manuscript', 'mixed']} cols={['Latin', 'non-Latin']} colLabel={{ 'non-Latin': 'other scripts' }} />
              <CrossTab caption="…and by the book’s date" tab={t.cross.manuscript_by_period} rows={['print', 'manuscript', 'mixed']} cols={['pre-1500', '1500s', '1600s', '1700s', '1800s', '1900+', 'unknown']} colLabel={{ 'pre-1500': '<1500', '1500s': '1500s', '1600s': '1600s', '1700s': '1700s', '1800s': '1800s', '1900+': '1900+', unknown: '?' }} />
            </div>
          </div>
          <p className="text-[11px] text-muted leading-snug mt-1.5 max-w-3xl">
            Where the labels come from. Manuscript: the <code>&lt;script&gt;</code> tag (printed, handwritten, mixed) the transcription model writes on each page, counted over every page of the book; {tCovMs} of {cov.coverage.translation.n} audited books were decided this way and {tCovDesc} by the image-only call on the sampled page. The older rule (held by a manuscript library, or dated before 1500) agrees with those labels on {cov.fallback_rule_check.agree} of {cov.fallback_rule_check.n} books and misses {fbMissed} of {fbMs} manuscripts, so it is used only where neither exists. Against the model&rsquo;s own tags on {agr.pages} tagged pages, the image-only call agreed on manuscript or print {agr.script.agree}/{agr.script.n}, page type {agr.page_type.agree}/{agr.page_type.n} ({agr.page_type_partial.agree}/{agr.page_type_partial.n} on older pages), marginalia {agr.has_marginalia.agree}/{agr.has_marginalia.n}. On the {hands.pages} sampled pages the transcription model tagged handwritten or mixed, the two agreed on only {hands.script.agree}: every disagreement was a Chinese, Japanese, Korean or Tibetan page the image-only call read as printed, where a woodblock print and a manuscript are hard to tell apart from a picture, and either model may be wrong. Treat the manuscript label for East Asian books as uncertain. Holding library: the catalogue&rsquo;s image source.
          </p>
          <MethodLinks links={[['Experiment log', COV2_LOG], ['Script', COV_SCRIPT], ['Page descriptor prompt', DESCRIPTOR], ['Descriptor answers', DESCRIPTOR_DATA], ['Fallback rule', MS_RULE]]} />
        </section>

        {/* ── limits and next ── */}
        <section className="grid gap-5 sm:grid-cols-2 mb-5">
          <div>
            <h2 className="text-lg text-primary font-serif mb-1.5">What we cannot say yet</h2>
            <ul className="list-disc pl-4 space-y-1 text-secondary">
              <li><strong className="text-primary">The judge&rsquo;s own error rate.</strong> Every check is a model, or a model reading an image. Two models agreeing (κ 0.56) is not two readers agreeing.</li>
              <li><strong className="text-primary">How often the leaf is wrong.</strong> Two in twenty audited pages showed the wrong leaf; the true rate could be 3% or 30%.</li>
              <li><strong className="text-primary">Accuracy in most scripts.</strong> Without a published text, two reads measure agreement, and two models can share a mistake.</li>
              <li><strong className="text-primary">Memorised texts.</strong> A model that knows a famous work can reproduce it without reading the page.</li>
            </ul>
            <MethodLinks links={[['What none of this measures (§5)', `${PAPER}#s5`], ['Limitations (§7)', `${PAPER}#s7`]]} />
          </div>
          <div>
            <h2 className="text-lg text-primary font-serif mb-1.5">Next: readers of the original</h2>
            <ul className="list-disc pl-4 space-y-1 text-secondary">
              <li>Volunteers who read a language get one page at a time and answer one question: <em>does the English say what this page says?</em></li>
              <li>Pages alternate between those the judge called sound and defective, so both groups fill.</li>
              <li>One answered page in five goes to a second reader, to measure how often two readers agree: the ceiling for any judge.</li>
              <li>Preregistered, with its analysis plan; awaiting ethics approval. No page has been sent.</li>
            </ul>
            <MethodLinks links={[['The reader panel (§6)', `${PAPER}#s6`], ['Preregistration', PREREG]]} />
          </div>
        </section>

        <div className="border-t border-light pt-3 text-xs text-muted flex flex-wrap gap-x-5 gap-y-1">
          <span>Full working paper, methods and sources: <Link href={PAPER} className="text-accent-rust hover:underline">sourcelibrary.org/research/quality</Link></span>
          <span>Data: src/data/quality-by-language.json, src/data/quality-covariates.json ({cov.generated})</span>
          <span>Code: scripts/eval in the public repository (AGPL)</span>
          <span>team@sourcelibrary.org</span>
        </div>
      </article>
    </main>
  );
}
