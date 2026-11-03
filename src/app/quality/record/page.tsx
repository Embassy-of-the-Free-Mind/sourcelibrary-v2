import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import byLanguage from '@/data/quality-by-language.json';
import ocrEvidence from '@/data/ocr-benchmark-evidence.json';
import feedback from '@/data/quality-feedback-themes.json';
import ocrRouting from '../../../../scripts/lib/ocr-routing-table.json';
import servedDraw from '../../../../scripts/eval/confidence-7866/results/score.json';
import servedGrades from '../../../../scripts/eval/confidence-7866/results/served-grades.json';
import { EXPERIMENTS } from '@/lib/experiments-index';
import { listExperiments, latestCanonStatus, sampleAudit, typedPages, type DropReason, type Of } from '@/lib/quality-center';
import { AS_OF as OPEN_WORK_AS_OF, GROUPS } from '../../research/quality/open/issues';
import { GRADES, LEARNED, LEAF, leafHref, MONTH_NOTE, PROSE_AS_OF, WAYS, WORKED_FIX } from '../content';
import ParetoCharts, { RosterLine, TRANSLATION } from '../ParetoCharts';

// The Quality Center (#5918): where text quality stands, what we are doing about it, and how
// people take part. Every number and list is read at build time from files committed on main
// (see the source line under each part); the prose carries PROSE_AS_OF, and
// scripts/audit/quality-center-freshness.mjs flags it when the experiments move on without it.
// No request-time fetch, so nothing can fail at runtime and freeze a fallback; the page changes
// when a deploy rebuilds it.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Quality Center: the full record | Source Library',
  description:
    'How good the transcriptions and translations in Source Library are: what a check of live books against the page images found, grade by grade and language by language, which kinds of error account for it, how far the reviewer can be trusted, what we have learned, what readers have reported, and how to take part.',
  alternates: { canonical: '/quality/record' },
};

const GH = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/';
const BLOB = `${GH}blob/main/`;
const ISSUE = `${GH}issues/`;

const n = (v: number) => v.toLocaleString('en-US');
const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
/** A share that rounds to 0% but is not zero reads as "under 1%", not "0%". */
const share = (part: number, whole: number) => (part > 0 && part / whole < 0.005 ? 'under 1%' : pct(part / whole));
const longDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ── data, shaped once ── */

type LangRow = (typeof byLanguage.rows)[number];
/** Transcription error three ways (#5939): raw, after the OCR prompt's own conventions, and the kinds. */
type ThreeWays = {
  pages: number;
  median_cer_raw: number;
  median_cer_prompt: number;
  kinds: { long_s_as_f: number; refusals: number; modernised: number; reference_wrong: number; other: number } | null;
};
const threeWaysOf = (row: LangRow | null) => ((row?.ocr ?? null) as { three_ways?: ThreeWays } | null)?.three_ways ?? null;
const twMeta = (byLanguage as { ocr_three_ways?: { hand_check?: { file: string; examples: number; reference_wrong: number } | null } }).ocr_three_ways;
const twSource = (byLanguage.sources as { ocr_three_ways?: string }).ocr_three_ways;
const TW_KINDS: [keyof NonNullable<ThreeWays['kinds']>, string][] = [
  ['long_s_as_f', 'long s read as f'],
  ['refusals', 'refused'],
  ['modernised', 'spelling modernised'],
  ['reference_wrong', 'published text wrong'],
  ['other', 'other'],
];
type Fidelity = {
  kind: string;
  language: string;
  n: number;
  fidelity_mean?: number;
  share_ge4?: number;
  issue?: number;
  run_id?: string;
};

const served = (ocrEvidence.translation_fidelity as Fidelity[]).filter(f => f.kind === 'served');
const fidelityRun = served[0]?.run_id ?? null;
const fidelityIssue = served[0]?.issue ?? null;
const fidelityOf = (lang: string) => served.find(f => f.language === lang) ?? null;

const languages: { language: string; row: LangRow | null; fid: Fidelity | null }[] = [
  ...byLanguage.rows.map(row => ({ language: row.language, row, fid: fidelityOf(row.language) })),
  ...served.filter(f => !byLanguage.rows.some(r => r.language === f.language)).map(f => ({ language: f.language, row: null, fid: f })),
];

const noReaders = byLanguage.rows.every(r => (r.readers?.answers ?? 0) === 0);
const noOcrReference = byLanguage.rows.filter(r => r.ocr?.current?.median_cer == null).map(r => r.language);
const lowFidelity = served.filter(f => (f.share_ge4 ?? 1) < 0.5).sort((a, b) => (a.share_ge4 ?? 0) - (b.share_ge4 ?? 0));
const caveats = byLanguage.rows.filter(r => r.caveat && !/No OCR reference yet/.test(r.caveat.text));

const allIssues = GROUPS.flatMap(g => g.issues);
const defects = allIssues.filter(i => i.status === 'defect');
const running = allIssues.filter(i => i.status === 'running');
const planned = allIssues.filter(i => i.status === 'planned');

const experiments = listExperiments();
const STATUS_LABEL = {
  adopted: 'in use',
  rejected: 'not adopted',
  undecided: 'decision pending',
  informational: 'measurement',
  superseded: 'replaced',
} as const;
const SHOWN = 12;

const canon = latestCanonStatus();

/* The served figure (#7263 V7): the #7866 draw of live books, read against the page images, weighted back to the
   library. Read from its committed score.json, so a new month's draw moves the headline when that file moves. */
const SERVED_RECORD = 'scripts/eval/experiments/2026-10-31-confidence-validation-7866.md';
const SERVED_GRADES = 'scripts/eval/confidence-7866/results/served-grades.json';
const servedFrame = Object.values(servedDraw.corpus.frame_books).reduce((a, b) => a + b, 0);
const servedUsable = 1 - servedDraw.corpus.bad_share;
const servedDate = servedDraw.generated_at.slice(0, 10);
const servedWeakBooks = Math.round(servedDraw.corpus.bad_books_est / 100) * 100;
/** "8/8 rejected at fidelity <= 2" → "8 of 8". */
const kOfN = (v: string) => v.match(/^(\d+)\/(\d+)/)?.slice(1).join(' of ') ?? v;

/* The grade ladder (#7933): the SAME 800 verdicts as the record above, re-graded on the rubric's four grades
   (.claude/docs/quality-rubric-and-sampling.md §5) and cut by language, writing system and reading method, by
   scripts/eval/confidence-7866/regrade.mjs. A distribution, not one pass/fail share at an unstated bar. */
const grades = servedGrades as typeof servedGrades & {
  grade_label: Record<string, string>;
  grades: Record<string, { pages: number; share: number; ci95: [number, number] }>;
};
/** The reader-facing order, worst last, each row saying what a reader can do with such a page. */
const LADDER: { key: string; can: string }[] = [
  { key: 'fit_to_quote', can: 'Quote it without opening the scan' },
  { key: 'fit_to_read', can: 'Read it; check the scan before quoting' },
  { key: 'search_only', can: 'Find the page by it, but do not trust the reading' },
  { key: 'wrong_span', can: 'Do not rely on it: a word or number is not the page’s' },
  { key: 'from_elsewhere', can: 'Do not rely on it: part is from somewhere else' },
  { key: 'mostly_wrong', can: 'Do not rely on it: most of the page is wrong or missing' },
  { key: 'not_this_page', can: 'Do not rely on it: it is another page’s text' },
];
/** Plain names for the reading methods the draw happened to catch; a route not here shows its own id. */
const READER_NAME: Record<string, string> = {
  lite: 'Gemini Flash-Lite', '3flash': 'Gemini 3 Flash', paddle: 'PaddleOCR-VL', yigdzin: 'Yig-dzin (Tibetan)',
  'yigdzin>agy-flash-low': 'Yig-dzin, then Gemini Flash', 'lite>agy-flash-low': 'Flash-Lite, then Gemini Flash',
  'pero>agy-flash-low': 'PERO, then Gemini Flash', 'lighton-written': 'LightOnOCR (our GPU)',
  'import:ia_djvu': 'the Internet Archive’s own OCR', 'import:corpus': 'a typed edition',
  'pipeline:derge-tengyur-import-5497': 'a typed edition (Esukhia)', 'model:claude-opus-5-5': 'Claude Opus',
  'model:gemini-2.5-flash': 'Gemini 2.5 Flash', 'model:none': 'no engine recorded',
};
/** Languages with at least three books in the draw: fewer is one or two books, not a language. */
const gradeLanguages = grades.by_language.filter(r => r.books >= 3);
/** "One error every N units", rounded to two significant figures: the per-1,000 rate a reader can picture. */
const everyN = (per1k: number | null) => {
  if (!per1k) return null;
  const v = 1000 / per1k, mag = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
  return n(Math.round(v / mag) * mag);
};
/** Meaning-changing errors on an average page of this language: why few pages are spotless even at a low rate. */
const perPage = (r: { severe_per_1k: number | null; words: number; pages: number }) =>
  r.severe_per_1k == null ? null : ((r.severe_per_1k * r.words) / r.pages / 1000).toFixed(1);
type Cut = { books: number; pages: number; says_what_the_page_says: number; severe_per_1k: number | null };
const unitOfLanguage = (lang: string) => grades.by_language.find(r => r.language === lang)?.unit ?? 'words';
/**
 * Engines compared only WITHIN a language (#7933): the engine-only cut is confounded, because each engine was
 * given different languages. Cells with fewer than three books are left out; languages in the order of the table
 * above, then best engine first.
 */
const engineRows = (() => {
  const order = grades.by_language.map(r => r.language);
  return Object.entries(grades.by_language_route as Record<string, Cut>)
    .map(([k, v]) => { const [language, route] = k.split(' · '); return { language, route, ...v }; })
    .filter(r => r.books >= 3)
    .sort((a, b) => order.indexOf(a.language) - order.indexOf(b.language) || (a.severe_per_1k ?? 0) - (b.severe_per_1k ?? 0));
})();
/** The book's age and hand, alphabetic scripts only (one unit: words). */
const ERA_ORDER = ['manuscript', 'before 1501', '1501–1700', '1701–1900', 'after 1900', 'no date'];
const ERA_LABEL: Record<string, string> = {
  manuscript: 'Manuscripts', 'before 1501': 'Printed before 1501', '1501–1700': 'Printed 1501–1700',
  '1701–1900': 'Printed 1701–1900', 'after 1900': 'Printed after 1900', 'no date': 'Printed, date not recorded',
};
const eraRows = ERA_ORDER.map(k => ({ key: k, ...(grades.by_era_alphabetic as Record<string, Cut>)[k] })).filter(r => r.books);
const eraRoute = (era: string, route: string) =>
  (grades.by_era_route_alphabetic as Record<string, Cut>)[`${era} · ${route}`];

/** Invented or recited text, another leaf, another page entirely, or a page never read: the failures readers fear most. */
const notFromThisPage = grades.grades.from_elsewhere.share + grades.grades.not_this_page.share;
const topClasses = grades.defect_classes.filter(c => c.total >= 25);
/**
 * Three worked examples from served-grades.json: a misread that changes a name, a dropped unit, and
 * a heading turned to nonsense. Each was checked against its page image by eye on 2026-11-02 (#7933)
 * — that is why these three and not others. Keyed by class and the opening of the reviewer's own
 * quote, so a regeneration falls back to that class's first example rather than dropping the block.
 */
const EXAMPLE_PICKS: [string, string][] = [
  ['O6', '故吉觀順'],
  ['O7', 'two hundred .'],
  ['O1', 'ACen Wad'],
];
const examples = EXAMPLE_PICKS
  .map(([k, prefix]) => {
    const c = grades.defect_classes.find(x => x.class === k);
    const e = c?.examples.find(x => x.quote.startsWith(prefix))
      ?? c?.examples.find(x => x.severity === 'wrong_text') ?? c?.examples[0];
    return e && c ? { ...e, name: c.name } : null;
  })
  .filter((e): e is NonNullable<typeof e> => e != null);
const englishTop = byLanguage.rows.filter(r => ['Latin', 'English', 'German'].includes(r.language) && r.translation);
const englishTopRange = `${(Math.min(...englishTop.map(r => r.translation!.share)) * 100).toFixed(0)}–${pct(Math.max(...englishTop.map(r => r.translation!.share)))}`;

/* Who reads which page (#6688): the rows of scripts/lib/ocr-routing-table.json, the one source the
   routing code exports and the routing README is generated from. Nothing about a row is typed here. */
type RoutingEvidence = { file?: string; issue?: number; pr?: number; n: string; date: string };
const ROUTING_STATUS: Record<string, string> = { settled: 'settled', provisional: 'decided on a small sample', open: 'not settled' };
const ocrExperimentCount = EXPERIMENTS.filter(e => e.stage === 'ocr').length;
const evidenceHref = (e: RoutingEvidence) => (e.file ? `${BLOB}scripts/eval/experiments/${e.file}` : `${ISSUE}${e.issue}`);
/* Checked against the page image (#6740): `page_check` in the same file, one row per route the judge read.
   A route not in use is also listed under its kind's row in the table above, in the reader column. */
const pageCheck = ocrRouting.page_check;
const NOT_IN_USE = /^Measured, not in use/;
const notInUseFor = (rowId: string) =>
  pageCheck.kinds.filter(k => k.row === rowId).flatMap(k => k.routes.filter(r => NOT_IN_USE.test(r.in_use)));
/** "#6544" in a sentence becomes a link to the issue. */
const withIssueLinks = (text: string) =>
  text.split(/(#\d+)/).map((part, i) => (/^#\d+$/.test(part) ? <IssueLink key={i} num={Number(part.slice(1))} /> : part));

const audit = sampleAudit();
const of = (v: Of) => `${v.n} of ${v.of}`;
const DROP_REASON: Record<DropReason, string> = {
  judges: 'the judges themselves said the published translation does not fit the page',
  'by-eye': 'read by eye, the reference does not match the page',
  language: 'the page is mostly in another language or script',
  cer: 'on a printed page, no engine came within 35% character error of the reference',
};
const reasonList = (family: 'translation' | 'ocr') =>
  audit.dropped.reasons.filter(r => r.family === family).map(r => `${DROP_REASON[r.reason]} (${r.n})`).join('; ');
const cov = audit.coverage;

type Theme = (typeof feedback.themes)[number];

/* ── small pieces ── */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-14 scroll-mt-24">
      <h2 className="text-2xl md:text-3xl font-serif text-stone-900 mb-4 border-t border-stone-300 pt-5 text-balance">{title}</h2>
      {children}
    </section>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="font-serif text-xl text-stone-900 mt-8 mb-3">{children}</h3>;
}

function Source({ children }: { children: ReactNode }) {
  return <p className="text-xs text-stone-500 leading-relaxed mt-3">{children}</p>;
}

function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = LINK;
  return href.startsWith('/') ? <Link href={href} className={cls}>{children}</Link> : <a href={href} className={cls}>{children}</a>;
}

function IssueLink({ num }: { num: number }) {
  return <a href={`${ISSUE}${num}`} className="font-mono text-sm text-amber-800 hover:underline underline-offset-2 whitespace-nowrap">#{num}</a>;
}

function Status({ status }: { status: string }) {
  return <span className="whitespace-nowrap text-xs uppercase tracking-wider text-stone-500">{status}</span>;
}

type Box = { x: number; y: number; w: number; h: number };

/** A region of the leaf, cut from the same image by CSS (no second file to drift from it). */
function Crop({ box, alt, className = '' }: { box: Box; alt: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-[#e9dcc4] ${className}`} style={{ aspectRatio: `${box.w} / ${box.h}` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LEAF.image}
        alt={alt}
        loading="lazy"
        className="absolute max-w-none"
        style={{
          width: `${(LEAF.width / box.w) * 100}%`,
          left: `${(-box.x / box.w) * 100}%`,
          top: `${(-box.y / box.h) * 100}%`,
        }}
      />
    </div>
  );
}

/** Figure frame from /research/canon-gap's diagrams, without the number. */
function Figure({ title, caption, children }: { title: string; caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="my-8 rounded-sm border border-stone-200 bg-white px-4 py-6 md:px-8 md:py-8 max-w-3xl">
      <div className="font-serif text-xl text-stone-900 mb-5">{title}</div>
      {children}
      <figcaption className="text-sm text-stone-500 mt-5 pt-4 border-t border-stone-100 leading-snug">{caption}</figcaption>
    </figure>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="md:grid md:grid-cols-[9rem_1fr] md:gap-x-5 py-2">
      <div className="text-xs uppercase tracking-wider text-stone-400 mb-1 md:mb-0 md:pt-1">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const PARTS: [string, string][] = [
  ['stands', 'Where quality stands'],
  ['learned', 'What we have learned'],
  ['experiments', 'Experiments'],
  ['readers', 'What readers have told us'],
  ['take-part', 'Take part'],
];

/** The entry: the leaf, two sentences, and the way in to each part. */
function Entry() {
  return (
    <div className="bg-cream">
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pt-10 md:pt-14 grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-12 md:items-end">
        <figure>
          <a href={leafHref} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LEAF.image}
              alt={LEAF.alt}
              width={LEAF.width}
              height={LEAF.height}
              fetchPriority="high"
              className="w-full h-auto border border-stone-200"
            />
          </a>
          <figcaption className="text-sm text-stone-500 mt-3 leading-snug">
            <span className="italic">{LEAF.title}</span>, {LEAF.date}, <A href={leafHref}>page {LEAF.page}</A>. An early
            reader&rsquo;s notes in the margin and at the foot.
          </figcaption>
        </figure>
        <div className="md:pb-10">
          <p className="text-sm mb-3"><A href="/quality">&larr; Quality Center</A></p>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight text-stone-900 mb-5">The full record</h1>
          <p className="font-body text-lg text-stone-700 leading-relaxed mb-6">
            Every measurement behind the <A href="/quality">Quality Center</A>: the check of live books in full, which
            engine reads which kind of page and why, every experiment, and what readers have reported. Written for people
            who want to audit the figures.
          </p>
          <nav aria-label="On this page">
            <ul className="space-y-1.5">
              {PARTS.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="text-amber-800 hover:underline underline-offset-2">{label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <p className="text-xs text-stone-500 mt-6">
            Text as of {longDate(PROSE_AS_OF)}. Figures and lists are read from the library&rsquo;s data files each time the
            site is built.
          </p>
        </div>
      </div>
    </div>
  );
}

const LINK = 'text-amber-800 hover:underline underline-offset-2';
const th = 'text-left font-semibold text-stone-500 text-xs uppercase tracking-wider px-3 py-2 border-b border-stone-300 align-bottom';
const td = 'px-3 py-2 border-b border-stone-200 align-top tabular-nums';

/* ── page ── */

export default function QualityCenterPage() {
  return (
    <ContentPageLayout
      header={
        <>
          <SiteHeader variant="light" />
          <Entry />
        </>
      }
      bg="bg-cream"
    >
      <article className="max-w-4xl font-body text-stone-700">
        {/* ── 1. Where quality stands ── */}
        <Section id="stands" title="Where quality stands">
          <div className="max-w-3xl mb-6">
            <p className="font-serif text-3xl md:text-4xl text-stone-900 leading-tight mb-3">
              About half the pages you read here say exactly what the scan says. Most of the rest have a word or a phrase
              wrong: a misread that changes the sense, or a word garbled or dropped. Text that is invented, belongs to
              another page, or was never read at all is rare: {pct(notFromThisPage, 1)} of pages.
            </p>
            <p className="text-stone-700 leading-relaxed mb-3">
              On {longDate(servedDate)} we drew {n(servedDraw.books.drawn)} books from the {n(servedFrame)} live books that
              have a transcription — in four groups, by how much confidence our own records gave us in each, then weighted
              back to the library — took five pages spread through each, and had an AI reviewer (Claude Opus) read each of
              the {n(grades.pages)} pages against the photograph of the page. It marked every defect it found with a kind
              and one of three weights: a slip that misleads nobody, a reading that changes the sense, or text the page
              does not carry. Those weights give each page a grade, and this is how the {n(grades.pages)} pages fell.
            </p>
          </div>

          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 mb-1">
            <table className="min-w-[640px] w-full text-sm text-stone-700">
              <caption className="sr-only">Share of pages in each grade, weighted back to the library, with 95% intervals</caption>
              <thead>
                <tr>
                  <th className={th}>What a reader can do with the page</th>
                  <th className={th}>What the reviewer found</th>
                  <th className={th}>Pages</th>
                  <th className={th}>Share of the library (95% interval)</th>
                </tr>
              </thead>
              <tbody>
                {LADDER.map(({ key, can }) => {
                  const g = grades.grades[key];
                  return (
                    <tr key={key}>
                      <td className={`${td} font-semibold text-stone-900 w-[26%]`}>{can}</td>
                      <td className={`${td} w-[36%]`}>{grades.grade_label[key]}</td>
                      <td className={td}>{g.pages}</td>
                      <td className={td}>
                        <b className="text-stone-900">{pct(g.share, g.share < 0.05 ? 1 : 0)}</b>{' '}
                        <span className="text-stone-500 text-xs">
                          ({pct(g.ci95[0], g.ci95[0] < 0.05 ? 1 : 0)}–{pct(g.ci95[1], g.ci95[1] < 0.05 ? 1 : 0)})
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Source>
            <A href={`${BLOB}${SERVED_GRADES}`}>served-grades.json</A>, re-graded from the same{' '}
            {n(servedDraw.books.pages_judged)} verdicts as <A href={`${BLOB}${SERVED_RECORD}`}>the record</A> (
            <IssueLink num={7866} />, <IssueLink num={7933} />). The four grades are{' '}
            <a href="#the-grades" className={LINK}>our own published rubric</a>; the last three rows split what it calls{' '}
            <i>not usable</i>, because
            a wrong word and another book&rsquo;s page are not the same failure. Books were drawn in four groups and
            weighted back to the library; the interval is a bootstrap over books. The reviewer turned down{' '}
            {kOfN(servedDraw.instrument.wrong_page)} pages shown with another page&rsquo;s text, and caught{' '}
            {kOfN(servedDraw.instrument.planted)} errors we planted.
          </Source>
          <p className="max-w-3xl text-stone-700 leading-relaxed mt-3">
            Counting only the flags a second reviewer upheld, the pages that say what the page says rise from{' '}
            {pct(grades.buckets.says_what_the_page_says.share)} to{' '}
            <b className="text-stone-900">{pct(grades.reread.says_what_the_page_says.share)}</b>. The reviewer also misses
            errors, so neither figure is a ceiling; <a href="#trust" className={LINK}>how far to trust these figures</a>.
          </p>

          <Sub>How far to trust these figures</Sub>
          <div id="trust" className="max-w-3xl scroll-mt-24">
            <p className="text-stone-700 leading-relaxed mb-3">
              One AI reviewer made every verdict above, and no person has checked them, beyond the three worked examples
              further down. We have measured that reviewer twice, and it errs in both directions.
            </p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700 leading-relaxed mb-3">
              <li>
                <b className="text-stone-900">It flags things that are not wrong.</b> Eighty of its own flags were read
                again by a fresh reviewer that saw only the quoted words and the photograph. A fifth of the
                &ldquo;text the page does not carry&rdquo; flags and a third of the &ldquo;changes the sense&rdquo; flags
                did not hold up; and 17 of 40 it had called misleading were re-read as outright wrong, so the line between
                those two is unstable. Re-running the table above with that correction:{' '}
                <b className="text-stone-900">{pct(grades.reread.says_what_the_page_says.share)}</b> of pages say what the
                page says ({pct(grades.reread.says_what_the_page_says.ci95[0])}–
                {pct(grades.reread.says_what_the_page_says.ci95[1])}) and{' '}
                {pct(grades.reread.text_not_on_the_page.share)} carry something the page does not
                (<IssueLink num={6740} />).
              </li>
              <li>
                <b className="text-stone-900">It misses more than it over-flags.</b> On pages where a typed scholarly
                edition exists to check against, it catches fewer than half the pages that are wrong by a strict
                letter-for-letter bar (42% on print, 45% on Chinese manuscripts). So the shares above are not a ceiling on
                how good the text is; they are what one reviewer saw (<IssueLink num={7263} />).
              </li>
              <li>
                <b className="text-stone-900">In plain units.</b> On printed pages with a typed edition to compare with, our
                machine reading carries about 2 to 3 meaning-changing errors per 1,000 words. A human-typed scholarly
                edition of the very same pages carries about 1.5. Machine reading is roughly one and a half to two times the
                human error rate on print, not ten times (<IssueLink num={7263} />).
              </li>
            </ul>
            <p className="text-stone-700 leading-relaxed mb-3">
              This checks the transcription only, not the English. On manuscripts the reviewer agrees with people much less
              well than on print, and there it favours readings made by its own model family (
              <a href="#learned" className={LINK}>finding 2</a>).
            </p>
          </div>

          <Sub>Why there is no single number here</Sub>
          <div className="max-w-3xl">
            <p className="text-stone-700 leading-relaxed mb-3">
              This page used to open with one: <i>{pct(servedUsable)} of books passed</i>. It came from the same check,
              counting a book as failed when two of its five pages carried any error at all. That rule puts a page whose
              only fault is the word <i>Egypt</i> printed clearly and read as <i>IJgyjDt</i> in the same bin as a page
              carrying another book&rsquo;s text, and it hides how much of the library sits in between. We have stopped
              leading with it.
            </p>
            <p className="text-stone-700 leading-relaxed mb-3">
              The deeper reason is that the answer depends far more on where the bar is set than on which pages were
              drawn. Ask for books that are letter-perfect across five pages and almost none passes: corrected for the
              reviewer&rsquo;s misses, 93% have two pages carrying at least a few wrong letters (<IssueLink num={7263} />).
              A bar like that fails typed scholarly editions too — the ones we check our pages against turn out to carry
              about 1.5 meaning-changing errors per 1,000 words of their own. Ask instead whether a reader would be
              misled, and about half the pages are clean. Both are true of the same library. So this page reports the
              distribution and the error rate per thousand words, and says which bar each figure uses.
            </p>
            <Source>
              The old figure, for reconciliation: by {pct(servedUsable)}&rsquo;s own rule {pct(servedDraw.corpus.bad_share)}{' '}
              of books (95% interval {pct(servedDraw.corpus.bad_share_ci95[0])}–{pct(servedDraw.corpus.bad_share_ci95[1])}),
              about {n(servedWeakBooks)} books, had two or more of five pages with an error. Of the{' '}
              {n(grades.pages)} pages, {n(grades.bad_7866.pages)} counted against their book under that rule, and the rule
              weighed them all the same: {n(grades.bad_7866.by_grade.search_only.counted_bad)} whose worst fault changes
              the sense of a word, {n(grades.bad_7866.by_grade.wrong_span.counted_bad + grades.bad_7866.by_grade.from_elsewhere.counted_bad)}{' '}
              carrying a span the page does not have, and{' '}
              {n(grades.bad_7866.by_grade.not_this_page.counted_bad + grades.bad_7866.by_grade.mostly_wrong.counted_bad)}{' '}
              substantially wrong or not this page at all.
            </Source>
          </div>

          <Sub>By language</Sub>
          <div className="max-w-3xl">
            <p className="text-stone-700 leading-relaxed mb-3">
              The same {n(grades.pages)} pages, split by the book&rsquo;s language. This is where the figures above come
              apart: English and Russian print is largely clean, Latin, German, Chinese and Tibetan sit near the middle, and
              Greek, Sanskrit and Korean are poor (so is Arabic, on too few books to table). Those are read by
              general-purpose models never tested on their script, and nothing better has re-read them.
            </p>
            <p className="text-stone-700 leading-relaxed mb-3">
              Read the first figure before the shares. A page is counted clean only if it has no meaning-changing error
              anywhere, and a Latin page holds nearly 300 words, so one wrong word in 160 is enough to keep most Latin
              pages out of that column. The unit is words for alphabetic scripts, characters for Chinese and Korean and
              syllables for Tibetan, and those units are not comparable with each other.
            </p>
          </div>
          <p className="md:hidden text-xs text-stone-500 mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[860px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Language</th>
                  <th className={th}>Books</th>
                  <th className={th}>Pages</th>
                  <th className={th}>One meaning-changing error in about</th>
                  <th className={th}>Pages with no such error</th>
                  <th className={th}>Pages whose worst error changes the sense of a word</th>
                  <th className={th}>Pages with a word or phrase garbled, dropped or added</th>
                </tr>
              </thead>
              <tbody>
                {gradeLanguages.map(r => (
                  <tr key={r.language}>
                    <td className={`${td} font-semibold text-stone-900`}>
                      {r.language}
                      <span className="block text-xs font-normal text-stone-500 mt-1">{r.routes.map(x => READER_NAME[x.route] ?? x.route).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).join(', ')}</span>
                    </td>
                    <td className={td}>{r.books}</td>
                    <td className={td}>{r.pages}</td>
                    <td className={td}>
                      {everyN(r.severe_per_1k) == null ? '–' : (
                        <>
                          <b className="text-stone-900">{everyN(r.severe_per_1k)} {r.unit}</b>
                          <span className="block text-xs text-stone-500 mt-1">
                            {r.severe_per_1k} per 1,000 · {perPage(r)} on an average page
                          </span>
                        </>
                      )}
                    </td>
                    <td className={td}>{pct(r.says_what_the_page_says)}</td>
                    <td className={td}>{pct(r.misleads_somewhere)}</td>
                    <td className={td}>{pct(r.text_not_on_the_page)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Source>
            <A href={`${BLOB}${SERVED_GRADES}`}>served-grades.json</A>, <code>by_language</code>. Languages with fewer than
            three books in the draw are left out of this table; every figure above it counts them. The full list, and the
            same cut by writing system and by reading method, are in the file. The draw was stratified by our confidence,
            not by language, so a language&rsquo;s own share here is a reading of between {gradeLanguages.at(-1)?.books} and{' '}
            {gradeLanguages[0]?.books} books and carries a wide interval. A share of 0% or 100% on three books means only
            that: three books. The last column includes the rare invented or misplaced text; on its own that is{' '}
            {pct(notFromThisPage, 1)} of pages across all languages.
          </Source>

          <div className="max-w-3xl mt-6">
            <p className="text-stone-700 leading-relaxed mb-3">
              <b className="text-stone-900">Within Latin, handwriting matters more than age.</b> In this draw, the 11 Latin
              books that are manuscripts or were printed before 1501 carry about 10 meaning-changing errors per 1,000
              words, against about 2 for the 12 printed later; but that group mixes the two, and a third of the draw&rsquo;s
              Latin books had no record of whether they are handwritten. A larger study that drew 109 Latin books by era
              and by form, and checked the form of each on its image, separates them: manuscripts carry about four times
              the errors of print in every era, and books printed before 1501 are only a little worse than later print
              (<IssueLink num={7947} />). The failures are abbreviations, which scribes used far more than printers, read
              as the wrong whole word. In a
              herbal printed in 1484, <i>ſauine</i> (savin, a herb) became <i>semine</i> (seed), and <i>an. m. j</i>{' '}
              (one handful) became <i>unciam i.</i> (one ounce), so the recipe changed. In a manuscript of Hierocles,{' '}
              <i>agitari</i> became <i>aquari</i> twice. We opened both pages against the photograph.
            </p>
          </div>
          <Source>
            <A href={`${BLOB}scripts/eval/experiments/2026-11-02-latin-by-age-7933.md`}>The Latin split</A>: 141 Latin pages
            from the same draw, unweighted, with the instances and the books named (<IssueLink num={7933} />).
          </Source>

          <Sub>By reading engine</Sub>
          <div className="max-w-3xl">
            <p className="text-stone-700 leading-relaxed mb-3">
              A table of engines alone would mislead, because each engine was given different books: Greek and Sanskrit
              went to Gemini 3 Flash, Korean to Flash-Lite, Chinese manuscripts to PaddleOCR. So this compares engines only
              within one language, and only where an engine read at least three books in the draw. The counts are pages,
              not shares of the library, and many cells are a handful of books.
            </p>
          </div>
          <p className="md:hidden text-xs text-stone-500 mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[640px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Language</th>
                  <th className={th}>Read by</th>
                  <th className={th}>Books</th>
                  <th className={th}>Pages</th>
                  <th className={th}>One meaning-changing error in about</th>
                  <th className={th}>Pages with no such error</th>
                </tr>
              </thead>
              <tbody>
                {engineRows.map(r => (
                  <tr key={`${r.language}-${r.route}`}>
                    <td className={`${td} font-semibold text-stone-900`}>{r.language}</td>
                    <td className={td}>{READER_NAME[r.route] ?? r.route}</td>
                    <td className={td}>{r.books}</td>
                    <td className={td}>{r.pages}</td>
                    <td className={td}>
                      {r.severe_per_1k ? (
                        <>
                          <b className="text-stone-900">{everyN(r.severe_per_1k)} {unitOfLanguage(r.language)}</b>
                          <span className="block text-xs text-stone-500 mt-1">{r.severe_per_1k} per 1,000</span>
                        </>
                      ) : (
                        <b className="text-stone-900">none found</b>
                      )}
                    </td>
                    <td className={td}>{pct(r.says_what_the_page_says)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Source>
            <A href={`${BLOB}${SERVED_GRADES}`}>served-grades.json</A>, <code>by_language_route</code>, unweighted. In Chinese
            the engines read different material: PaddleOCR the manuscripts, the Gemini models printed books, so those
            rows are not a contest. The full list, including engines that read one or two books, is in the file. The
            library&rsquo;s own mix of engines: <A href={`${BLOB}scripts/eval/experiments/2026-11-02-stock-by-engine-7933.md`}>the
            census</A>.
          </Source>
          <div className="max-w-3xl mt-6">
            <p className="text-stone-700 leading-relaxed mb-3">
              Three things stand out. Gemini 3 Flash beats Flash-Lite where both read the same language: about 2 errors per
              1,000 words against 6 in German, and 5 against 13 in Latin. In English both are good. Engines built or chosen
              for one kind of page do best: LightOnOCR, on our own GPU, found no meaning-changing error in ten English pages,
              and the Tibetan pages taken from Esukhia&rsquo;s typed edition have about one error in 2,000 syllables. The
              Internet Archive&rsquo;s own OCR, which we import for some English books, is worse than either Gemini model
              on English. And general-purpose models are poor on Greek, Sanskrit and Korean, at one error in every 50 to 60
              words or characters. Those pages wait for an engine that has been tested on their script.
            </p>
            <p className="text-stone-700 leading-relaxed mb-3">
              <b className="text-stone-900">These are the reads already in the library, not the ones we make now.</b> In a
              random sample of 28,053 live pages, Flash-Lite wrote 47% of the transcriptions and Gemini 3 Flash 22%; Gemini
              3.8 Flash, which reads pages now, has written 1.5%. Latin is 72% Flash-Lite, and Latin printed before 1501 is
              90%. The English follows the same pattern: Flash-Lite 52%, 3 Flash 44%, 3.8 Flash 2%. Where 3.8 Flash has re-read pages
              Flash-Lite read, it cut the Latin pages a reviewer called misleading from 41% to 8% (250 pages,{' '}
              <IssueLink num={5924} />). The draw also leans toward Gemini 3 Flash in Latin (80% of its Latin pages,
              against 28% of the library&rsquo;s), so the Latin rate above is probably lower than the library&rsquo;s as
              it stands.
            </p>
          </div>

          <Sub>By the age and hand of the book</Sub>
          <div className="max-w-3xl">
            <p className="text-stone-700 leading-relaxed mb-3">
              Alphabetic scripts only, so every rate is per 1,000 words. The dates and the manuscript label come from our
              records, which are often missing or wrong, so the early rows here likely hold manuscripts filed as print.
              In Latin, where each book&rsquo;s form was checked on its image, the difference is handwriting, not date
              (<IssueLink num={7947} />). In this draw the early books read by Gemini 3
              Flash and by Flash-Lite come out alike ({eraRoute('before 1501', '3flash')?.severe_per_1k} and{' '}
              {eraRoute('before 1501', 'lite')?.severe_per_1k} per 1,000), but those are different books, five or so each.
              Where both engines read the same gothic pages, readers preferred the Flash reading on 14 of 15
              (<IssueLink num={6375} />), so the engine still matters on early print. Languages are mixed in each row, so a
              row with more Greek in it looks worse for that reason.
            </p>
          </div>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[560px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Kind of book</th>
                  <th className={th}>Books in the draw</th>
                  <th className={th}>Pages</th>
                  <th className={th}>One meaning-changing error in about</th>
                  <th className={th}>Pages with no such error</th>
                </tr>
              </thead>
              <tbody>
                {eraRows.map(r => (
                  <tr key={r.key}>
                    <td className={`${td} font-semibold text-stone-900`}>{ERA_LABEL[r.key] ?? r.key}</td>
                    <td className={td}>{r.books}</td>
                    <td className={td}>{r.pages}</td>
                    <td className={td}>
                      <b className="text-stone-900">{everyN(r.severe_per_1k)} words</b>
                      <span className="block text-xs text-stone-500 mt-1">{r.severe_per_1k} per 1,000</span>
                    </td>
                    <td className={td}>{pct(r.says_what_the_page_says)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Source>
            <A href={`${BLOB}${SERVED_GRADES}`}>served-grades.json</A>, <code>by_era_alphabetic</code> and{' '}
            <code>by_era_route_alphabetic</code>, unweighted. The date is the catalogue&rsquo;s; a manuscript is a book whose
            pages our records mark as handwritten, whatever its date.
          </Source>

          <Sub>What is actually wrong</Sub>
          <div className="max-w-3xl">
            <p className="text-stone-700 leading-relaxed mb-3">
              The reviewer tagged {n(grades.defect_totals.all)} defects on the {n(grades.pages)} pages, each with one of{' '}
              <A href="/research/page-errors">44 named kinds</A>. Almost half of them are one kind: a single word or
              character read as another word that exists. Outright invention is rare and concentrated — in Greek, Korean
              and Sanskrit, where the engine was reading a script it reads badly. The rest is largely the furniture of an
              early printed page: running heads, signature marks, catchwords and footnote numbers put in the wrong place or
              read as letters.
            </p>
          </div>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[760px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Kind of defect</th>
                  <th className={th}>Found</th>
                  <th className={th}>Of which misleads</th>
                  <th className={th}>Of which text the page does not carry</th>
                  <th className={th}>Mostly in</th>
                </tr>
              </thead>
              <tbody>
                {topClasses.map(c => (
                  <tr key={c.class}>
                    <td className={`${td} font-semibold text-stone-900 w-[30%]`}>
                      {c.name}
                      <span className="block text-xs font-normal text-stone-500 mt-1">class {c.class}</span>
                    </td>
                    <td className={td}>{n(c.total)}</td>
                    <td className={td}>{n(c.misleads)}</td>
                    <td className={td}>{n(c.wrong_text)}</td>
                    <td className={td}>{c.languages.slice(0, 3).map(l => l.language).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="max-w-3xl mt-6 space-y-4">
            {examples.map(e => (
              <div key={`${e.book}-${e.page}-${e.quote}`} className="rounded-sm border border-stone-200 bg-white px-4 py-4">
                <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">
                  {e.name} · {e.language} · {e.severity === 'wrong_text' ? 'text the page does not carry' : e.severity === 'misleads' ? 'changes the sense' : 'misleads nobody'}
                </div>
                <p className="font-mono text-sm leading-relaxed text-stone-800 mb-2 break-words">{e.quote}</p>
                <p className="text-[0.95rem] leading-relaxed text-stone-700">{e.what}</p>
                <p className="text-xs text-stone-500 mt-2">
                  <A href={`/book/${e.book}?page=${e.page}`}>{e.title ?? 'the page'}</A>, page {e.page}
                </p>
              </div>
            ))}
          </div>
          <Source>
            The quoted span and the explanation are the reviewer&rsquo;s own words about our text, not a person&rsquo;s;
            so is the name of the kind, which is not always a tight fit (the third example above is perfectly legible, and
            the kind it is filed under is named for illegible leaves). These three were each opened against the page image
            and confirmed by eye on {longDate('2026-11-02')}; the other {n(grades.defect_totals.all - 3)} were not. Open
            any page beside its scan and judge for yourself; if we have it wrong, the Feedback button at the foot of that
            page reaches us. All {n(grades.defect_totals.all)} defects, by kind and language, are in{' '}
            <A href={`${BLOB}${SERVED_GRADES}`}>served-grades.json</A>.
          </Source>

          <Sub>What we are doing about it</Sub>
          <div className="max-w-3xl">
            <p className="text-stone-700 leading-relaxed">
              A second reading by a stronger model now corrects weak German and French transcriptions (
              <IssueLink num={7558} />). The cheap signals we already store cannot pick out the weak books (
              <a href="#learned" className={LINK}>finding 1</a>), so finding them means reading pages: we will repeat this
              draw every month and report here whether the shares move (<IssueLink num={7263} />). The languages with the
              lowest shares above — Greek, Sanskrit, Korean, Arabic — are the queue.
            </p>
          </div>

          <Sub>Why other figures on this site are higher</Sub>
          <p className="text-stone-700 leading-relaxed mb-3 max-w-3xl">
            Each figure below answers a narrower question than the one above. Read them as parts of the picture, not as
            rival headlines.
          </p>
          <ul className="list-disc pl-5 space-y-2 text-stone-700 leading-relaxed max-w-3xl mb-4">
            <li>
              <b className="text-stone-900">The best case, not what you are served.</b> The transcription figures in the
              tables below come from the engine we use now, on test pages that have a published text to compare with, and
              the page-image checks from 30 test pages for each way of reading. They say how good a method can be. Many pages
              you read were transcribed earlier, by other engines, and on harder pages.
            </li>
            <li>
              <b className="text-stone-900">The English judged against our transcription, not the page.</b> In the by-language
              table, the English of {englishTopRange} of pages from Latin, English and German books is rated 4 or 5 of 5 (
              {longDate(byLanguage.generated)}). That judge compares our English with our own transcription, so an error in
              the transcription does not count against it. The same is true of the{' '}
              <A href="/quality/methods#monthly-audit">monthly audit</A>, which found a major error in the English on 14.8% of
              pages (95% interval 7.0–24.2%; 103 books, one page each, drawn 1 October 2026).
            </li>
            <li>
              <b className="text-stone-900">A page and a book.</b> A page figure counts pages; the headline counts books, and a
              book fails when two of its five pages do. The two cannot be compared directly.
            </li>
            <li>
              <b className="text-stone-900">Different shelves and dates.</b> The spot check of 6 October 2026 (about 18 of 30
              books with a defect visible on sight) covered the canon shelves only, with books of any visibility, and counted
              wrong shelving, rights and broken books as well as text. Every figure on this page carries its date; the
              newest is the one above.
            </li>
          </ul>

          <Sub>How a page can go wrong</Sub>
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            A page can go wrong in two places: the transcription can misread the scan, and the English can misread the
            transcription. We measure each against published texts where they exist. A score from a model judge is a
            model&rsquo;s opinion, not a person&rsquo;s, and the table says which is which.
          </p>

          <Figure
            title="One line, checked against the scan"
            caption={
              <>
                From the leaf above (<A href={leafHref}>page {LEAF.page}</A>), read by eye while this page was written, 6 October
                2026. The English happens to be right; the transcription is not, and a reader searching the Latin for{' '}
                <i>particulas</i> would not find this page. A check of the transcription asks this question of a page: does our
                text say what the scan says?
              </>
            }
          >
            <Row label="The scan">
              <Crop box={LEAF.line} className="hidden sm:block" alt="The end of one printed line: natio. Quisquilias. i. vilissimas et abiectissimas, then an abbreviated word broken at the line end." />
              <Crop box={LEAF.lineNarrow} className="sm:hidden" alt="The last words of one printed line: et abiectissimas, then an abbreviated word broken at the line end." />
            </Row>
            <Row label="Our text">
              <p className="font-mono text-sm leading-relaxed text-stone-800">
                natio. Quisquilias. i. vilissimas &amp; abiectissimas <span className="underline decoration-amber-700 decoration-2 underline-offset-4">quis-</span>
              </p>
            </Row>
            <Row label="Our English">
              <p className="text-[0.95rem] leading-relaxed">
                <b>Scraps.</b> That is, the cheapest and most rejected little bits, like the refuse that is swept up by brooms.
              </p>
            </Row>
            <Row label="The mark">
              <p className="text-[0.95rem] leading-relaxed">
                The last word on the line is printed <i>p̄ti-</i>, short for <i>particulas</i>, &ldquo;small pieces&rdquo;. Our
                transcription reads <i>quis-culas</i>, a word that does not exist.
              </p>
            </Row>
          </Figure>

          <Sub>By language: test pages, and the English judged on its own</Sub>
          <p className="text-stone-700 leading-relaxed max-w-3xl mb-3">
            This table is not a rate for the pages you are served. Its transcription columns measure the engine we use now
            on test pages with a published text, the best measured case. The model-judge column rates our English against
            our own transcription, not against the page, and the next column compares it with a published translation, so
            it covers only works that have one.
          </p>
          <p className="text-stone-700 leading-relaxed max-w-3xl mb-3">
            We score each transcription three ways: the raw share of characters that differ from a published text of the same
            printing, the share left once we allow the conventions our transcription instructions ask for (abbreviations written
            out, the long s written as s, standard characters), and what kinds of error make up the rest, a rough sorting
            {twMeta?.hand_check ? (
              <>
                {' '}that we checked by eye on {twMeta.hand_check.examples} examples, in {twMeta.hand_check.reference_wrong} of
                which the published text, not ours, was wrong (<A href={`${BLOB}${twMeta.hand_check.file}`}>the check</A>).
              </>
            ) : (
              '.'
            )}
          </p>
          <p className="md:hidden text-xs text-stone-500 mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[860px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Language</th>
                  <th className={th}>Share of English pages</th>
                  <th className={th}>Transcription: median character error against a published text</th>
                  <th className={th}>Transcription three ways: raw, after the prompt&rsquo;s own conventions, and what the error is</th>
                  <th className={th}>English rated 4 or 5 of 5 by a model judge</th>
                  <th className={th}>English against a published translation: pages at 4 or 5 of 5</th>
                  <th className={th}>Checked by a person who reads it</th>
                </tr>
              </thead>
              <tbody>
                {languages.map(({ language, row, fid }) => {
                  const ocr = row?.ocr?.current;
                  const tr = row?.translation;
                  const tw = threeWaysOf(row);
                  return (
                    <tr key={language}>
                      <td className={`${td} font-semibold text-stone-900`}>{language}</td>
                      <td className={td}>{row ? `${row.share_of_translated_pages}%` : <span className="text-stone-500">–</span>}</td>
                      <td className={td}>
                        {ocr?.median_cer != null ? (
                          <>{pct(ocr.median_cer, 1)} <span className="text-stone-500 text-xs">({ocr.pages_scored} pages)</span></>
                        ) : (
                          <span className="text-stone-500">{row ? 'not measured' : '–'}</span>
                        )}
                      </td>
                      <td className={td}>
                        {tw ? (
                          <>
                            {pct(tw.median_cer_raw, 1)} raw, {pct(tw.median_cer_prompt, 1)} after{' '}
                            <span className="text-stone-500 text-xs">({tw.pages} pages)</span>
                            {tw.kinds && (
                              <span className="block text-stone-500 text-xs mt-1">
                                {TW_KINDS.filter(([k]) => tw.kinds![k] >= 0.005).map(([k, label]) => `${label} ${pct(tw.kinds![k])}`).join(' · ')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-stone-500">{ocr?.median_cer != null ? 'not broken down' : '–'}</span>
                        )}
                      </td>
                      <td className={td}>
                        {tr ? <>{pct(tr.share)} <span className="text-stone-500 text-xs">({tr.books} books)</span></> : <span className="text-stone-500">–</span>}
                      </td>
                      <td className={td}>
                        {fid?.share_ge4 != null ? (
                          <>{pct(fid.share_ge4)} <span className="text-stone-500 text-xs">({fid.n} pages)</span></>
                        ) : (
                          <span className="text-stone-500">not measured</span>
                        )}
                      </td>
                      <td className={td}>
                        {(row?.readers?.answers ?? 0) > 0 ? `${row!.readers.answers} answers` : <span className="text-stone-500">not yet</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Source>
            Share, transcription and model-judge columns: <A href={`${BLOB}src/data/quality-by-language.json`}>src/data/quality-by-language.json</A>{' '}
            (generated {longDate(byLanguage.generated)}). {byLanguage.notes.ocr} {byLanguage.notes.translation}{' '}
            {twSource && (
              <>
                Three-ways column: <A href={`${BLOB}${twSource}`}>{twSource.split('/').pop()}</A>, Wikisource and EEBO-TCP pages
                of the same scan or edition, the current engine (flash-lite) on a plain transcription prompt; &ldquo;other&rdquo;
                is mostly marginal notes placed differently, and misreads.{' '}
              </>
            )}
            Published-translation column: the <code>translation_fidelity</code> entries of{' '}
            <A href={`${BLOB}src/data/ocr-benchmark-evidence.json`}>src/data/ocr-benchmark-evidence.json</A>
            {fidelityRun && <> (run {fidelityRun}{fidelityIssue && <>, <IssueLink num={fidelityIssue} /></>})</>}: one page per book,
            two blind model judges comparing our English with a published human translation of the same page. Methods and
            intervals: <A href="/research/quality">How page quality is measured</A>.
          </Source>

          <div id="who-reads" className="scroll-mt-24">
            <Sub>Who reads which page</Sub>
          </div>
          <p className="text-stone-700 leading-relaxed max-w-3xl mb-3">
            Different kinds of page are read by different engines. This table is what {n(ocrExperimentCount)} transcription
            experiments have settled so far: the reader for each kind of page, and the measurement behind the choice. The
            figures come from test pages that have a typed text to compare with. They are not a rate for every page in the
            library. Where a row is not settled, or rests on a small sample, it says so.
          </p>
          <p className="text-stone-700 leading-relaxed max-w-3xl mb-3">
            The reader for new pages is not always the one that wrote the text you see. Many pages were read earlier, by
            another engine. The third column says what is stored now, in pages: every page of every published book in
            that language, counted on {longDate(ocrRouting.census.date)}.
          </p>
          <p className="md:hidden text-xs text-stone-500 mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[920px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Kind of page</th>
                  <th className={th}>New pages are read by</th>
                  <th className={th}>What readers have now</th>
                  <th className={th}>Why, as measured</th>
                  <th className={th}>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {ocrRouting.rows.map(row => (
                  <tr key={row.id}>
                    <td className={`${td} font-semibold text-stone-900 w-[15%]`}>{row.kind}</td>
                    <td className={`${td} w-[17%]`}>
                      {row.reader}
                      <span className="block text-xs text-stone-500 mt-1">{row.in_use}</span>
                      {notInUseFor(row.id).map(r => (
                        <span key={r.reader} className="block text-xs text-stone-500 mt-1">
                          {r.in_use} {r.reader}: accepted on {of(r.accepted)} pages checked against the image,{' '}
                          {longDate(pageCheck.date)}.
                        </span>
                      ))}
                    </td>
                    <td className={`${td} w-[17%]`}>{row.stored ?? <span className="text-stone-400">Not counted</span>}</td>
                    <td className={td}>
                      {row.why}
                      <span className="block mt-1"><Status status={ROUTING_STATUS[row.status] ?? row.status} /></span>
                    </td>
                    <td className={`${td} w-[15%]`}>
                      <ul className="space-y-1">
                        {(row.evidence as RoutingEvidence[]).map(e => (
                          <li key={e.file ?? e.issue}>
                            <A href={evidenceHref(e)}>{e.n}</A>, {longDate(e.date)}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-stone-700 leading-relaxed max-w-3xl mt-4 mb-2">Tested and not adopted:</p>
          <ul className="list-disc pl-5 space-y-1.5 text-stone-700 leading-relaxed max-w-3xl">
            {ocrRouting.not_adopted.map(x => (
              <li key={x.engine}>
                <b className="text-stone-900">{x.engine}.</b> {withIssueLinks(x.why)}
              </li>
            ))}
          </ul>
          <p className="text-stone-700 leading-relaxed max-w-3xl mt-4">
            A reviewer in these tests is an AI model unless the row says a person checked. To keep watch on each reader we
            have specified a weekly check: one random page from each of about 50 books, reviewed against the page image by
            a model from a different maker than the one that read it. It is not running yet.
          </p>
          <Source>
            Read from <A href={`${BLOB}scripts/lib/ocr-routing-table.json`}>scripts/lib/ocr-routing-table.json</A> (as of{' '}
            {longDate(ocrRouting.as_of)}, <IssueLink num={ocrRouting.issue} />), the same file the routing code reads. The
            weekly check is specified in{' '}
            <A href={`${BLOB}scripts/eval/ocr-routing/README.md`}>scripts/eval/ocr-routing/README.md</A>. Cost against accuracy
            for each engine: <A href="/quality/pareto">What it costs to read and translate a page, and how well</A>.
          </Source>

          <div id="page-check" className="scroll-mt-24">
            <Sub>Checked against the page image, {longDate(pageCheck.date)}</Sub>
          </div>
          <p className="text-stone-700 leading-relaxed max-w-3xl mb-3">
            For four kinds of page we drew 30 pages for each way of reading them, and had Claude Opus, an AI reviewer,
            read every text against the photograph of its page. A page is accepted when it could be published as that page&rsquo;s text: every line, in
            order, with the right words, names and numbers. A page has wrong text when it says something the page does not:
            words left out or added, another page&rsquo;s text, or a misread that changes the sense. Ways of reading we
            measured but do not use yet are listed with the one in use. These are test pages, so the table says how good each
            way of reading is, not what every stored page is like. We also checked {pageCheck.by_eye_agreement.of} of these texts by
            eye against the page; our verdict and the reviewer&rsquo;s agreed on {pageCheck.by_eye_agreement.n}.
          </p>
          <p className="md:hidden text-xs text-stone-500 mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[820px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Kind of page</th>
                  <th className={th}>Read by</th>
                  <th className={th}>Accepted</th>
                  <th className={th}>Pages with wrong text</th>
                </tr>
              </thead>
              <tbody>
                {pageCheck.kinds.flatMap(k =>
                  k.routes.map((r, i) => (
                    <tr key={`${k.id}-${r.score.route}`}>
                      {i === 0 && (
                        <td rowSpan={k.routes.length} className={`${td} w-[22%]`}>
                          <span className="font-semibold text-stone-900">{k.kind}</span>
                          <span className="block text-xs text-stone-500 mt-1">{k.sample}</span>
                          {k.note && <span className="block text-xs text-stone-600 mt-2">{k.note}</span>}
                        </td>
                      )}
                      <td className={`${td} w-[24%]`}>
                        {r.reader}
                        <span className="block text-xs text-stone-500 mt-1">{r.in_use}</span>
                      </td>
                      <td className={`${td} w-[10%] whitespace-nowrap`}>{of(r.accepted)}</td>
                      <td className={td}>
                        <span className="whitespace-nowrap">{of(r.wrong_text)}.</span> {r.wrong_text_what}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <Source>
            Read from the <code>page_check</code> block of{' '}
            <A href={`${BLOB}scripts/lib/ocr-routing-table.json`}>scripts/lib/ocr-routing-table.json</A>; the counts are those
            of <A href={`${BLOB}${pageCheck.source}`}>score.json</A>, with the pages we read by eye in{' '}
            <A href={`${BLOB}${pageCheck.by_eye}`}>by-eye.md</A>. Write-up:{' '}
            <A href={`${BLOB}scripts/eval/experiments/${pageCheck.writeup}`}>the reviewer pilot</A>; cost and acceptance for
            each way of reading: <A href={`${BLOB}${pageCheck.router_table}`}>the table of {longDate(pageCheck.date)}</A>{' '}
            (<IssueLink num={pageCheck.issue} />).
          </Source>

          <Sub>What we have not measured, and what is known to be wrong</Sub>
          <ul className="list-disc pl-5 space-y-2 text-stone-700 leading-relaxed max-w-3xl">
            {noReaders && (
              <li>
                The reader panel, in which people who read a language score our pages, has no answers yet in any language. So
                every score above is a comparison with a published text or a model&rsquo;s judgment, and we do not yet know
                how far the model judges agree with people. The panel is planned (<IssueLink num={5406} />).
              </li>
            )}
            {noOcrReference.length > 0 && (
              <li>No published text to measure the transcription against yet: {noOcrReference.join(', ')}.</li>
            )}
            {lowFidelity.length > 0 && (
              <li>
                Fewer than half the pages score 4 or 5 of 5 against a published translation in{' '}
                {lowFidelity.map((f, i) => (
                  <span key={f.language}>
                    {i > 0 && (i === lowFidelity.length - 1 ? ' and ' : ', ')}
                    {f.language} ({pct(f.share_ge4 ?? 0)} of {f.n} pages)
                  </span>
                ))}
                .
              </li>
            )}
            <li>
              The pages behind the cost charts below do not look like the library in four places (checked{' '}
              {longDate(audit.date)}, <IssueLink num={audit.issue} />). Chinese translation is {pct(cov.chineseTranslationPrinted.sample)}{' '}
              printed pages, where {pct(cov.chineseHandwritten.corpus)} of the library&rsquo;s Chinese pages are handwritten.
              Tibetan translation covers {cov.tibetan.texts} texts, {cov.tibetan.printed.sample === 1 ? 'all' : pct(cov.tibetan.printed.sample)} printed, where{' '}
              {pct(cov.tibetan.handwritten.corpus)} of Tibetan pages are manuscripts. Early English OCR is{' '}
              {pct(cov.english17c.sample)} 17th-century print, against {pct(cov.english17c.corpus)} of English pages. German
              and French OCR is {cov.germanFrench.n} pages{cov.germanFrench.wikisource.sample === 1 && <>, all from Wikisource&rsquo;s own scans</>},{' '}
              {pct(cov.germanFrench.c19.sample)} 19th century.
            </li>
            {caveats.map(r => (
              <li key={r.language}>
                {r.language}: {r.caveat!.text}
                {'issue' in r.caveat! && r.caveat!.issue ? <> <IssueLink num={r.caveat!.issue as number} /></> : null}
              </li>
            ))}
            {defects.map((d, i) => (
              <li key={`${d.n}-${i}`}>
                {d.title}. <IssueLink num={d.n} />
              </li>
            ))}
          </ul>
          <Source>
            Generated from the files above and from the open-work list on <A href="/research/quality/open">Open quality work</A>{' '}
            (status as of {OPEN_WORK_AS_OF}). Each item links to its public issue, which is the current record.
          </Source>

          <div id="the-grades" className="scroll-mt-24">
            <Sub>How a page is graded, and which pages we check</Sub>
          </div>
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            The figures above use different scales, chosen study by study. We are replacing them with one grade per page,
            built from published standards: the error severities of{' '}
            <A href="https://arxiv.org/abs/2405.16969">MQM</A>, the scheme translation research uses to count errors, and
            the transcription levels of the <A href="https://ocr-d.de/en/gt-guidelines/trans/trLevels.html">OCR-D guidelines</A>,
            which keep the long s, u and v and abbreviation marks as printed. To these we add three checks of our own: is
            it the right page, does the text contain words that are not on the page, and did the machine refuse to read it.
          </p>
          <dl className="max-w-3xl">
            {GRADES.map(g => (
              <div key={g.name} className="py-3 border-b border-stone-200 md:grid md:grid-cols-[12rem_1fr] md:gap-x-6">
                <dt className="font-semibold text-stone-900 mb-1">{g.name}</dt>
                <dd className="text-stone-700 leading-relaxed">
                  <p>{g.means}</p>
                  <p className="mt-1 text-sm text-stone-500">{g.rule}</p>
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-stone-700 leading-relaxed mt-4 mb-4 max-w-3xl">
            Which pages: each month a random draw of books, one page per book, so that no single book counts twice. Every
            language and period is drawn, with more books where we serve more pages and where errors have been more
            common. Title pages, blank pages,
            tables, pages in two scripts and damaged pages are drawn separately, because that is where machines most often
            invent text, and then weighted back to their share of the library. Pages used to score a month are never used
            to tune the next fix.
          </p>
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            The grades themselves have now been computed once, on the {n(grades.pages)} pages at the top of this page, from
            one AI reviewer&rsquo;s severities. What has not run is the rest of the plan: the standing monthly draw with its
            own strata for title pages, blank pages and tables, and the check of the grades by people who read each
            language. Until that check, every grade on this page is a model&rsquo;s opinion, labelled as one.
          </p>
          <Source>
            The rubric, the sampling plan, and a count of what is measured in each language and period today:{' '}
            <A href={`${BLOB}.claude/docs/quality-rubric-and-sampling.md`}>quality-rubric-and-sampling.md</A> (<IssueLink num={5984} />).
          </Source>

          <Sub>By canon</Sub>
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            For some canons the text beside the scan was typed by people (an open e-text edition aligned page by page to our
            scans) rather than read by a machine. Those pages can still carry errors of alignment, but not misreadings.
          </p>
          <p className="md:hidden text-xs text-stone-500 mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[560px] w-full text-sm text-stone-700">
              <thead>
                <tr>
                  <th className={th}>Canon</th>
                  <th className={th}>Books</th>
                  <th className={th}>Pages with text, of pages scanned</th>
                  <th className={th}>Text typed by people</th>
                  <th className={th}>Pages in English</th>
                </tr>
              </thead>
              <tbody>
                {canon.traditions.map(t => {
                  const typed = typedPages(t);
                  return (
                    <tr key={t.id}>
                      <td className={`${td} font-semibold text-stone-900`}>{t.name}</td>
                      <td className={td}>{n(t.books)}</td>
                      <td className={td}>
                        {n(t.pages_transcribed)} <span className="text-stone-500 text-xs">of {n(t.pages_scanned)}</span>
                      </td>
                      <td className={td}>
                        {t.pages_transcribed > 0 ? (typed > 0 ? `${share(typed, t.pages_transcribed)} (${n(typed)} pages)` : 'none') : <span className="text-stone-500">–</span>}
                      </td>
                      <td className={td}>{n(t.pages_translated)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Source>
            <A href={`${BLOB}${canon.file}`}>{canon.file}</A>, counted {longDate(canon.generated_at)}. &ldquo;Typed by
            people&rdquo; counts pages whose text came from Esukhia&rsquo;s Derge e-texts, CBETA, Sefaria or a hand
            correction. What checks each canon&rsquo;s text and English, with the measured figures and what a scholar could
            add: <A href="/research/canon-quality">How we check each canon</A>. What we hold of each canon:{' '}
            <A href="/research/canon-gap">The canon gap</A>.
          </Source>
        </Section>

        {/* ── 2. What we have learned (#7263) ── */}
        <Section id="learned" title="What we have learned">
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            Findings that change how we measure and what we fix, newest last. Each links to its full record.
          </p>
          <ol className="max-w-3xl">
            {LEARNED.map((f, i) => (
              <li key={f.title} className="py-4 border-b border-stone-200 grid grid-cols-[2rem_1fr] gap-x-3">
                <span className="font-serif text-xl text-stone-500 tabular-nums">{i + 1}.</span>
                <div>
                  <p className="font-semibold text-stone-900">{f.title}</p>
                  <p className="text-stone-700 leading-relaxed mt-1">{f.text}</p>
                  <p className="text-sm text-stone-500 mt-1">
                    {f.n}; {longDate(f.date)}. <A href={f.record.href}>{f.record.label}</A>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {/* ── 3. Experiments ── */}
        <Section id="experiments" title="Experiments">
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            The quality figures above come from experiments, and each experiment has a written record: the question, how
            it was run, the result, and the decision it led to. Null results and retractions are recorded too.
          </p>
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            The records below are working notes, and use three words of ours. A <i>route</i> is a way of reading a page: the
            engine that reads it first, and any engine that then corrects it, joined by &gt;, as in{' '}
            <i>lite&gt;opus</i>. A <i>cell</i> is a kind of page, a language with print or manuscript, as in{' '}
            <i>latin-lite/print</i>. <i>agy</i> is Google&rsquo;s Antigravity command-line tool, through which we run Gemini
            models on a subscription.
          </p>

          {MONTH_NOTE && (
            <>
              <Sub>What changed this month ({MONTH_NOTE.as_of})</Sub>
              <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">{MONTH_NOTE.text}</p>
            </>
          )}

          <div id="ocr" className="scroll-mt-24">
            <Sub>OCR · Cost against agreement with a typed text, by script</Sub>
            <p className="text-stone-700 leading-relaxed mb-2 max-w-3xl">
              Transcription (OCR): reading the page image into text, scored as character accuracy against a typed
              transcription. For each script: is any OCR engine we can run today clearly better or cheaper than the one we
              use, judged on the same pages, and how far can that answer be trusted (<a href="#chart-limits" className={LINK}>limits</a>)?
              Each dot is an engine; higher reads better, further left is faster (or, where no run was timed, cheaper). Price
              and time views, tables and method are on{' '}
              <Link href="/quality/pareto#ocr" className={LINK}>
                the cost and quality page
              </Link>
              .
            </p>
            <p className="text-sm text-stone-600 leading-relaxed mb-4 max-w-3xl">
              <Link href="/quality/pareto#roster" className={LINK}>What we can run today</Link>: <RosterLine />. Engines
              we cannot run are drawn hollow and never named as the one to run. German blackletter, engine by engine:{' '}
              <Link href="/quality/fraktur" className={LINK}>Reading Fraktur: where it stands</Link>.
            </p>
            <ParetoCharts />
            <Source>
              Generated from the benchmark results by{' '}
              <A href={`${GH}blob/main/scripts/eval/build-ocr-pareto.mjs`}>scripts/eval/build-ocr-pareto.mjs</A> whenever
              the results change. Costs: <A href={`${GH}blob/main/scripts/eval/ocr-cost-snapshot.mjs`}>the Gemini meter</A> and{' '}
              <A href={`${GH}blob/main/scripts/eval/ocr-engine-gpu-costs.json`}>each self-hosted run&rsquo;s record</A>.
              What we can run: <A href={`${GH}blob/main/scripts/eval/build-model-roster.mjs`}>scripts/eval/build-model-roster.mjs</A>.
              Testing the engines not yet tried is separate, priced work (<IssueLink num={5983} />).
            </Source>
          </div>

          <div id="translation" className="scroll-mt-24">
            <Sub>Translation · Cost against fidelity, by language</Sub>
            <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
              Translation: turning that text into English, scored on the 1 to 5 fidelity scale by blind judges against
              published translations. The judges are AI models, not people: they compare our English with a published
              translation of the same page. For each language: is any engine we can run today clearly better or cheaper
              than the one we use? Price and time views, tables and method are on{' '}
              <Link href="/quality/pareto#translation" className={LINK}>
                the cost and quality page
              </Link>
              .
            </p>
            <ParetoCharts m={TRANSLATION} />
            <Source>
              Generated from the per-page results of the translation-against-reference write-ups (<IssueLink num={5695} />,{' '}
              <IssueLink num={5497} />) by{' '}
              <A href={`${GH}blob/main/scripts/eval/build-translation-pareto.mjs`}>scripts/eval/build-translation-pareto.mjs</A>.
            </Source>
          </div>
          <Figure
            title={`One error and its fix: ${WORKED_FIX.title}`}
            caption={
              <>
                From <A href={`${BLOB}${WORKED_FIX.writeup}`}>the write-up</A> and <IssueLink num={WORKED_FIX.issue} />. One
                of the blank pages: <A href={WORKED_FIX.example.href}>{WORKED_FIX.example.label}</A>.
              </>
            }
          >
            <Row label="What readers saw">
              <p className="text-[0.95rem] leading-relaxed">{WORKED_FIX.saw}</p>
            </Row>
            <Row label="How we measured">
              <p className="text-[0.95rem] leading-relaxed">{WORKED_FIX.measured}</p>
              <p className="font-mono text-sm leading-relaxed text-stone-800 mt-2">
                printed: {WORKED_FIX.line.scan}
                <br />
                read: <span className="underline decoration-amber-700 decoration-2 underline-offset-4">{WORKED_FIX.line.before}</span>
              </p>
            </Row>
            <Row label="The fix">
              <p className="text-[0.95rem] leading-relaxed">{WORKED_FIX.fix}</p>
              <p className="font-mono text-sm leading-relaxed text-stone-800 mt-2">repaired: {WORKED_FIX.line.after}</p>
            </Row>
            <Row label="After">
              <p className="text-[0.95rem] leading-relaxed">{WORKED_FIX.after}</p>
            </Row>
          </Figure>

          <div id="chart-limits" className="scroll-mt-24">
            <Sub>How far these charts can be trusted</Sub>
            <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
              On {longDate(audit.date)} we checked whether the pages behind both sets of charts suit the measure. A script
              checked all {n(audit.checked.translation)} translation page slots and {n(audit.checked.ocr)} OCR pages.{' '}
              {audit.eye.pages} of them, one page per book, were read against the page image by {audit.eye.readers} AI
              reviewers (Claude Opus). No scholar has read them yet.
            </p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700 leading-relaxed max-w-3xl">
              <li>
                <b>Pages left out.</b> {audit.dropped.translation + audit.dropped.ocr} pages no longer count in the charts.
                Translation ({audit.dropped.translation}): {reasonList('translation')}. OCR ({audit.dropped.ocr}):{' '}
                {reasonList('ocr')}.
              </li>
              <li>
                <b>What still ranks.</b> Without those pages, the order of engines and the frontier stayed the same on{' '}
                {of(audit.held.translation)} translation charts and {of(audit.held.ocr)} OCR charts
                {audit.held.swapsAllOverlap && <>; every pair of engines that changed places was already within each other&rsquo;s 95% intervals</>}.
                Not fit to rank engines:{' '}
                {audit.unfit.map((u, i) => (
                  <span key={u.chart}>
                    {i > 0 && (i === audit.unfit.length - 1 ? ' and ' : '; ')}
                    {u.chart}
                    {u.qualifier && <>, for {u.qualifier}</>}
                  </span>
                ))}
                . The others can rank engines, with the limit stated under each chart.
              </li>
              <li>
                <b>An OCR score is partly agreement with an edition.</b> Greek: on {of(audit.edition.greek)} pages the
                reference is a modern edition of the work, not a transcription of this print. Latin: on{' '}
                {of(audit.edition.latinNormalised)} pages the reference expands abbreviations or modernises u and v where the
                print does not. Chinese manuscripts: on {of(audit.edition.chineseOverrun)} pages the reference runs more than
                15% past the page. Large gaps between engines hold; small ones are within what the reference itself differs by.
              </li>
              <li>
                <b>Famous texts.</b> Some pages come from texts whose published English is widely reproduced, so a model may
                recall it rather than translate. Share of such pages in each language&rsquo;s chart of Gemini models:{' '}
                {audit.famous.map((f, i) => (
                  <span key={f.language}>
                    {i > 0 && ', '}
                    {f.language} {f.famous} of {f.n}
                  </span>
                ))}
                . On those pages the engines keep the same order as on the rest (rank correlation{' '}
                {audit.spearman[0].toFixed(2)} to {audit.spearman[1].toFixed(2)}), but the level moves, from{' '}
                {Math.abs(audit.levelShift[0]).toFixed(1)} lower to {audit.levelShift[1].toFixed(1)} higher on the scale of 5.
                Read these charts for order more than for level.
              </li>
              <li>
                <b>The script is a screen, not a verdict.</b> By eye, {of(audit.eye.flagged)} pages it flagged were unfit,
                and so were {of(audit.eye.unflagged)} it passed. If you read one of these languages, reading the pages we
                left out and the ones we kept is a check we cannot yet make ourselves:{' '}
                <a href="#take-part" className={LINK}>take part</a>.
              </li>
            </ul>
            <Source>
              <A href={audit.writeup}>The write-up</A> (<IssueLink num={audit.issue} />), with the verdict for each chart;
              figures read from <A href={`${BLOB}${audit.files.summary}`}>summary.json</A>; the pages left out and why,{' '}
              <A href={`${BLOB}${audit.files.drops}`}>drops.json</A>; the {audit.eye.pages} readings by eye,{' '}
              <A href={`${BLOB}${audit.files.eye}`}>eye.json</A>.
            </Source>
          </div>

          <Sub>Running now</Sub>
          <ul className="space-y-2 text-stone-700 leading-relaxed">
            {running.map((r, i) => (
              <li key={`${r.n}-${i}`} className="grid grid-cols-[4.5rem_1fr] gap-x-3">
                <IssueLink num={r.n} />
                <span>{r.title}</span>
              </li>
            ))}
          </ul>

          <Sub>Next</Sub>
          <ul className="space-y-2 text-stone-700 leading-relaxed">
            {planned.map((r, i) => (
              <li key={`${r.n}-${i}`} className="grid grid-cols-[4.5rem_1fr] gap-x-3">
                <IssueLink num={r.n} />
                <span>{r.title}</span>
              </li>
            ))}
          </ul>
          <Source>
            From <A href="/research/quality/open">Open quality work</A> (status as of {OPEN_WORK_AS_OF}), which also lists
            the known defects and what has already changed.
          </Source>

          <Sub>Finished: {n(experiments.length)} write-ups, newest first</Sub>
          <ul>
            {experiments.slice(0, SHOWN).map(e => (
              <li key={e.file} className="py-3 border-b border-stone-200">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-xs text-stone-500 tabular-nums whitespace-nowrap">{e.date}</span>
                  <a href={e.href} className="text-stone-900 font-semibold hover:text-amber-800">{e.question}</a>
                  {e.status && <span className="text-xs text-stone-500 whitespace-nowrap">{STATUS_LABEL[e.status]}</span>}
                </div>
                {e.headline && <p className="text-stone-700 text-[0.95rem] leading-relaxed mt-1">{e.headline}</p>}
                {e.issues.length > 0 && (
                  <p className="text-xs mt-1 space-x-2">
                    {e.issues.filter((v, i, a) => a.indexOf(v) === i).map(num => <IssueLink key={num} num={num} />)}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {experiments.length > SHOWN && (
            <details className="mt-4">
              <summary className="cursor-pointer text-amber-800 hover:underline text-sm">All {n(experiments.length)} write-ups</summary>
              <ul className="mt-3 text-sm">
                {experiments.slice(SHOWN).map(e => (
                  <li key={e.file} className="py-1.5 border-b border-stone-100 flex flex-wrap gap-x-3">
                    <span className="text-xs text-stone-500 tabular-nums whitespace-nowrap">{e.date}</span>
                    <a href={e.href} className="text-stone-700 hover:text-amber-800">{e.question}</a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Source>
            Read from <A href={`${GH}tree/main/scripts/eval/experiments`}>scripts/eval/experiments/</A>, one file per
            experiment. The line under a title is the write-up&rsquo;s own one-line verdict. A write-up that a later run
            replaced is left off this list and kept in the log.
          </Source>
        </Section>

        {/* ── 4. What readers have told us ── */}
        <Section id="readers" title="What readers have told us">
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            Between {longDate(feedback.window!.first)} and {longDate(feedback.window!.last)} readers sent{' '}
            {n(feedback.reader_reports)} messages through the Feedback button. {n(feedback.themed_reports)} of them were about
            the text itself, and they fall into the themes below. People who write to us choose to, and many write about the
            same few books, so these counts show what readers notice, not how often a fault occurs.
          </p>
          <ul>
            {feedback.themes.map((t: Theme) => (
              <li key={t.id} className="py-4 border-b border-stone-200">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="font-semibold text-stone-900">{t.label}</h3>
                  <Status status={t.status} />
                </div>
                <p className="text-sm text-stone-500 mt-1">
                  {n(t.reports)} {t.reports === 1 ? 'report' : 'reports'} about {n(t.books)} {t.books === 1 ? 'book' : 'books'};{' '}
                  {n(t.marked_done)} marked done.
                </p>
                <p className="text-stone-700 leading-relaxed mt-2">
                  <span className="text-stone-500">A typical report, in our words:</span> {t.paraphrase}
                </p>
                <p className="text-stone-700 leading-relaxed mt-1">
                  <span className="text-stone-500">What we did:</span> {t.did}
                  {t.issues.length > 0 && <> {t.issues.map((num: number) => <span key={num} className="mr-2"><IssueLink num={num} /></span>)}</>}
                </p>
              </li>
            ))}
          </ul>
          <Source>
            <A href={`${BLOB}src/data/quality-feedback-themes.json`}>src/data/quality-feedback-themes.json</A>, generated{' '}
            {longDate(feedback.generated_on)} by <A href={`${BLOB}${feedback.script}`}>{feedback.script}</A>. Method: {feedback.method}{' '}
            The examples are written by us, not quoted, and nothing that identifies a reader is kept in the file.{' '}
            {feedback.agent_reports_not_themed > 0 && (
              <>A further {n(feedback.agent_reports_not_themed)} reports sent by AI assistants through our public tool are not included.</>
            )}
          </Source>
        </Section>

        {/* ── 5. Take part ── */}
        <Section id="take-part" title="Take part">
          <p className="leading-relaxed mb-4 max-w-3xl">
            The book above improved because someone read it closely and wrote in it. Readers here do the same: they find
            what no measurement catches, a page shifted against its scan, a reversed sentence, a wrong date. Their notes
            become part of the page.
          </p>

          <Figure
            title="A reader's note, and where yours would go"
            caption={
              <>
                First, the foot of the leaf above. As we read the hand: <i>De ea Endelechia plura doctissimus Budeus in libro
                de Asse primo</i>, &ldquo;more on this <i>endelechia</i> in the most learned Budé, in the first book of{' '}
                <i>De Asse</i>&rdquo;. Beside it, blank paper from the same page. No reader has yet left a note here that we may
                show with their name; when one does, and agrees, it will stand in that margin.
              </>
            }
          >
            <div className="grid gap-4 sm:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] sm:items-start">
              <Crop box={LEAF.note} alt="A line of ink handwriting at the foot of the printed page." />
              <div className="relative max-w-[12rem] sm:max-w-none">
                <Crop box={LEAF.margin} alt="Blank paper from the margin of the same page." />
                <div className="absolute inset-3 border border-dashed border-stone-500/60 flex items-center justify-center p-3">
                  <span className="text-sm text-stone-600 text-center leading-snug">Your note would go here</span>
                </div>
              </div>
            </div>
          </Figure>

          <p className="leading-relaxed mb-4 max-w-3xl">Here is what you can do now, and what each leaves behind.</p>
          <ul>
            {WAYS.filter(w => !w.planned).map(w => (
              <li key={w.name} className="py-4 border-b border-stone-200 md:grid md:grid-cols-[12rem_1fr] md:gap-x-6">
                <div className="font-semibold text-stone-900 mb-1">
                  {w.name}
                  {w.door && (
                    <div className="mt-1 text-sm font-normal">
                      <A href={w.door.href}>{w.door.label} &rarr;</A>
                    </div>
                  )}
                </div>
                <div className="text-stone-700 leading-relaxed">
                  <p>{w.what}</p>
                  <p className="mt-1"><span className="text-stone-500">What it leaves behind:</span> {w.leaves}</p>
                </div>
              </li>
            ))}
          </ul>

          <Sub>Planned, not built yet</Sub>
          <ul>
            {WAYS.filter(w => w.planned).map(w => (
              <li key={w.name} className="py-3 border-b border-stone-200 md:grid md:grid-cols-[12rem_1fr] md:gap-x-6">
                <div className="font-semibold text-stone-900 mb-1">{w.name}</div>
                <div className="text-stone-700 leading-relaxed">
                  <p>{w.what}</p>
                  <p className="mt-1"><span className="text-stone-500">What it would leave behind:</span> {w.leaves}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── Further reading ── */}
        <Section id="further" title="Further reading">
          <ul className="space-y-2 text-stone-700 leading-relaxed">
            <li><A href="/research/quality">How page quality is measured</A>: the working paper behind these figures, with methods and intervals.</li>
            <li><A href="/research/quality/open">Open quality work</A>: known defects, work in progress and what has changed, each linked to its issue.</li>
            <li><A href="/research/canon-quality">How we check each canon</A>: per canon, what checks the text and the English.</li>
            <li><A href="/research/canon-gap">The canon gap</A>: how much of each canon we hold, transcribe and translate.</li>
            <li><A href="/research/page-errors">What goes wrong on a page</A>: the kinds of error we look for, with examples.</li>
            <li><A href="/about/models">AI models</A>: which models read and translate the pages.</li>
            <li><A href="/about/progress">Progress</A>: how much of the library is transcribed and translated.</li>
            <li><A href={`${GH}tree/main/scripts/eval/experiments`}>The experiment write-ups on GitHub</A>, and the <A href={`${GH}issues`}>public issue tracker</A>.</li>
          </ul>
        </Section>
      </article>
    </ContentPageLayout>
  );
}
