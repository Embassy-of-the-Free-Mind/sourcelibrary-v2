import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import byLanguage from '@/data/quality-by-language.json';
import ocrEvidence from '@/data/ocr-benchmark-evidence.json';
import feedback from '@/data/quality-feedback-themes.json';
import { listExperiments, latestCanonStatus, typedPages } from '@/lib/quality-center';
import { AS_OF as OPEN_WORK_AS_OF, GROUPS } from '../research/quality/open/issues';
import { LEAF, leafHref, PROSE_AS_OF, WAYS } from './content';

// The Quality Center (#5918): where text quality stands, what we are doing about it, and how
// people take part. Every number and list is read at build time from files committed on main
// (see the source line under each part); the prose carries PROSE_AS_OF, and
// scripts/audit/quality-center-freshness.mjs flags it when the experiments move on without it.
// No request-time fetch, so nothing can fail at runtime and freeze a fallback; the page changes
// when a deploy rebuilds it.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'Quality Center — Source Library',
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
  ['long_s_as_f', 'ſ read as f'],
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
const SHOWN = 12;

const canon = latestCanonStatus();

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
          <p className="text-lg text-stone-700 leading-relaxed mb-6">
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
      <article className="max-w-4xl text-stone-700">
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
              <Crop box={LEAF.line} alt="The end of one printed line: natio. Quisquilias. i. vilissimas et abiectissimas, then an abbreviated word broken at the line end." />
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
                      <td className={td}>{row ? `${row.share_of_translated_pages}%` : <span className="text-stone-500">—</span>}</td>
                      <td className={td}>
                        {ocr?.median_cer != null ? (
                          <>{pct(ocr.median_cer, 1)} <span className="text-stone-500 text-xs">({ocr.pages_scored} pages)</span></>
                        ) : (
                          <span className="text-stone-500">{row ? 'not measured' : '—'}</span>
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
                          <span className="text-stone-500">{ocr?.median_cer != null ? 'not broken down' : '—'}</span>
                        )}
                      </td>
                      <td className={td}>
                        {tr ? <>{pct(tr.share)} <span className="text-stone-500 text-xs">({tr.books} books)</span></> : <span className="text-stone-500">—</span>}
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
            {caveats.map(r => (
              <li key={r.language}>
                {r.language} &mdash; {r.caveat!.text}
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
                        {t.pages_transcribed > 0 ? (typed > 0 ? `${share(typed, t.pages_transcribed)} (${n(typed)} pages)` : 'none') : <span className="text-stone-500">—</span>}
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
            experiment. The line under a title is the write-up&rsquo;s own answer, where it states one in a sentence.
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
                Left: the foot of the leaf above. As we read the hand: <i>De ea Endelechia plura doctissimus Budeus in libro
                de Asse primo</i>, &ldquo;more on this <i>endelechia</i> in the most learned Budé, in the first book of{' '}
                <i>De Asse</i>&rdquo;. Right: blank paper from the same page. No reader has yet left a note here that we may
                show with their name; when one does, and agrees, it will stand in that margin.
              </>
            }
          >
            <div className="grid gap-4 sm:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] sm:items-start">
              <Crop box={LEAF.note} alt="A line of ink handwriting at the foot of the printed page." />
              <div className="relative">
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
