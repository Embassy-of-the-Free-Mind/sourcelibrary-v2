import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import byLanguage from '@/data/quality-by-language.json';
import ocrEvidence from '@/data/ocr-benchmark-evidence.json';
import feedback from '@/data/quality-feedback-themes.json';
import ocrRouting from '../../../scripts/lib/ocr-routing-table.json';
import { EXPERIMENTS } from '@/lib/experiments-index';
import { listExperiments, latestCanonStatus, sampleAudit, typedPages, type DropReason, type Of } from '@/lib/quality-center';
import { AS_OF as OPEN_WORK_AS_OF, GROUPS } from '../research/quality/open/issues';
import { GRADES, LEAF, leafHref, MONTH_NOTE, PROSE_AS_OF, WAYS, WORKED_FIX } from './content';
import ParetoCharts, { RosterLine, TRANSLATION } from './ParetoCharts';

// The Quality Center (#5918): where text quality stands, what we are doing about it, and how
// people take part. Every number and list is read at build time from files committed on main
// (see the source line under each part); the prose carries PROSE_AS_OF, and
// scripts/audit/quality-center-freshness.mjs flags it when the experiments move on without it.
// No request-time fetch, so nothing can fail at runtime and freeze a fallback; the page changes
// when a deploy rebuilds it.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Quality Center | Source Library',
  description:
    'How good the transcriptions and translations in Source Library are, by language and by canon; what we have not measured; the experiments behind the figures; what readers have reported; and how to take part.',
  alternates: { canonical: '/quality' },
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
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight text-stone-900 mb-5">Quality Center</h1>
          <p className="font-body text-lg text-stone-700 leading-relaxed mb-6">
            Every page here was read by a machine first. This is where we show how good that reading is, what we are doing
            to improve it, and how you can help.
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

          <Sub>By language</Sub>
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
            Published-translation column: the <code>translation_fidelity</code> cells of{' '}
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
            words left out or added, another page&rsquo;s text, or a misread that changes the sense. Routes we measured but
            do not use yet are listed with the route in use. We also checked {pageCheck.by_eye_agreement.of} of these texts by
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
            <A href={`${BLOB}scripts/eval/experiments/${pageCheck.writeup}`}>the route-judge pilot</A>; cost and acceptance per
            route: <A href={`${BLOB}${pageCheck.router_table}`}>the router table of {longDate(pageCheck.date)}</A>{' '}
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

          <Sub>How a page will be graded, and which pages we check</Sub>
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
            None of this has run yet. The first graded round, and a check of the grades by people who read each language,
            come before any grade replaces the figures above.
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

        {/* ── 2. Experiments ── */}
        <Section id="experiments" title="Experiments">
          <p className="text-stone-700 leading-relaxed mb-4 max-w-3xl">
            The quality figures above come from experiments, and each experiment has a written record: the question, how
            it was run, the result, and the decision it led to. Null results and retractions are recorded too.
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
              we cannot run are drawn hollow and never named as the one to run.
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

        {/* ── 3. What readers have told us ── */}
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

        {/* ── 4. Take part ── */}
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
