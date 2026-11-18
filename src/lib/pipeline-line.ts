/**
 * PRIOR ART: src/lib/pipeline-now.ts — what RUNS, grouped by box, and only the cron lines whose script name matches
 * a pusher stage rule. src/lib/pipeline-next-report.ts — the work LEFT, for five steps. scripts/lib/stage-coverage.mjs
 * (rendered at /platform/admin/line) — stock for eight stages, with no runners. Each answers one question for some
 * stages; none lists every stage a book passes through in order, so split, picture extraction and first-translation
 * search appear on none of them as a stage (v3#421).
 *
 * The stage list was first written from those three reports, so it left out every step none of them names. v3#434
 * re-derived it from the code that does the work: each phase of scripts/workers/pipeline-orchestrator.mjs, the WORKERS
 * of scripts/workers/scheduler.mjs, the phases of enrich-worker.mjs, the seam pass in the translation lane, and the
 * cron lines each box reports. When one of those gains a step, it gains a row here.
 *
 * The whole line (v3#421): one row per stage from import to finished, each joined from documents that are already
 * written. Nothing here measures anything: a stage with no instrument is reported as NOT MEASURED, never left out
 * and never shown as zero.
 *
 *   stock      stage_coverage_snapshots (scripts/workers/stage-coverage-snapshot.mjs, nightly)
 *   waiting    ops_reports pipeline_next_daily (scripts/audit/pipeline-next-step-audit.mjs, daily)
 *   yesterday  ops_reports pipeline-now:corpus (pages per lane per day, hand-offs) and brief:latest
 *   runners    ops_reports pipeline-now:<box> (each box's live crontab, hourly) and cron_runs (the scheduler's log)
 *
 * buildLine() is pure; getLineInputs() does the reads (small collections, one indexed 24 h window on cron_runs).
 */
import { getDb } from '@/lib/mongodb';
import { getPipelineNow, type CronLine, type DayRow, type PipelineNow } from '@/lib/pipeline-now';
import type { PipelineNextReport, Work } from '@/lib/pipeline-next-report';

export interface CoverageStage {
  stage: string;
  status: 'ok' | 'probe_broken';
  covered: number | null;
  total: number | null;
  queue_depth: number | null;
  delta?: number | null;
  /** A flow stage (#428): what moved on the last full UTC day, with its parts. */
  per_day?: { day: string; n: number; parts?: { label: string; n: number }[] } | null;
  /** Figures that ride beside `covered`, of the same total (#428). */
  also?: { label: string; n: number }[];
  /** The visible books in `queue_depth`, when the queue counts hidden books too (#428). */
  queue_visible?: number | null;
  /** false: kept out of the STALLED detector (#428). */
  stall_watch?: boolean;
  /** A sampled stage (#428): when the sample was drawn. `total` is then the sample size, and the figure is not differenced. */
  sampled_at?: string;
  detail?: Record<string, number | string | null>;
}
export interface CoverageSnapshot { timestamp: Date | string; stages: CoverageStage[]; stalled?: string[] }

/** The "fine" part of the morning brief (scripts/maintenance/situation.mjs --brief --push, v3#404). All optional. */
export interface BriefFine { day?: string; qa_books?: number; qa_last?: string; done_books?: number; done_delta?: number }

/** One scheduler or worker name in cron_runs over the last 24 h, by outcome. */
export interface RunLog { cron: string; runs: number; skipped: number; failed: number; last: Date | string | null; last_summary: string | null }

export interface LineInputs {
  /** Newest first. The first is "now"; the rest give the change over about a week. */
  coverage: CoverageSnapshot[];
  next: PipelineNextReport | null;
  now: PipelineNow | null;
  fine: BriefFine | null;
  /** When brief:latest was pushed: the books checked and books finished figures are that old. */
  briefAt?: Date | string | null;
  runs: RunLog[];
}

export type LineFlag = 'STALLED' | 'NOT MEASURED' | 'NOTHING SCHEDULED' | 'PROBE BROKEN' | 'RED LINE' | 'RUNS, DOES NOTHING';

export interface LineRunner { box: string; line: CronLine }
export interface LineRow {
  key: string;
  label: string;
  /** What the stage does to a book, in one plain sentence. */
  what: string;
  /**
   * How much is done. null when nothing stored measures it (`doneNote` says what is missing), or for a flow stage,
   * which is counted per day under `yesterday`. `total` is null for a count with no denominator (books held as copies).
   */
  done: { covered: number; total: number | null; unit: string; of: string; also: { label: string; n: number }[] } | null;
  doneNote: string | null;
  /** Visible books whose NEXT step is this stage, and the pages that step still owes. */
  waiting: { books: number; pages: number | null; allBooks: number } | null;
  /** What moved on the last full UTC day (or last night, for a nightly snapshot). */
  yesterday: { n: number; unit: string; when: string; parts: { label: string; n: number }[] } | null;
  /** Change in `done.covered` since the oldest readable snapshot in the window. */
  week: { n: number; since: string } | null;
  runners: LineRunner[];
  /** Scheduler workers that serve this stage, from cron_runs (they are not cron lines, so no box reports them). */
  runs: RunLog[];
  /** The job this step runs inside, when it has no cron line of its own (an orchestrator phase, a pass in a lane). */
  inside: string | null;
  /** True for a step made only when someone asks. It is shown apart from the line and is never called unmeasured. */
  onRequest: boolean;
  flags: { flag: LineFlag; why: string }[];
  /**
   * Scheduler workers that skipped every run while something else did the stage's work (v3#453): the paid-API
   * generation refused at the $0 dial beside the subscription lane that replaced it. Said beside the runners, not as a flag.
   */
  idle: string[];
  more: { href: string; label: string }[];
}

export interface Line {
  rows: LineRow[];
  /** Live cron lines that serve no stage above (audits, snapshots, the scheduler itself), so none is hidden. */
  other: LineRunner[];
  /** Visible books a hold keeps out of every lane, of all visible books with pages. */
  held: { books: number; of: number; allBooks: number } | null;
  sources: { label: string; at: string | null; staleAfterMin: number }[];
  /** False when a box's report is missing: its cron lines are unknown, so no stage is called unscheduled. */
  runnersRead: boolean;
}

type Match = (script: string, line: CronLine) => boolean;
interface StageSpec {
  key: string;
  label: string;
  what: string;
  /**
   * stage_coverage_snapshots stage, with the words for its unit and denominator. A flow stage (`per_day` in the
   * snapshot) has no stock: `of` then says what the per-day figure counts. `alsoFrom` shows another stage's covered
   * figure beside the stock (picture extraction: books searched, and the pictures cut out from them).
   */
  coverage?: { stage: string; unit: string; of: string; alsoFrom?: { stage: string; label: string } };
  /** pipeline_next_daily step, and which page count is the work that step owes. */
  next?: { step: string; pages: keyof Work | null };
  lines?: Match;
  /** cron_runs names of the scheduler workers that serve this stage. */
  runNames?: string[];
  /**
   * One sentence naming the job the step runs inside, for a step with no cron line of its own. It describes the code
   * (which phase, which lane), never whether it ran: the run log beside it says that.
   */
  inside?: string;
  /** A step not every book gets: made when a reader or a person asks (v3#446). Listed after the line, in its own group. */
  onRequest?: boolean;
  /** Said in place of a stock figure when nothing stored measures the stage. */
  unmeasured?: string;
  more: { href: string; label: string }[];
}

const FT_EVIDENCE = /audit-translation-claims|discover-translations|search-translation-evidence|validate-translation-evidence/;
const QA_READS = /paired-fifths|lane-judge|new-translation-leaks|convergent-audit|monthly-draw|page-integrity-draw|mark-stale|withhold-stale/;
const ENRICH_WORKER = /enrich-worker/;
const PICTURES = /extract-images|image-extract|generate-thumbnails/;
const READER_IMAGES = /backfill-display-images/;
/** The scheduler's page-image archivers, which also run from crontab lines no stage rule names. */
const ARCHIVE_WORKERS = /^archive-(?:bulk|ocr)\./;
/** The display-image mark: its bake, the watchdog that keeps the backfill alive, and the weekly keyed-detector audit. */
const MARKS = /bake-provenance-mark|backfill-marks|image-provenance-coverage/;
const DEEPZOOM = /deepzoom/;
const DUPES = /pre-ocr-dupe-screen|dedup-ia-trailing/;
/** "cover" as a word of the script name: backfill-cover-cards, audit-covers; not archive-coverage or discover-translations. */
const COVER = /(?:^|-)covers?(?:-|\.)/;
const SEARCH_COPY = /sync-pages-content|sync-worker/;
/** enrich-worker phases 7.5 (quality score) and 7.6 (collections), when a cron line runs them alone. */
const isScoring = (l: CronLine) => l.flags.some(f => /^--phase=7\.[56]$/.test(f));
/** The orchestrator line that runs phase 8.9 (cover selection) on its way to phase 9 (finalize). */
const isFinalize = (s: string, l: CronLine) => /pipeline-orchestrator/.test(s) && l.flags.includes('--phase=9');

/** cron_runs name of the orchestrator the scheduler launches. A row that names it shows the orchestrator ran, not which phase did work. */
const ORCHESTRATOR = 'pipeline-orchestrator-worker';

const NOW = { href: '/admin/pipeline/now', label: 'lanes by box' };
const LEFT = { href: '#work-left', label: 'work left' };
const COVERAGE = { href: '/platform/admin/line', label: 'coverage history' };

/**
 * The stages in the order a book meets them. A cron line belongs to the FIRST stage whose `lines` accepts it, so the
 * narrower stages (first-translation evidence, picture extraction) come before the stage rule that would swallow them.
 * The steps made only on request come last: they have no place in the order, and the page lists them apart.
 */
export const LINE_STAGES: StageSpec[] = [
  { key: 'import', label: 'Import', what: 'A book enters hidden through the acquisition gate, with its catalogue record.',
    coverage: { stage: 'imported', unit: 'records', of: 'book and artwork records created on the day, hidden ones included' },
    lines: (s, l) => l.stage === 'import' && /acquire|harvest/.test(s), more: [NOW, COVERAGE] },
  { key: 'archive', label: 'Page images', what: 'Each page image is copied from the holding library to our own storage (R2).',
    coverage: { stage: 'archived', unit: 'pages', of: 'all pages, hidden books included' },
    next: { step: 'archive', pages: 'archive_pages' },
    // archive-bulk also has a crontab line on main; its name matches no stage rule, so it arrives as `other`.
    lines: (s, l) => (l.stage === 'import' && /archive/.test(s)) || ARCHIVE_WORKERS.test(s),
    runNames: ['archive-bulk', 'archive-ocr'], more: [NOW, LEFT, COVERAGE] },
  { key: 'display', label: 'Reader images', what: 'Each page image gets the smaller copies the reader and the book grids load, so a page view does not pull the full scan.',
    coverage: { stage: 'display', unit: 'sampled pages', of: 'random visible pages the weekly image audit drew, with a reader-sized copy on R2. Nothing stored counts every page' },
    lines: (s) => READER_IMAGES.test(s), runNames: ['display-backfill'], more: [COVERAGE] },
  { key: 'marks', label: 'Trithemian marks', what: 'Each reader-sized page image carries an invisible keyed mark, so a copy found elsewhere can be shown to be ours. The original scan is never marked. Text is marked as it leaves the site, not in the pipeline.',
    lines: (s) => MARKS.test(s),
    inside: 'Baked into the reader copy by bake-provenance-mark.mjs, run as a backfill on cloudlayer under backfill-marks-watchdog.sh. Whether a newly made reader copy is marked is tracked on v2#4406.',
    coverage: { stage: 'marks', unit: 'sampled pages', of: 'random served visible pages that can carry the mark, read from R2 by the weekly image audit with the keyed detector' },
    more: [COVERAGE] },
  { key: 'dupes', label: 'Repeated pages and copies', what: 'End pages an Archive scan repeats are hidden, and a queued book that is the same printing as one already read is held, before any reading is paid for.',
    lines: (s) => DUPES.test(s), runNames: [ORCHESTRATOR],
    coverage: { stage: 'copy_holds', unit: 'books', of: 'held out of OCR as the same printing as a copy we hold, hidden books included. Waiting: books phase 1.97 has not yet screened for repeated end pages' },
    inside: 'The repeated end pages are hidden by orchestrator phase 1.97; the same-printing screen has its own nightly line. The end pages phase 1.97 hides are not counted: they are marked only by a negative page number, which no index serves.',
    more: [NOW, COVERAGE] },
  { key: 'split', label: 'Split', what: 'A frame that shows two leaves becomes one page per leaf, before any reading.',
    runNames: [ORCHESTRATOR],
    coverage: { stage: 'split', unit: 'books', of: 'visible books whose spreads were cut into single leaves. Waiting: books found to be spreads and not yet cut' },
    inside: 'Orchestrator phases 1.25 (find spreads), 1.3 and 3.1 (split them). Confirming a spread is a paid model call, refused while the spend dial is shut. Frames with several manuscript leaves are split per batch, by hand.',
    more: [{ href: '/admin/pipeline/batches', label: 'batches' }, COVERAGE] },
  { key: 'catalogue', label: 'Catalogue details', what: 'Language, display title, subjects and dates are read from the title page and checked against the printed-book catalogues.',
    runNames: [ORCHESTRATOR],
    coverage: { stage: 'catalogue', unit: 'books', of: 'visible books' },
    inside: 'Orchestrator phase 1.6. It is a paid model call, refused while the spend dial is shut.',
    more: [NOW, COVERAGE] },
  { key: 'ocr', label: 'OCR', what: 'Each page image is read into text in its own language, on the route its router cell names.',
    coverage: { stage: 'ocr', unit: 'pages', of: 'all pages, hidden books included' },
    next: { step: 'ocr', pages: 'ocr_pages' },
    lines: (_s, l) => l.stage === 'ocr', more: [NOW, LEFT, { href: '/admin/router', label: 'router' }] },
  { key: 'ft', label: 'First-translation search', what: 'A search for an earlier English translation, so a book is called a first translation only with evidence.',
    coverage: { stage: 'ft_search', unit: 'books', of: 'visible books' },
    lines: (s, l) => l.stage === 'research' || FT_EVIDENCE.test(s), more: [NOW, COVERAGE] },
  { key: 'translate', label: 'Translation', what: 'Pages that are not English get an English translation.',
    coverage: { stage: 'translated', unit: 'pages', of: 'all pages that are not blank' },
    next: { step: 'translate', pages: 'translate_pages' },
    lines: (_s, l) => l.stage === 'translate', runNames: ['hetzner-translate-worker'], more: [NOW, LEFT] },
  { key: 'seams', label: 'Page joins', what: 'The sentence that runs across a page turn is checked after translation and repaired at the two page edges, so the English does not break or repeat there.',
    coverage: { stage: 'seams', unit: 'pages', of: 'pages whose page-turn edge was repaired on the day. Joins checked and left alone are not stored' },
    inside: 'A pass inside the translation lane (cli-translate-lane.mjs), for the routes whose routing-table row carries seam_pass: Latin, German and French on 2026-11-16. Each repair leaves a book_events row, translation_seam_repaired.',
    more: [NOW, { href: '/admin/router', label: 'router' }, COVERAGE] },
  { key: 'enrich', label: 'Enrichment', what: 'A summary, chapters and an index are written from the translated text.',
    coverage: { stage: 'summaries', unit: 'books', of: 'visible books' },
    next: { step: 'enrich', pages: null },
    lines: (s, l) => l.stage === 'enrich' && ENRICH_WORKER.test(s) && !isScoring(l),
    runNames: ['hetzner-enrich-worker', 'hetzner-enrich-worker-batch', 'hetzner-enrich-agy'], more: [NOW, LEFT] },
  { key: 'score', label: 'Quality score and collections', what: 'Each book gets a quality score and is placed in the collections it belongs to.',
    lines: (s, l) => ENRICH_WORKER.test(s) && isScoring(l), runNames: ['hetzner-enrich-scoring', 'hetzner-enrich-collections'],
    coverage: { stage: 'quality_score', unit: 'books', of: 'visible books' },
    inside: 'enrich-worker phases 7.5 and 7.6, launched by the scheduler as enrich-scoring and enrich-collections, each under its own run-log name.',
    more: [NOW, COVERAGE] },
  { key: 'pictures', label: 'Picture extraction', what: 'Illustrations are found on the pages and cut out for the gallery.',
    coverage: { stage: 'image_books', unit: 'books', of: 'visible books whose pages were searched for pictures',
      alsoFrom: { stage: 'images', label: 'pictures cut out for the gallery, of pictures found' } },
    next: { step: 'images', pages: null },
    lines: (s) => PICTURES.test(s), runNames: ['image-extract-worker'],
    inside: 'The scheduler\'s image-extract-worker, and orchestrator phase 8 on the Batch API (whose run log does not say which phase worked, so it is not counted here). Both are paid model calls, refused while the spend dial is shut.',
    more: [LEFT, COVERAGE] },
  { key: 'cover', label: 'Cover', what: 'The cover page is picked from the first pages, scanner notice pages are hidden, and the small cover the book grids load is made.',
    lines: (s, l) => COVER.test(s) || isFinalize(s, l), runNames: [ORCHESTRATOR],
    coverage: { stage: 'cover', unit: 'books', of: 'visible books' },
    inside: 'Orchestrator phase 8.9, which runs with the finalize line and makes no model call. The small grid cover is made by the nightly backfill-cover-cards.mjs line.',
    more: [NOW, COVERAGE] },
  { key: 'embed', label: 'Embeddings', what: 'Books, pages and pictures get the vectors that search by meaning uses.',
    coverage: { stage: 'embeddings', unit: 'books', of: 'visible books' },
    lines: (_s, l) => l.stage === 'embed', more: [NOW, COVERAGE] },
  { key: 'identity', label: 'Identity', what: 'Each book is tied to its work and its edition, so copies and translations of one text meet.',
    coverage: { stage: 'identity', unit: 'books', of: 'visible books' },
    lines: (s) => /identity-worker|mint-local-work-ids|assign-work-slugs/.test(s), runNames: ['identity-worker'], more: [COVERAGE] },
  { key: 'metadata', label: 'Places and page numbers', what: 'Authors and printing places are put on the map, printed page numbers are fitted, gallery pictures get full size.',
    coverage: { stage: 'places', unit: 'books', of: 'visible books' },
    lines: (s, l) => l.stage === 'enrich' && !ENRICH_WORKER.test(s), more: [NOW, COVERAGE] },
  { key: 'qa', label: 'Quality checks', what: 'Samples of served pages are read against the page image; stale or wrong text is marked and withheld.',
    coverage: { stage: 'book_checks', unit: 'books', of: 'visible books' },
    lines: (s, l) => l.stage === 'qc' && QA_READS.test(s),
    more: [{ href: '/admin/quality', label: 'quality' }, COVERAGE] },
  { key: 'search', label: 'Search copy', what: 'Page text and page counts are copied to the search database, so new text can be found and quoted.',
    coverage: { stage: 'search', unit: 'pages', of: 'pages copied to the search database on the day. Pages still waiting to be copied are not stored anywhere' },
    lines: (s) => SEARCH_COPY.test(s), runNames: ['sync-pages-content', 'sync-worker'], more: [COVERAGE] },
  { key: 'publish', label: 'Published', what: 'A hidden book is made visible to readers. It can happen at any point after import; the waiting counts in this table are for visible books.',
    runNames: [ORCHESTRATOR],
    coverage: { stage: 'published', unit: 'books', of: 'books made public through the publication writer on the day; a writer that sets visible directly is not counted' },
    inside: 'By hand, after checking (import-workflow.md step 6), through the publication writer. A scheduled case: orchestrator phase 1 shows a book again when it was hidden only because its page images were not yet archived.',
    more: [COVERAGE] },
  { key: 'done', label: 'Finished', what: 'Every step is done: the book is readable in English with its summary and pictures.',
    next: { step: 'done', pages: null }, more: [LEFT] },
  { key: 'translit', label: 'Transliteration', onRequest: true, what: 'A page in a script other than Latin gets a reading in Latin letters.',
    runNames: [ORCHESTRATOR],
    inside: 'Made for one page when a reader asks for it (/api/pages/[id]/transliterate). Orchestrator phase 3.7 would make it for every non-Latin book; it is a paid model call, refused while the spend dial is shut.',
    more: [] },
  { key: 'guide', label: 'Reading guide', onRequest: true, what: 'The summary, chapters and index of the Enrichment step, made first for a book a reader asks about.',
    inside: 'A reader asks with "Request a reading guide". The agy enrichment lane takes books with an open request first (v3#408).',
    more: [NOW] },
  { key: 'doi', label: 'DOI edition', onRequest: true, what: 'A fixed, citable edition of a translated book, with front matter, deposited for a DOI.',
    inside: 'By hand, one book at a time (scripts/batch/batch-mint-doi.mjs).',
    more: [] },
  { key: 'deepzoom', label: 'Deep-zoom tiles', onRequest: true, what: 'An illustrated page gets a tile pyramid from its full-size master, so a reader can zoom far in.',
    lines: (s) => DEEPZOOM.test(s),
    inside: 'By hand, one library at a time (scripts/workers/deepzoom-tile-pages.mjs).',
    more: [] },
];

const scriptName = (l: CronLine) => (l.script ?? '').split('/').pop() ?? '';
const isLive = (l: CronLine) => !l.disabled && !l.one_shot;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Pages written on `day`, per lane, largest first. */
function dayParts(rows: DayRow[] | null | undefined, day: string): { label: string; n: number }[] {
  const by = new Map<string, number>();
  for (const r of rows ?? []) if (r.day === day) by.set(r.lane, (by.get(r.lane) ?? 0) + r.pages);
  return [...by.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}

/** The whole line. Pure: every date shown comes from the documents, none from the clock. */
export function buildLine(input: LineInputs): Line {
  const [latest, ...older] = input.coverage;
  const corpus = input.now?.corpus ?? null;
  // The last full UTC day the nightly corpus document covers. Before that night's push it is the day before
  // yesterday: an older full day is shown with its date rather than a partial one as if it were whole.
  const corpusDay = corpus?.generated_at ? dayOf(new Date(Date.parse(corpus.generated_at) - 24 * 3600_000)) : null;
  const boxes = input.now?.boxes ?? [];
  const runnersRead = boxes.length > 0 && boxes.every(b => b.doc);
  const boxLines: LineRunner[] = boxes.flatMap(({ box, doc }) => (doc?.lines ?? []).map(line => ({ box, line })));
  const taken = new Set<LineRunner>();
  const step = (name: string) => input.next?.steps.find(s => s.step === name) ?? null;

  const rows: LineRow[] = LINE_STAGES.map((spec) => {
    const flags: LineRow['flags'] = [];

    // stock
    const cov = spec.coverage ? latest?.stages.find(s => s.stage === spec.coverage!.stage) ?? null : null;
    let done: LineRow['done'] = null;
    let doneNote: string | null = spec.unmeasured ?? null;
    let week: LineRow['week'] = null;
    if (spec.coverage) {
      if (!cov) doneNote = 'The nightly stage snapshot has no row for this stage.';
      else if (cov.status === 'ok' && cov.per_day && cov.covered == null) {
        // A flow: nothing to be "done of"; the figure is under Moved.
        doneNote = `A flow, counted per day under Moved: ${spec.coverage.of}.`;
      } else if (cov.status !== 'ok' || cov.covered == null) {
        doneNote = 'The nightly probe could not measure this stage. That is the monitor failing, not the stage.';
        flags.push({ flag: 'PROBE BROKEN', why: doneNote });
      } else {
        const of = cov.sampled_at ? `${spec.coverage.of} (drawn ${cov.sampled_at.slice(0, 10)})` : spec.coverage.of;
        const from = spec.coverage.alsoFrom;
        const fromCov = from ? latest?.stages.find(x => x.stage === from.stage && x.status === 'ok' && x.covered != null) : null;
        const alsoFrom = from && fromCov ? [{ label: `${from.label}${fromCov.total != null ? ` (${fromCov.total.toLocaleString('en-US')})` : ''}`, n: fromCov.covered! }] : [];
        done = { covered: cov.covered, total: cov.total ?? null, unit: spec.coverage.unit, of, also: [...(cov.also ?? []), ...alsoFrom] };
        doneNote = null;
        // Oldest snapshot in the window that could read this stage; a broken probe is skipped, never read as zero.
        const base = [...older].reverse().find(s => s.stages.some(x => x.stage === cov.stage && x.status === 'ok' && x.covered != null));
        const was = base?.stages.find(x => x.stage === cov.stage)?.covered;
        // A sample redrawn each week moves by chance: its difference is not progress.
        if (base && was != null && !cov.sampled_at) week = { n: cov.covered - was, since: dayOf(new Date(base.timestamp)) };
        if (latest?.stalled?.includes(cov.stage)) flags.push({ flag: 'STALLED', why: 'Work is waiting and the count did not move last night.' });
      }
    } else if (spec.next?.step === 'done' && input.next) {
      const d = step('done');
      if (d) { done = { covered: d.live.books, total: input.next.denominator.live, unit: 'books', of: 'visible books', also: [] }; doneNote = null; }
    }

    // waiting
    let waiting: LineRow['waiting'] = null;
    if (spec.next && spec.next.step !== 'done') {
      const s = step(spec.next.step);
      if (s) waiting = { books: s.live.books, pages: spec.next.pages ? s.live[spec.next.pages] : null, allBooks: s.all.books };
    } else if (cov?.status === 'ok' && cov.queue_depth != null && !spec.next && spec.coverage) {
      // A queue that counts hidden books says how many of them are visible; the column counts visible books.
      waiting = { books: cov.queue_visible ?? cov.queue_depth, pages: null, allBooks: cov.queue_depth };
    }

    // yesterday
    let moved: LineRow['yesterday'] = null;
    if (spec.key === 'ocr' || spec.key === 'translate') {
      // null rows mean the nightly count failed: unknown, not zero.
      const dayRows = spec.key === 'ocr' ? corpus?.ocr_per_day : corpus?.translated_per_day;
      if (dayRows && corpusDay) {
        const parts = dayParts(dayRows, corpusDay);
        moved = { n: parts.reduce((a, p) => a + p.n, 0), unit: 'pages', when: corpusDay, parts: parts.slice(0, 4) };
      }
    } else if (spec.key === 'ft') {
      const h = corpus?.handoffs_per_day?.find(d => d.day === corpusDay);
      if (h && corpusDay) moved = { n: h.ft_ingest, unit: 'books searched', when: corpusDay, parts: [] };
    } else if (spec.key === 'qa') {
      if (input.fine?.qa_books != null) moved = { n: input.fine.qa_books, unit: 'books checked', when: input.fine.day ?? 'yesterday', parts: [] };
    } else if (spec.key === 'done') {
      if (input.fine?.done_delta != null) moved = { n: input.fine.done_delta, unit: 'books', when: input.fine.day ?? 'yesterday', parts: [] };
    } else if (cov?.status === 'ok' && cov.per_day) {
      moved = { n: cov.per_day.n, unit: spec.coverage!.unit, when: cov.per_day.day, parts: cov.per_day.parts ?? [] };
    } else if (cov?.status === 'ok' && cov.delta != null && !cov.sampled_at) {
      moved = { n: cov.delta, unit: spec.coverage!.unit, when: 'last night', parts: [] };
    }

    // runners
    const runners = spec.lines
      ? boxLines.filter(r => !taken.has(r) && spec.lines!(scriptName(r.line), r.line))
      : [];
    for (const r of runners) taken.add(r);
    const runs = (spec.runNames ?? []).map(n => input.runs.find(r => r.cron === n)).filter((r): r is RunLog => !!r);

    const red = runners.filter(r => isLive(r.line) && r.line.red?.length);
    if (red.length) flags.push({ flag: 'RED LINE', why: red.map(r => `${r.box} ${scriptName(r.line)}: ${[...new Set(r.line.red!.map(x => x.flag))].join(', ')}`).join(' · ') });
    const liveRunners = runners.filter(r => isLive(r.line)).length;
    const working = runs.some(r => r.runs > r.skipped);
    // A worker that skips every run is a fault only when nothing else does the work: another run log that worked,
    // or pages or books moved on the last day, means the stage is served and the skipping worker is a leftover.
    const servedElsewhere = working || (moved?.n ?? 0) > 0;
    const idle: string[] = [];
    for (const r of runs) {
      if (r.runs === 0 || r.skipped !== r.runs) continue;
      const why = `${r.cron} ran ${r.runs} times in 24 h and skipped every time${r.last_summary ? ` (${r.last_summary})` : ''}`;
      if (servedElsewhere) idle.push(`${why}; the stage's work is done by the others listed here.`);
      else flags.push({ flag: 'RUNS, DOES NOTHING', why: `${why}.` });
    }
    // Only when every box reported: a missing report is an unread crontab, not an empty one.
    if (runnersRead && waiting && waiting.books > 0 && liveRunners === 0 && !working && spec.key !== 'done') {
      flags.push({ flag: 'NOTHING SCHEDULED', why: 'Work is waiting and no cron line or scheduler worker on any box serves this stage.' });
    }
    // A step made on request is owed to no book, so having no count is not a gap.
    if (!done && !waiting && !moved && !spec.onRequest) flags.push({ flag: 'NOT MEASURED', why: doneNote ?? 'Nothing stored measures this stage.' });

    return { key: spec.key, label: spec.label, what: spec.what, done, doneNote, waiting, yesterday: moved, week, runners, runs, inside: spec.inside ?? null, onRequest: !!spec.onRequest, flags, idle, more: spec.more };
  });

  const blocked = input.next?.step_reasons.find(r => r.step === 'blocked' && r.reason === 'held') ?? null;
  const boxAt = boxes.map(b => b.doc?.generated_at ?? null);
  return {
    rows,
    runnersRead,
    other: boxLines.filter(r => !taken.has(r) && isLive(r.line)),
    held: blocked && input.next ? { books: blocked.live.books, of: input.next.denominator.live, allBooks: blocked.all.books } : null,
    sources: [
      { label: 'stock', at: iso(latest?.timestamp), staleAfterMin: 26 * 60 },
      { label: 'waiting', at: iso(input.next?.generated_at), staleAfterMin: 26 * 60 },
      { label: 'pages per day', at: iso(input.now?.corpus?.generated_at), staleAfterMin: 26 * 60 },
      // The oldest box report: one silent box must show.
      { label: 'cron lines', at: boxAt.length && boxAt.every(Boolean) ? [...boxAt as string[]].sort()[0] : null, staleAfterMin: 150 },
      // The two cells it feeds (books checked, books finished). Pushed by situation.mjs --brief --push; until PR #412's
      // hourly line is installed on main nothing pushes it on a schedule, so the bound is a day's, not an hour's (v3#452).
      { label: 'morning brief', at: iso(input.briefAt), staleAfterMin: BRIEF_STALE_MIN },
    ],
  };
}

export type HeadlineTone = 'bad' | 'warn' | 'ok' | 'info';
export interface HeadlineItem { key: 'held' | 'finished' | 'stopped' | 'pace' | 'unmeasured'; tone: HeadlineTone; label: string; text: string }

/** Flags that mean a stage is not doing its work. */
const STOPPED: LineFlag[] = ['STALLED', 'NOTHING SCHEDULED', 'RUNS, DOES NOTHING'];
/** Flags on the instruments or the cron registry: the stage may be fine, the record of it is not. */
const FLAGGED: LineFlag[] = ['PROBE BROKEN', 'RED LINE'];

const n0 = (v: number) => Math.round(v).toLocaleString('en-US');
const share = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(a / b < 0.1 ? 1 : 0)}%` : '–');
/** Days of work at a pace, in the unit a person would say it in. */
function span(days: number): string {
  if (days < 1) return 'under a day';
  if (days < 60) return `about ${Math.round(days)} days`;
  if (days < 730) return `about ${Math.round(days / 30)} months`;
  return `about ${Math.round(days / 365)} years`;
}

/**
 * Five sentences above the table (v3#453), read from the rows already built: what holds books back, how many are
 * finished, which stages are stopped, how fast the two big stages move against what they owe, and which stages no
 * report measures. Pure, and silent about anything the rows do not hold: a missing figure drops its sentence, it is
 * never said as zero.
 */
export function buildHeadline(line: Line): HeadlineItem[] {
  const out: HeadlineItem[] = [];
  const steps = line.rows.filter(r => !r.onRequest);
  const byKey = (k: string) => steps.find(r => r.key === k);

  if (line.held) {
    out.push({ key: 'held', tone: line.held.books / Math.max(1, line.held.of) >= 0.25 ? 'bad' : 'warn', label: 'Held back',
      text: `${n0(line.held.books)} of ${n0(line.held.of)} visible books (${share(line.held.books, line.held.of)}) are kept out of every lane by a hold (${n0(line.held.allBooks)} with hidden books). No stage below touches them, and they are not in its waiting column.` });
  }

  const done = byKey('done');
  if (done?.done && done.done.total != null) {
    const { covered, total } = done.done;
    let text = `${n0(covered)} of ${n0(total)} visible books (${share(covered, total)}) have every step done.`;
    const y = done.yesterday;
    if (y) {
      const rest = total - covered;
      text += y.n > 0
        ? ` ${n0(y.n)} finished on ${y.when}; at that one day's pace the other ${n0(rest)} take ${span(rest / y.n)}.`
        : ` None finished on ${y.when}.`;
    }
    out.push({ key: 'finished', tone: 'info', label: 'Finished', text });
  }

  const named = (flagSet: LineFlag[]) => steps.filter(r => r.flags.some(f => flagSet.includes(f.flag))).map((r) => {
    const f = r.flags.find(x => flagSet.includes(x.flag))!;
    const w = r.waiting?.books ? `, ${n0(r.waiting.books)} visible books waiting` : '';
    return `${r.label} (${f.flag.toLowerCase()}${w})`;
  });
  const stopped = named(STOPPED);
  const flagged = named(FLAGGED);
  const also = flagged.length ? ` Flagged, possibly only in the record of it: ${flagged.join('; ')}.` : '';
  out.push(stopped.length
    ? { key: 'stopped', tone: 'bad', label: 'Stopped', text: `${stopped.join('; ')}.${also}` }
    : { key: 'stopped', tone: flagged.length ? 'warn' : 'ok', label: 'Stopped', text: (line.runnersRead
        ? 'No stage is stalled, unscheduled or running without effect.'
        : 'Not known: a box has not reported its cron lines, so an unscheduled stage cannot be told from an unread one.') + also });

  const pace = (['ocr', 'translate'] as const).flatMap((k) => {
    const r = byKey(k);
    if (!r?.yesterday) return [];
    const owed = r.waiting?.pages;
    const tail = r.yesterday.n > 0 && owed != null
      ? `; the ${n0(owed)} pages visible books still owe take ${span(owed / r.yesterday.n)} at that pace`
      : r.yesterday.n === 0 ? '; nothing moved' : '';
    return [`${r.label} ${n0(r.yesterday.n)} pages on ${r.yesterday.when}${tail}`];
  });
  if (pace.length) {
    out.push({ key: 'pace', tone: 'info', label: 'Moving',
      text: `${pace.join('. ')}. The day's pages include re-reads and hidden books, so the time is a floor, not a forecast.` });
  }

  const unmeasured = steps.filter(r => r.flags.some(f => f.flag === 'NOT MEASURED'));
  if (unmeasured.length) {
    out.push({ key: 'unmeasured', tone: 'warn', label: 'Not measured',
      text: `${unmeasured.map(r => r.label).join(', ')}: no stored report counts ${unmeasured.length === 1 ? 'this stage' : 'these stages'}, so a stop there would not show here.` });
  }
  return out;
}

/**
 * How old brief:latest may be. 26 h fits a daily push; tighten to 120 once PR #412's hourly brief-push line runs on
 * main (v3#452), or it stays green for a day after that push stops.
 */
export const BRIEF_STALE_MIN = 26 * 60;

/** Days of stage snapshots read for the week-change column. */
const COVERAGE_WINDOW = 9;

/** Every document the line is joined from. `next` is passed in because the page has already read it. */
export async function getLineInputs(next: PipelineNextReport | null): Promise<LineInputs> {
  const db = await getDb();
  const since = new Date(Date.now() - 24 * 3600_000);
  const [coverage, now, brief, runRows] = await Promise.all([
    // 37 documents on 2026-11-16, one a night: a sort without an index is cheap here.
    db.collection('stage_coverage_snapshots').find({}, { projection: { timestamp: 1, stages: 1, stalled: 1 } }).sort({ timestamp: -1 }).limit(COVERAGE_WINDOW).toArray(),
    getPipelineNow().catch(() => null),
    db.collection('ops_reports').findOne({ _id: 'brief:latest' as never }, { projection: { fine: 1, generated_at: 1 } }).catch(() => null),
    db.collection('cron_runs').aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $sort: { timestamp: 1 } },
      { $group: {
        _id: '$cron', runs: { $sum: 1 }, last: { $last: '$timestamp' }, last_summary: { $last: '$summary' },
        skipped: { $sum: { $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$failed', true] }, 1, 0] } },
      } },
    ], { maxTimeMS: 10_000 }).toArray().catch(() => []),
  ]);
  return {
    coverage: coverage as unknown as CoverageSnapshot[],
    next,
    now,
    fine: (brief?.fine as BriefFine | undefined) ?? null,
    briefAt: (brief?.generated_at as Date | string | undefined) ?? null,
    runs: runRows.map(r => ({ cron: String(r._id), runs: r.runs, skipped: r.skipped, failed: r.failed, last: r.last ?? null, last_summary: r.last_summary ?? null })),
  };
}
