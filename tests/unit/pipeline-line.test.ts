/**
 * The whole line (v3#421): how the stored reports become one row per stage. The shapes are those of the documents
 * read on 2026-11-16; the numbers are small on purpose.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildHeadline, buildLine, LINE_STAGES, type CoverageSnapshot, type LineInputs, type RunLog } from '@/lib/pipeline-line';
import type { BoxDoc, CorpusDoc, CronLine, PipelineNow } from '@/lib/pipeline-now';
import type { PipelineNextReport, Work } from '@/lib/pipeline-next-report';

const work = (books: number, pages = 0): Work => ({ books, pages, archive_pages: pages, ocr_pages: pages, translate_pages: pages });
const line = (stage: CronLine['stage'], script: string, over: Partial<CronLine> = {}): CronLine => ({
  stage, script, schedule: '0 * * * *', one_shot: false, disabled: false, disabled_tag: null, mode: null, flags: [], env: [],
  log: '/var/log/x.log', log_at: '2026-11-16T09:00:00Z', log_last: null, comment: '', ...over,
});
const snap = (timestamp: string, stages: CoverageSnapshot['stages'], stalled: string[] = []): CoverageSnapshot => ({ timestamp, stages, stalled });
const ok = (stage: string, covered: number, total: number, extra: Partial<CoverageSnapshot['stages'][number]> = {}) =>
  ({ stage, status: 'ok' as const, covered, total, queue_depth: total - covered, delta: 0, ...extra });
const broken = (stage: string) => ({ stage, status: 'probe_broken' as const, covered: null, total: null, queue_depth: null });

const NEXT = {
  generated_at: '2026-11-16T06:45:00Z',
  denominator: { rule: 'books with pages_count > 0', books: 1000, live: 100, live_rule: 'visible: true' },
  steps: [
    { step: 'ocr', all: work(40, 4000), live: work(10, 900) },
    { step: 'images', all: work(15), live: work(13) },
    { step: 'done', all: work(6), live: work(5) },
  ],
  step_reasons: [{ step: 'blocked', reason: 'held', all: work(800), live: work(60) }],
} as unknown as PipelineNextReport;

const box = (name: string, lines: CronLine[]): { box: string; doc: BoxDoc } =>
  ({ box: name, doc: { _id: `pipeline-now:${name}`, box: name, generated_at: '2026-11-16T09:10:00Z', lines, lanes: [], gpu_queue: null, agy_pools: null } });
const corpus = {
  generated_at: '2026-11-16T02:50:00Z',
  ocr_per_day: [
    { day: '2026-11-15', lane: 'agy-flash-ocr', model: 'm', pages: 70 },
    { day: '2026-11-15', lane: 'paddle-zh', model: 'p', pages: 30 },
    { day: '2026-11-16', lane: 'agy-flash-ocr', model: 'm', pages: 5 },
  ],
  translated_per_day: [],
  handoffs_per_day: [{ day: '2026-11-15', gpu_draft: 0, armc_correct: 0, translated_pages: 0, translate_books: 0, enrich_books: 0, ft_search: 9, ft_ingest: 8 }],
} as unknown as CorpusDoc;

function inputs(over: Partial<LineInputs> = {}): LineInputs {
  const now: PipelineNow = {
    boxes: [
      box('gex45', [line('ocr', 'scripts/batch/cli-ocr-lane.mjs'), line('ocr', 'scripts/batch/cli-ocr-lane.mjs', { disabled: true })]),
      box('hetzner', [
        line('translate', 'scripts/ft/search-translation-evidence.mjs', { disabled: true }),
        line('enrich', 'scripts/workers/enrich-worker.mjs'),
        line('enrich', 'scripts/enrichment/geocode-publication-places.mjs'),
        line('qc', 'scripts/audit/page-count-audit.mjs'),
        line('qc', 'scripts/eval/paired-fifths-daily.sh', { red: [{ flag: 'PAST REVIEW', why: 'x' }] }),
      ]),
    ],
    corpus, claude: null,
  };
  return {
    coverage: [
      snap('2026-11-16T04:20:00Z', [ok('ocr', 500, 1000, { delta: 12 }), ok('images', 99, 100), ok('embeddings', 90, 100)], ['embeddings']),
      snap('2026-11-14T04:20:00Z', [broken('ocr'), ok('images', 99, 100), ok('embeddings', 88, 100)]),
      snap('2026-11-10T04:20:00Z', [ok('ocr', 440, 1000), ok('images', 99, 100), ok('embeddings', 80, 100)]),
      snap('2026-11-08T04:20:00Z', [broken('ocr'), ok('images', 99, 100), ok('embeddings', 70, 100)]),
    ],
    next: NEXT, now, fine: { day: '2026-11-15', qa_books: 0, done_delta: 3 }, runs: [], ...over,
  };
}
const row = (l: ReturnType<typeof buildLine>, key: string) => l.rows.find(r => r.key === key)!;
const flagsOf = (l: ReturnType<typeof buildLine>, key: string) => row(l, key).flags.map(f => f.flag);

describe('buildLine', () => {
  it('lists every stage, in order, whatever is missing', () => {
    const empty = buildLine({ coverage: [], next: null, now: null, fine: null, runs: [] });
    expect(empty.rows.map(r => r.key)).toEqual(LINE_STAGES.map(s => s.key));
    expect(empty.held).toBeNull();
    expect(empty.sources.every(s => s.at === null)).toBe(true);
    // Nothing was read, so nothing is called unscheduled.
    expect(empty.runnersRead).toBe(false);
    expect(empty.rows.flatMap(r => r.flags.map(f => f.flag))).not.toContain('NOTHING SCHEDULED');
  });

  it('does not call a stage unscheduled while a box has not reported', () => {
    const base = inputs();
    const silent = { ...base, now: { ...base.now!, boxes: [...base.now!.boxes, { box: 'l7a', doc: null }] } };
    expect(flagsOf(buildLine(base), 'pictures')).toContain('NOTHING SCHEDULED');
    expect(flagsOf(buildLine(silent), 'pictures')).not.toContain('NOTHING SCHEDULED');
  });

  it('reads a failed nightly count as unknown, and never shows a partial day as a whole one', () => {
    const base = inputs();
    const failed = { ...base, now: { ...base.now!, corpus: { ...base.now!.corpus!, ocr_per_day: null } } };
    expect(row(buildLine(failed), 'ocr').yesterday).toBeNull();
    // A document pushed on the 15th covers the 14th in full; the 15th is partial and is not shown.
    const stale = { ...base, now: { ...base.now!, corpus: { ...base.now!.corpus!, generated_at: '2026-11-15T02:50:00Z' } } };
    expect(row(buildLine(stale), 'ocr').yesterday).toMatchObject({ n: 0, when: '2026-11-14' });
  });

  it('joins stock, waiting and yesterday for a measured stage', () => {
    const ocr = row(buildLine(inputs()), 'ocr');
    expect(ocr.done).toMatchObject({ covered: 500, total: 1000, unit: 'pages' });
    expect(ocr.waiting).toEqual({ books: 10, pages: 900, allBooks: 40 });
    // The last full UTC day the document covers: the partial day it was pushed on (11-16) is left out.
    expect(ocr.yesterday).toMatchObject({ n: 100, when: '2026-11-15', parts: [{ label: 'agy-flash-ocr', n: 70 }, { label: 'paddle-zh', n: 30 }] });
  });

  it('measures the week against the oldest snapshot that could read the stage, never a broken probe', () => {
    const l = buildLine(inputs());
    expect(row(l, 'ocr').week).toEqual({ n: 60, since: '2026-11-10' });
    expect(row(l, 'embed').week).toEqual({ n: 20, since: '2026-11-08' });
  });

  it('reports a broken probe as broken, not as zero', () => {
    const l = buildLine(inputs({ coverage: [snap('2026-11-16T04:20:00Z', [broken('ocr')])] }));
    expect(row(l, 'ocr').done).toBeNull();
    expect(flagsOf(l, 'ocr')).toContain('PROBE BROKEN');
  });

  it('flags a stage with work waiting and nothing scheduled; a scheduler worker that only skips does not count as serving it', () => {
    const pictures = row(buildLine(inputs()), 'pictures');
    expect(pictures.waiting?.books).toBe(13);
    expect(pictures.flags.map(f => f.flag)).toContain('NOTHING SCHEDULED');
    const skipping: RunLog[] = [{ cron: 'image-extract-worker', runs: 288, skipped: 288, failed: 0, last: '2026-11-16T10:00:00Z', last_summary: 'skipped: spend dial closed and no envelope open' }];
    const shut = row(buildLine(inputs({ runs: skipping })), 'pictures');
    expect(shut.runs.map(r => r.cron)).toEqual(['image-extract-worker']);
    expect(shut.flags.map(f => f.flag)).toEqual(['RUNS, DOES NOTHING', 'NOTHING SCHEDULED']);
    // Positive control: a run that worked clears both.
    const working = row(buildLine(inputs({ runs: [{ ...skipping[0], skipped: 200 }] })), 'pictures');
    expect(working.flags.map(f => f.flag)).toEqual([]);
  });

  it('reads the four scheduler workers that once left no record, and scoring under its own names (#428 PR 3)', () => {
    const at = (key: string) => LINE_STAGES.find(s => s.key === key)!;
    expect(at('archive').runNames).toEqual(['archive-bulk', 'archive-ocr']);
    expect(at('display').runNames).toEqual(['display-backfill']);
    expect(at('pictures').runNames).toEqual(['image-extract-worker']);
    expect(at('score').runNames).toEqual(['hetzner-enrich-scoring', 'hetzner-enrich-collections']);
    // Each name a row reads is one a script writes: a renamed run log would leave the row silently empty.
    const src = (f: string) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
    for (const [file, name] of [
      ['scripts/workers/archive-bulk.mjs', "cron: 'archive-bulk'"], ['scripts/workers/archive-ocr.mjs', "cron: 'archive-ocr'"],
      ['scripts/migration/backfill-display-images.mjs', "cron: 'display-backfill'"], ['scripts/workers/image-extract-worker.mjs', "cron: 'image-extract-worker'"],
      ['scripts/workers/enrich-worker.mjs', "'7.5': 'hetzner-enrich-scoring'"], ['scripts/workers/enrich-worker.mjs', "'7.6': 'hetzner-enrich-collections'"],
    ]) expect(src(file), `${file} ${name}`).toContain(name);
    // An archive worker's own crontab line (stage other: no stage rule names it) goes to the archive row.
    const l = buildLine(inputs({ now: { boxes: [box('hetzner', [line('other' as CronLine['stage'], 'scripts/workers/archive-bulk.mjs')])], corpus, claude: null } }));
    expect(row(l, 'archive').runners.map(r => r.line.script)).toEqual(['scripts/workers/archive-bulk.mjs']);
  });

  it('shows the books searched for pictures, with the pictures cut out beside them', () => {
    const l = buildLine(inputs({ coverage: [snap('2026-11-16T04:20:00Z', [ok('image_books', 37786, 71337), ok('images', 234560, 235714)])] }));
    expect(row(l, 'pictures').done).toMatchObject({ covered: 37786, total: 71337, unit: 'books',
      also: [{ label: 'pictures cut out for the gallery, of pictures found (235,714)', n: 234560 }] });
    // A broken pictures probe drops the figure beside, not the row.
    const b = buildLine(inputs({ coverage: [snap('2026-11-16T04:20:00Z', [ok('image_books', 37786, 71337), broken('images')])] }));
    expect(row(b, 'pictures').done?.also).toEqual([]);
  });

  it('does not call a stage unscheduled when only a switched-off line serves it, unless work waits', () => {
    const l = buildLine(inputs());
    expect(row(l, 'ft').runners).toHaveLength(1); // the evidence script belongs to first-translation, not translation
    expect(row(l, 'translate').runners).toHaveLength(0);
    expect(flagsOf(l, 'ft')).not.toContain('NOTHING SCHEDULED');
  });

  it('flags a scheduler worker that runs and skips every time', () => {
    const runs: RunLog[] = [
      { cron: 'hetzner-enrich-worker', runs: 684, skipped: 684, failed: 0, last: '2026-11-16T10:02:00Z', last_summary: 'skipped: daily budget ceiling reached' },
      { cron: 'hetzner-enrich-agy', runs: 12, skipped: 0, failed: 0, last: '2026-11-16T08:40:00Z', last_summary: null },
    ];
    const enrich = row(buildLine(inputs({ runs })), 'enrich');
    expect(enrich.runs.map(r => r.cron)).toEqual(['hetzner-enrich-worker', 'hetzner-enrich-agy']);
    // The agy lane did the work, so the skipping worker is a leftover, said beside the runners, not a flag.
    expect(enrich.flags.map(f => f.flag)).not.toContain('RUNS, DOES NOTHING');
    expect(enrich.idle).toHaveLength(1);
    expect(enrich.idle[0]).toMatch(/^hetzner-enrich-worker ran 684 times/);
  });

  it('flags a worker that skips every run when nothing else serves the stage', () => {
    const runs: RunLog[] = [{ cron: 'hetzner-enrich-worker', runs: 684, skipped: 684, failed: 0, last: '2026-11-16T10:02:00Z', last_summary: 'skipped: daily budget ceiling reached' }];
    const enrich = row(buildLine(inputs({ runs })), 'enrich');
    expect(enrich.flags.filter(f => f.flag === 'RUNS, DOES NOTHING')).toHaveLength(1);
    expect(enrich.idle).toEqual([]);
  });

  it('calls a skipping worker idle when pages moved on the day', () => {
    const runs: RunLog[] = [{ cron: 'hetzner-translate-worker', runs: 416, skipped: 416, failed: 0, last: '2026-11-16T10:02:00Z', last_summary: null }];
    const c = { ...inputs().now!.corpus!, translated_per_day: [{ day: '2026-11-15', lane: 'agy-flash-translate', model: 'm', pages: 40 }] } as unknown as CorpusDoc;
    const base = inputs();
    const tr = row(buildLine({ ...base, runs, now: { ...base.now!, corpus: c } }), 'translate');
    expect(tr.flags.map(f => f.flag)).not.toContain('RUNS, DOES NOTHING');
    expect(tr.idle).toHaveLength(1);
  });

  it('gives each cron line to one stage and keeps the rest visible', () => {
    const l = buildLine(inputs());
    expect(row(l, 'enrich').runners.map(r => r.line.script)).toEqual(['scripts/workers/enrich-worker.mjs']);
    expect(row(l, 'metadata').runners.map(r => r.line.script)).toEqual(['scripts/enrichment/geocode-publication-places.mjs']);
    expect(flagsOf(l, 'qa')).toContain('RED LINE');
    expect(l.other.map(r => r.line.script)).toEqual(['scripts/audit/page-count-audit.mjs']);
    const placed = l.rows.reduce((a, r) => a + r.runners.length, 0) + l.other.length;
    expect(placed).toBe(7); // all 7 fixture lines, each once; a switched-off line stays listed in its stage's row
    expect(row(l, 'ocr').runners).toHaveLength(2);
  });

  it('carries the stall verdict, the held books and the finished count', () => {
    const l = buildLine(inputs());
    expect(flagsOf(l, 'embed')).toContain('STALLED');
    expect(l.held).toEqual({ books: 60, of: 100, allBooks: 800 });
    expect(row(l, 'done').done).toMatchObject({ covered: 5, total: 100, unit: 'books' });
    expect(row(l, 'done').yesterday?.n).toBe(3);
    expect(flagsOf(l, 'split')).toEqual(['NOT MEASURED']);
  });
});

/** v3#434: the steps the first stage list left out, because no stored report names them. */
describe('the steps no report names', () => {
  it('puts each one where a book meets it', () => {
    expect(LINE_STAGES.map(s => s.key)).toEqual([
      'import', 'archive', 'display', 'marks', 'dupes', 'split', 'catalogue', 'ocr', 'ft', 'translate', 'seams',
      'enrich', 'score', 'pictures', 'cover', 'embed', 'identity', 'metadata', 'qa', 'search', 'publish', 'done',
      // made on request (v3#446): no place in the order, listed apart
      'translit', 'guide', 'doi', 'deepzoom',
    ]);
  });

  it('says which job a step runs inside, and never calls such a step unscheduled or measured', () => {
    const runs: RunLog[] = [{ cron: 'pipeline-orchestrator-worker', runs: 1639, skipped: 0, failed: 0, last: '2026-11-16T14:00:00Z', last_summary: null }];
    const l = buildLine(inputs({ runs }));
    for (const key of ['dupes', 'split', 'catalogue', 'translit', 'cover', 'publish']) {
      expect(row(l, key).inside, key).toMatch(/[Oo]rchestrator phase/);
      expect(row(l, key).runs.map(r => r.cron), key).toEqual(['pipeline-orchestrator-worker']);
    }
    // The seam pass has no run record of its own: it says where it runs and what it leaves behind.
    expect(row(l, 'seams').inside).toContain('cli-translate-lane.mjs');
    expect(row(l, 'seams').runs).toEqual([]);
    // Scoring and collections log under their own names (#428 PR 3).
    expect(row(l, 'score').inside).toContain('its own run-log name');
    for (const key of ['display', 'marks', 'seams', 'search']) {
      expect(flagsOf(l, key), key).toEqual(['NOT MEASURED']);
      expect(row(l, key).done, key).toBeNull();
    }
    // A measured row whose stage the snapshot does not carry yet says so, and is still flagged.
    expect(row(l, 'cover').doneNote).toBe('The nightly stage snapshot has no row for this stage.');
    expect(flagsOf(l, 'cover')).toEqual(['NOT MEASURED']);
  });

  it('gives a step its own cron lines before a wider stage rule takes them', () => {
    const base = inputs();
    const l = buildLine({ ...base, now: { ...base.now!, boxes: [box('hetzner', [
      line('ocr', 'scripts/workers/pre-ocr-dupe-screen-nightly.sh'),
      line('ocr', 'scripts/batch/cli-ocr-lane.mjs'),
      line('enrich', 'scripts/workers/enrich-worker.mjs', { flags: ['--agy', '--limit=300'] }),
      line('enrich', 'scripts/workers/enrich-worker.mjs', { flags: ['--phase=7.5', '--limit=50'] }),
      line('orchestrator', 'scripts/workers/pipeline-orchestrator.mjs', { flags: ['--phase=9'] }),
      line('orchestrator', 'scripts/workers/scheduler.mjs'),
      line('enrich', 'scripts/maintenance/backfill-cover-cards.mjs'),
      line('qc', 'scripts/audit/archive-coverage.mjs'),
      line('qc', 'scripts/audit/image-provenance-coverage.mjs'),
    ])] } });
    const scripts = (key: string) => row(l, key).runners.map(r => r.line.script?.split('/').pop());
    expect(scripts('dupes')).toEqual(['pre-ocr-dupe-screen-nightly.sh']);
    expect(scripts('ocr')).toEqual(['cli-ocr-lane.mjs']);
    expect(row(l, 'enrich').runners.map(r => r.line.flags[0])).toEqual(['--agy']);
    expect(row(l, 'score').runners.map(r => r.line.flags[0])).toEqual(['--phase=7.5']);
    // The finalize line runs phase 8.9 on its way to phase 9; "coverage" is not "cover".
    expect(scripts('cover')).toEqual(['pipeline-orchestrator.mjs', 'backfill-cover-cards.mjs']);
    // The weekly keyed-detector audit is the one line a box reports for the marks.
    expect(scripts('marks')).toEqual(['image-provenance-coverage.mjs']);
    expect(l.other.map(r => r.line.script?.split('/').pop())).toEqual(['scheduler.mjs', 'archive-coverage.mjs']);
  });

  it('keeps a step made on request apart, and never calls it unmeasured', () => {
    const l = buildLine(inputs());
    const asked = l.rows.filter(r => r.onRequest);
    expect(asked.map(r => r.key)).toEqual(['translit', 'guide', 'doi', 'deepzoom']);
    for (const r of asked) {
      expect(r.flags, r.key).toEqual([]);
      expect(r.inside, r.key).toBeTruthy();
      expect(r.waiting, r.key).toBeNull();
    }
    // Every on-request step comes after the last every-book step.
    expect(l.rows.findIndex(r => r.onRequest)).toBe(l.rows.findIndex(r => r.key === 'done') + 1);
  });
});

/** v3#428: the book-level rows read the nightly snapshot, in three shapes (stock, count, flow). */
describe('book-level rows (#428)', () => {
  const day = '2026-11-15';
  const withStages = (stages: CoverageSnapshot['stages']) => inputs({
    coverage: [snap('2026-11-16T04:20:00Z', stages), snap('2026-11-15T04:20:00Z', [ok('catalogue', 10, 100, { queue_depth: null })])],
  });

  it('points every book-level row at a stage, with no NOT MEASURED sentence left', () => {
    const at = (key: string) => LINE_STAGES.find(s => s.key === key)!;
    const pairs: [string, string][] = [['import', 'imported'], ['dupes', 'copy_holds'], ['catalogue', 'catalogue'], ['ft', 'ft_search'],
      ['score', 'quality_score'], ['cover', 'cover'], ['metadata', 'places'], ['qa', 'book_checks'], ['publish', 'published']];
    for (const [key, stage] of pairs) {
      expect(at(key).coverage?.stage, key).toBe(stage);
      expect(at(key).unmeasured, key).toBeUndefined();
    }
  });

  it('a stock row shows done of total, the figures beside it, and the week change', () => {
    const l = buildLine(withStages([ok('catalogue', 12, 100, { queue_depth: null, also: [{ label: 'x', n: 3 }] })]));
    expect(row(l, 'catalogue').done).toEqual({ covered: 12, total: 100, unit: 'books', of: 'visible books', also: [{ label: 'x', n: 3 }] });
    expect(row(l, 'catalogue').week).toEqual({ n: 2, since: '2026-11-15' });
    expect(flagsOf(l, 'catalogue')).not.toContain('NOT MEASURED');
  });

  it('a count row has no denominator and is not a broken probe', () => {
    const l = buildLine(withStages([{ stage: 'copy_holds', status: 'ok', covered: 194, total: null, queue_depth: null }]));
    expect(row(l, 'dupes').done).toMatchObject({ covered: 194, total: null, unit: 'books' });
    expect(flagsOf(l, 'dupes')).toEqual([]);
  });

  it('a flow row is counted per day under Moved, for the last full day, with its parts', () => {
    const per_day = { day, n: 1120, parts: [{ label: 'artwork records', n: 1100 }, { label: 'books', n: 20 }] };
    const l = buildLine(withStages([
      { stage: 'imported', status: 'ok', covered: null, total: null, queue_depth: null, per_day },
      { stage: 'published', status: 'ok', covered: null, total: null, queue_depth: null, per_day: { day, n: 0, parts: [] } },
    ]));
    expect(row(l, 'import').yesterday).toEqual({ n: 1120, unit: 'records', when: day, parts: per_day.parts });
    expect(row(l, 'import').done).toBeNull();
    expect(row(l, 'import').doneNote).toMatch(/^A flow, counted per day under Moved/);
    expect(flagsOf(l, 'import')).toEqual([]);
    // A day with nothing published is a measured zero, not an unmeasured row.
    expect(row(l, 'publish').yesterday).toMatchObject({ n: 0, when: day });
    expect(flagsOf(l, 'publish')).toEqual([]);
  });

  it('points every page-level row at a stage too (#428 PR 2)', () => {
    for (const [key, stage] of [['display', 'display'], ['marks', 'marks'], ['split', 'split'], ['seams', 'seams'], ['search', 'search']]) {
      const at = LINE_STAGES.find(s => s.key === key)!;
      expect(at.coverage?.stage, key).toBe(stage);
      expect(at.unmeasured, key).toBeUndefined();
    }
    // Nothing on the line is left with a NOT MEASURED sentence.
    expect(LINE_STAGES.filter(s => s.unmeasured).map(s => s.key)).toEqual([]);
  });

  it('a queue that counts hidden books shows its visible part, with the whole beside it', () => {
    const l = buildLine(withStages([{ stage: 'split', status: 'ok', covered: 2332, total: null, queue_depth: 479, queue_visible: 3 }]));
    expect(row(l, 'split').waiting).toEqual({ books: 3, pages: null, allBooks: 479 });
  });

  it('a sampled row carries its draw date and no week change', () => {
    const l = buildLine(inputs({ coverage: [
      snap('2026-11-16T04:20:00Z', [{ ...ok('marks', 300, 350, { queue_depth: null }), sampled_at: '2026-11-16T07:30:00.000Z', delta: 12 }]),
      snap('2026-11-10T04:20:00Z', [ok('marks', 280, 350, { queue_depth: null })]),
    ] }));
    expect(row(l, 'marks').done).toMatchObject({ covered: 300, total: 350, unit: 'sampled pages' });
    expect(row(l, 'marks').done!.of).toMatch(/\(drawn 2026-11-16\)$/);
    expect(row(l, 'marks').week).toBeNull();
    expect(row(l, 'marks').yesterday).toBeNull();
  });

  it('a broken flow probe is broken, never a zero day', () => {
    const l = buildLine(withStages([{ stage: 'imported', status: 'probe_broken', covered: null, total: null, queue_depth: null }]));
    expect(row(l, 'import').yesterday).toBeNull();
    expect(flagsOf(l, 'import')).toContain('PROBE BROKEN');
  });
});

describe('buildHeadline', () => {
  const h = (l: ReturnType<typeof buildLine>, key: string) => buildHeadline(l).find(x => x.key === key);

  it('leads with the hold, then the finished books and their pace', () => {
    const items = buildHeadline(buildLine(inputs()));
    expect(items.map(i => i.key)).toEqual(['held', 'finished', 'stopped', 'pace', 'unmeasured']);
    expect(items[0].text).toMatch(/^60 of 100 visible books \(60%\)/);
    expect(items[0].tone).toBe('bad');
    // 5 of 100 done, 3 on the day: the other 95 take about 32 days.
    expect(items[1].text).toContain('5 of 100 visible books (5.0%)');
    expect(items[1].text).toContain('about 32 days');
  });

  it('names each stopped stage with its first stopping flag and the books waiting', () => {
    const s = h(buildLine(inputs()), 'stopped')!;
    expect(s.tone).toBe('bad');
    expect(s.text).toMatch(/^Picture extraction \(nothing scheduled, 13 visible books waiting\); Embeddings \(stalled, 10 visible books waiting\)\./);
    // A red cron line is a record problem, not a stop: named after the stops.
    expect(s.text).toContain('Flagged, possibly only in the record of it: Quality checks (red line).');
  });

  it('gives OCR pace against the pages visible books owe', () => {
    // 100 pages on 11-15 (70 agy + 30 paddle), 900 owed: about 9 days.
    expect(h(buildLine(inputs()), 'pace')!.text).toContain('OCR 100 pages on 2026-11-15; the 900 pages visible books still owe take about 9 days');
  });

  it('drops a sentence whose figure is missing rather than saying zero', () => {
    const items = buildHeadline(buildLine({ coverage: [], next: null, now: null, fine: null, runs: [] }));
    expect(items.map(i => i.key)).not.toContain('held');
    expect(items.map(i => i.key)).not.toContain('finished');
    expect(items.map(i => i.key)).not.toContain('pace');
    // With no box read, "nothing stopped" would be a guess.
    expect(items.find(i => i.key === 'stopped')!.text).toMatch(/^Not known/);
  });
});
