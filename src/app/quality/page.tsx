import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import byLanguage from '@/data/quality-by-language.json';
import ocrEvidence from '@/data/ocr-benchmark-evidence.json';
import feedback from '@/data/quality-feedback-themes.json';
import { listExperiments, latestCanonStatus, typedPages } from '@/lib/quality-center';
import { AS_OF as OPEN_WORK_AS_OF, GROUPS } from '../research/quality/open/issues';
import { MONTH_NOTE, PROSE_AS_OF, WAYS } from './content';

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

type Theme = (typeof feedback.themes)[number];
const STATUS_STYLE: Record<string, string> = {
  fixed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'in progress': 'bg-amber-50 text-amber-800 border-amber-200',
  'not yet': 'bg-stone-100 text-stone-600 border-stone-200',
};

/* ── small pieces ── */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-14 scroll-mt-24">
      <h2 className="text-2xl md:text-3xl font-serif text-primary mb-4 border-t-2 border-stone-800 pt-4 text-balance">{title}</h2>
      {children}
    </section>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="font-serif text-xl text-primary mt-8 mb-3">{children}</h3>;
}

function Source({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted leading-relaxed mt-3">{children}</p>;
}

function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = 'text-accent-rust hover:underline';
  return href.startsWith('/') ? <Link href={href} className={cls}>{children}</Link> : <a href={href} className={cls}>{children}</a>;
}

function IssueLink({ num }: { num: number }) {
  return <a href={`${ISSUE}${num}`} className="font-mono text-sm text-accent-rust hover:underline whitespace-nowrap">#{num}</a>;
}

function Chip({ status }: { status: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${STATUS_STYLE[status] ?? STATUS_STYLE['not yet']}`}>
      {status}
    </span>
  );
}

const th = 'text-left font-semibold text-muted text-xs uppercase tracking-wider px-3 py-2 border-b border-stone-300 align-bottom';
const td = 'px-3 py-2 border-b border-stone-200 align-top tabular-nums';

/* ── page ── */

export default function QualityCenterPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Quality Center"
          subtitle="How good our transcriptions and translations are, how we know, what we are doing about it, and how you can take part"
        >
          <p className="text-stone-400 text-sm mt-4">
            Text as of {longDate(PROSE_AS_OF)}. Figures and lists are read from the library&rsquo;s data files each time the site is built.
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="max-w-4xl">
        <p className="text-secondary leading-relaxed mb-4 max-w-3xl">
          Almost every page in Source Library was transcribed and translated by a machine. This page says how good that text
          is, where we have not measured it, and what is known to be wrong. It lists the experiments we have run and are
          running, what readers have reported to us, and the ways you can help.
        </p>
        <nav aria-label="On this page" className="text-sm text-muted mb-12 flex flex-wrap gap-x-5 gap-y-1">
          <a href="#stands" className="hover:text-accent-rust">Where quality stands</a>
          <a href="#experiments" className="hover:text-accent-rust">Experiments</a>
          <a href="#readers" className="hover:text-accent-rust">What readers have told us</a>
          <a href="#take-part" className="hover:text-accent-rust">Take part</a>
          <a href="#further" className="hover:text-accent-rust">Further reading</a>
        </nav>

        {/* ── 1. Where quality stands ── */}
        <Section id="stands" title="Where quality stands">
          <p className="text-secondary leading-relaxed mb-4 max-w-3xl">
            A page can go wrong in two places: the transcription can misread the scan, and the English can misread the
            transcription. We measure each against published texts where they exist. A score from a model judge is a
            model&rsquo;s opinion, not a person&rsquo;s, and the table says which is which.
          </p>

          <Sub>By language</Sub>
          <p className="md:hidden text-xs text-muted mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[680px] w-full text-sm text-secondary">
              <thead>
                <tr>
                  <th className={th}>Language</th>
                  <th className={th}>Share of English pages</th>
                  <th className={th}>Transcription: median character error against a published text</th>
                  <th className={th}>English rated 4 or 5 of 5 by a model judge</th>
                  <th className={th}>English against a published translation: pages at 4 or 5 of 5</th>
                  <th className={th}>Checked by a person who reads it</th>
                </tr>
              </thead>
              <tbody>
                {languages.map(({ language, row, fid }) => {
                  const ocr = row?.ocr?.current;
                  const tr = row?.translation;
                  return (
                    <tr key={language}>
                      <td className={`${td} font-semibold text-primary`}>{language}</td>
                      <td className={td}>{row ? `${row.share_of_translated_pages}%` : <span className="text-muted">—</span>}</td>
                      <td className={td}>
                        {ocr?.median_cer != null ? (
                          <>{pct(ocr.median_cer, 1)} <span className="text-muted text-xs">({ocr.pages_scored} pages)</span></>
                        ) : (
                          <span className="text-muted">{row ? 'not measured' : '—'}</span>
                        )}
                      </td>
                      <td className={td}>
                        {tr ? <>{pct(tr.share)} <span className="text-muted text-xs">({tr.books} books)</span></> : <span className="text-muted">—</span>}
                      </td>
                      <td className={td}>
                        {fid?.share_ge4 != null ? (
                          <>{pct(fid.share_ge4)} <span className="text-muted text-xs">({fid.n} pages)</span></>
                        ) : (
                          <span className="text-muted">not measured</span>
                        )}
                      </td>
                      <td className={td}>
                        {(row?.readers?.answers ?? 0) > 0 ? `${row!.readers.answers} answers` : <span className="text-muted">not yet</span>}
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
            Published-translation column: the <code>translation_fidelity</code> cells of{' '}
            <A href={`${BLOB}src/data/ocr-benchmark-evidence.json`}>src/data/ocr-benchmark-evidence.json</A>
            {fidelityRun && <> (run {fidelityRun}{fidelityIssue && <>, <IssueLink num={fidelityIssue} /></>})</>}: one page per book,
            two blind model judges comparing our English with a published human translation of the same page. Methods and
            intervals: <A href="/research/quality">How page quality is measured</A>.
          </Source>

          <Sub>What we have not measured, and what is known to be wrong</Sub>
          <ul className="list-disc pl-5 space-y-2 text-secondary leading-relaxed max-w-3xl">
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
          <p className="text-secondary leading-relaxed mb-4 max-w-3xl">
            For some canons the text beside the scan was typed by people (an open e-text edition aligned page by page to our
            scans) rather than read by a machine. Those pages can still carry errors of alignment, but not misreadings.
          </p>
          <p className="md:hidden text-xs text-muted mb-2">The table scrolls sideways.</p>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <table className="min-w-[560px] w-full text-sm text-secondary">
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
                      <td className={`${td} font-semibold text-primary`}>{t.name}</td>
                      <td className={td}>{n(t.books)}</td>
                      <td className={td}>
                        {n(t.pages_transcribed)} <span className="text-muted text-xs">of {n(t.pages_scanned)}</span>
                      </td>
                      <td className={td}>
                        {t.pages_transcribed > 0 ? (typed > 0 ? `${share(typed, t.pages_transcribed)} (${n(typed)} pages)` : 'none') : <span className="text-muted">—</span>}
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
          <p className="text-secondary leading-relaxed mb-4 max-w-3xl">
            The quality figures above come from experiments, and each experiment has a written record: the question, how
            it was run, the result, and the decision it led to. Null results and retractions are recorded too.
          </p>

          {MONTH_NOTE && (
            <>
              <Sub>What changed this month ({MONTH_NOTE.as_of})</Sub>
              <p className="text-secondary leading-relaxed mb-4 max-w-3xl">{MONTH_NOTE.text}</p>
            </>
          )}

          <Sub>Running now</Sub>
          <ul className="space-y-2 text-secondary leading-relaxed">
            {running.map((r, i) => (
              <li key={`${r.n}-${i}`} className="grid grid-cols-[4.5rem_1fr] gap-x-3">
                <IssueLink num={r.n} />
                <span>{r.title}</span>
              </li>
            ))}
          </ul>

          <Sub>Next</Sub>
          <ul className="space-y-2 text-secondary leading-relaxed">
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
                  <span className="text-xs text-muted tabular-nums whitespace-nowrap">{e.date}</span>
                  <a href={e.href} className="text-primary font-semibold hover:text-accent-rust">{e.question}</a>
                  {e.status && <span className="text-xs text-muted whitespace-nowrap">{STATUS_LABEL[e.status]}</span>}
                </div>
                {e.headline && <p className="text-secondary text-[0.95rem] leading-relaxed mt-1">{e.headline}</p>}
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
              <summary className="cursor-pointer text-accent-rust hover:underline text-sm">All {n(experiments.length)} write-ups</summary>
              <ul className="mt-3 text-sm">
                {experiments.slice(SHOWN).map(e => (
                  <li key={e.file} className="py-1.5 border-b border-stone-100 flex flex-wrap gap-x-3">
                    <span className="text-xs text-muted tabular-nums whitespace-nowrap">{e.date}</span>
                    <a href={e.href} className="text-secondary hover:text-accent-rust">{e.question}</a>
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
          <p className="text-secondary leading-relaxed mb-4 max-w-3xl">
            Between {longDate(feedback.window!.first)} and {longDate(feedback.window!.last)} readers sent{' '}
            {n(feedback.reader_reports)} messages through the Feedback button. {n(feedback.themed_reports)} of them were about
            the text itself, and they fall into the themes below. People who write to us choose to, and many write about the
            same few books, so these counts show what readers notice, not how often a fault occurs.
          </p>
          <ul>
            {feedback.themes.map((t: Theme) => (
              <li key={t.id} className="py-4 border-b border-stone-200">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="font-semibold text-primary">{t.label}</h3>
                  <Chip status={t.status} />
                </div>
                <p className="text-sm text-muted mt-1">
                  {n(t.reports)} {t.reports === 1 ? 'report' : 'reports'} about {n(t.books)} {t.books === 1 ? 'book' : 'books'};{' '}
                  {n(t.marked_done)} marked done.
                </p>
                <p className="text-secondary leading-relaxed mt-2">
                  <span className="text-muted">A typical report, in our words:</span> {t.paraphrase}
                </p>
                <p className="text-secondary leading-relaxed mt-1">
                  <span className="text-muted">What we did:</span> {t.did}
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
          <p className="text-secondary leading-relaxed mb-4 max-w-3xl">
            Readers find what no measurement catches: a page shifted against its scan, a reversed sentence, a wrong date.
            Here is what you can do now, and what each leaves behind.
          </p>
          <ul>
            {WAYS.filter(w => !w.planned).map(w => (
              <li key={w.name} className="py-4 border-b border-stone-200 md:grid md:grid-cols-[12rem_1fr] md:gap-x-6">
                <div className="font-semibold text-primary mb-1">
                  {w.name}
                  {w.door && (
                    <div className="mt-1 text-sm font-normal">
                      <A href={w.door.href}>{w.door.label} &rarr;</A>
                    </div>
                  )}
                </div>
                <div className="text-secondary leading-relaxed">
                  <p>{w.what}</p>
                  <p className="mt-1"><span className="text-muted">What it leaves behind:</span> {w.leaves}</p>
                </div>
              </li>
            ))}
          </ul>

          <Sub>Planned, not built yet</Sub>
          <ul>
            {WAYS.filter(w => w.planned).map(w => (
              <li key={w.name} className="py-3 border-b border-stone-200 md:grid md:grid-cols-[12rem_1fr] md:gap-x-6">
                <div className="font-semibold text-primary mb-1">{w.name}</div>
                <div className="text-secondary leading-relaxed">
                  <p>{w.what}</p>
                  <p className="mt-1"><span className="text-muted">What it would leave behind:</span> {w.leaves}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── Further reading ── */}
        <Section id="further" title="Further reading">
          <ul className="space-y-2 text-secondary leading-relaxed">
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
