import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { purgeAIQueues } from '@/lib/sqs-client';
import { PAUSE_KEYS, PAUSE_ALIASES, classifyPauseEntry, pausedKeys, validatePauseKeys, type PauseKey } from '@/lib/pause';
import { collectableBatchJobsFilter, unsubmittedBatchJobsFilter } from '../../../../../scripts/lib/batch-job-filters.mjs';
import { endNamelessBatchJobs } from '../../../../../scripts/lib/end-batch-job.mjs';

export const maxDuration = 60;

/** Chained/seam batch translation runs (scripts/lib/translate-batch-seam.mjs RUNS_COLLECTION). */
const RUNS_COLLECTION = 'translate_batch_runs';
/**
 * The only run phases an emergency stop parks: chained runs whose next step is a SUBMIT
 * (paid). A run whose Batch job is already at Gemini — chained `round_submitted`, seam
 * `translate_submitted` / `repair_submitted` — is never parked: collecting it is free, and a
 * parked run is collected only if someone resumes through this route (a resume by editing
 * Mongo would orphan the paid output). The next paid submit those runs would make is stopped
 * by the lanes' own brake (`translateSubmitBrake` in submitRounds / the seam advanceRun),
 * which reads the `translate` key this route sets.
 */
const PARKABLE_RUN_PHASES = ['round_ready', 'round_submitting'];
/**
 * Where an emergency stop puts an open run. `parked` is terminal for the chained lane, so
 * `tickChained` never selects it; a park WITHOUT `parked_for_hold` keeps the book out of
 * Phase 4 and `--enrol-auto` indefinitely ("re-enrol by hand once the cause is known"), so
 * nothing re-enrols it on its own either. `failed` would not hold: the selectors exclude a
 * failed run's book for only 24 h. The seam lane's `--advance` treats `parked` as a no-op.
 */
const STOPPED_RUN_PHASE = 'parked';
const STOPPED_BY = 'emergency-stop';

const validKeysError = (unknown: unknown[]) =>
  NextResponse.json(
    {
      error: `Unknown pause key(s): ${unknown.map((u) => JSON.stringify(u)).join(', ')} — no worker reads them, so they would pause nothing.`,
      valid_keys: PAUSE_KEYS,
      legacy_aliases: PAUSE_ALIASES,
    },
    { status: 400 },
  );

/**
 * POST /api/admin/emergency-stop
 *
 * Kill switch for runaway processing.
 *
 * FULL STOP (no body): cancels every pending/processing Lambda job and every batch job
 * that never reached Gemini (no job name — a submitted one is paid work and is LEFT for the
 * collector, #5496 review B1), clears book.job refs, parks the translate_batch_runs runs
 * about to SUBMIT (round_ready, round_submitting — never one already at Gemini, see
 * PARKABLE_RUN_PHASES), purges the SQS AI queues, and sets BOTH `paused: true` and
 * `paused_phases` to every pause key. Both, because a selective-unpause scope bypasses the
 * global flag (29 scopes were set on 2026-10-01, so the flag alone stopped none of their
 * books) and a step pause is absolute (#5492).
 *
 * TARGETED STOP (body `{ "paused_phases": ["translate", ...] }`): validates every entry
 * against scripts/lib/pause.mjs (via src/lib/pause.ts) and rejects unknown ones with a 400
 * listing the valid keys. Adds the keys to `paused_phases` without setting the global
 * flag. It cancels no jobs, clears no book refs and purges no queue: those are not keyed
 * by step, so doing them for `['embeddings']` would stop OCR and translation work the stop
 * never named (#5496 review B1). The named lanes stop through their own key checks; open
 * batch translation runs are parked only when `translate` is among the keys.
 *
 * Query params:
 *   ?dry_run=true          — show what would be cancelled without doing it
 *   ?skip_purge=true       — do not purge the SQS AI queues
 *   ?resume=true           — clear every pause and un-park the runs this route parked
 *   ?resume=true&key=K     — resume ONE step: every other KEY stays stopped, but the global
 *                            flag is cleared, so steps that read only the flag restart
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  const db = await getDb();
  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry_run') === 'true';
  const resume = url.searchParams.get('resume') === 'true';
  const control = db.collection('system_config');

  if (resume) {
    const keyParam = url.searchParams.get('key');
    let key: PauseKey | null = null;
    if (keyParam !== null) {
      const c = classifyPauseEntry(keyParam);
      if (c.kind !== 'key' && c.kind !== 'alias') return validKeysError([keyParam]);
      key = c.key;
    }
    const current = await control.findOne({ _id: 'processing_control' as any });

    let update: Record<string, unknown>;
    if (key === null) {
      update = { paused: false, paused_phases: [] };
    } else {
      // "Every keyed step that was stopped stays stopped, except K." A global pause becomes
      // every key but K, so for the six keyed steps this stops more, never less: scoped books,
      // which the global flag let through, now stop too. But `paused` goes false, so whatever
      // reads ONLY the global flag restarts: orchestrator phases no key governs (1.97, 3, 5,
      // 9, …) and any reader with no key. To keep those stopped, pause their phase numbers too.
      const stopped = new Set<PauseKey>(current?.paused ? PAUSE_KEYS : pausedKeys(current));
      stopped.delete(key);
      const phaseOnly = (Array.isArray(current?.paused_phases) ? current.paused_phases : [])
        .filter((e: unknown) => classifyPauseEntry(e).kind === 'phase');
      update = { paused: false, paused_phases: [...stopped, ...phaseOnly] };
    }
    let runsRestored = 0;
    if (!dryRun) {
      await control.updateOne(
        { _id: 'processing_control' as any },
        { $set: { ...update, resumed_at: new Date(), resumed_by: 'emergency-stop-api' } },
      );
      // Un-park the runs this route parked, back to the phase they were in. A run parked by
      // anything else (a hold, strikes) is not touched.
      if (key === null || key === 'translate') {
        const r = await db.collection(RUNS_COLLECTION).updateMany(
          { phase: STOPPED_RUN_PHASE, 'emergency_stop.by': STOPPED_BY },
          [
            {
              $set: {
                // A run caught mid-claim goes back to READY; the claim died with the stop.
                phase: {
                  $cond: [{ $eq: ['$emergency_stop.prior_phase', 'round_submitting'] }, 'round_ready', '$emergency_stop.prior_phase'],
                },
                claimed_at: null,
                updated_at: '$$NOW',
              },
            },
            { $unset: ['emergency_stop', 'parked_reason'] },
          ],
        );
        runsRestored = r.modifiedCount;
      }
      await db.collection('processing_control_log').insertOne({
        action: 'resume', timestamp: new Date(), source: 'emergency-stop-api',
        key: key ?? 'all', paused_phases_after: update.paused_phases, runs_restored: runsRestored,
      });
    }
    return NextResponse.json({
      success: true,
      action: 'resumed',
      key: key ?? 'all',
      paused: false,
      paused_phases: update.paused_phases,
      runs_restored: runsRestored,
      dry_run: dryRun,
    });
  }

  // Optional targeted stop. A body that names keys must name REAL keys: before #5492 this
  // route accepted any array, and `['ocr']` returned success while stopping nothing.
  let pausedPhases: Array<PauseKey | number> | undefined;
  let body: unknown = undefined;
  try {
    body = await request.json();
  } catch {
    // No body or invalid JSON — a full stop.
  }
  const requested = (body as { paused_phases?: unknown } | undefined)?.paused_phases;
  if (requested !== undefined) {
    const v = validatePauseKeys(requested);
    if (!v.ok) return validKeysError(v.unknown);
    if (v.keys.length === 0) return validKeysError(['(empty list)']);
    pausedPhases = v.keys;
  }
  const fullStop = pausedPhases === undefined;
  const stopsTranslate = fullStop || pausedPhases!.includes('translate');

  const result = {
    lambda_jobs_cancelled: 0,
    batch_jobs_cancelled: 0,
    batch_jobs_left_for_collector: 0,
    book_refs_cleared: 0,
    translate_batch_runs_parked: 0,
    dry_run: dryRun,
  };

  // Steps 1, 2, 4 and the purge are not keyed by step, so only a FULL stop runs them: a
  // targeted stop for one key must not cancel or purge another lane's work (#5496 review B1).

  // 1. Count/cancel active Lambda jobs (jobs collection)
  const activeJobsFilter = {
    status: { $in: ['pending', 'processing'] },
  };
  const activeJobCount = fullStop ? await db.collection('jobs').countDocuments(activeJobsFilter) : 0;
  result.lambda_jobs_cancelled = activeJobCount;

  if (!dryRun && activeJobCount > 0) {
    await db.collection('jobs').updateMany(
      activeJobsFilter,
      {
        $set: {
          status: 'cancelled',
          updated_at: new Date(),
          cancelled_at: new Date(),
          cancelled_by: 'emergency-stop',
        },
      }
    );
  }

  // 2. Count/cancel batch jobs that never reached Gemini.
  // A batch_jobs row is inserted AFTER its job is submitted, with the job's name.
  // Such a row is paid work: marking it 'cancelled' here (Mongo only — nothing is
  // cancelled at Gemini) took it out of batch-collector's selection for good,
  // resume never restored it, and Phase 8.5 rolled the book back after 48 h into
  // a second paid dispatch (#4839, #5492). A stop must never abandon paid work,
  // so submitted rows stay as they are and keep being collected.
  const activeBatchFilter = unsubmittedBatchJobsFilter();
  const activeBatchCount = fullStop ? await db.collection('batch_jobs').countDocuments(activeBatchFilter) : 0;
  result.batch_jobs_cancelled = activeBatchCount;
  result.batch_jobs_left_for_collector = await db.collection('batch_jobs').countDocuments(collectableBatchJobsFilter());

  // Through the one guarded terminator (#6276): it ANDs the no-name clauses onto the filter
  // again at write time, so a row named between the count and the write is left alone.
  if (!dryRun && activeBatchCount > 0) {
    await endNamelessBatchJobs(db, activeBatchFilter, {
      status: 'cancelled',
      reason: 'emergency stop',
      by: 'emergency-stop',
      set: { cancelled_at: new Date(), cancelled_by: 'emergency-stop' },
    });
  }

  // 3. Park batch translation runs about to submit. They live in their own collection, so
  //    steps 1–2 never reached them, and the chained lane is the main translation lane
  //    (#5492). Only PARKABLE_RUN_PHASES: a run already at Gemini keeps being collected
  //    (free); the brake in the lane stops its next submit. The prior phase is kept so
  //    ?resume can put each run back.
  if (stopsTranslate) {
    const openRunsFilter = { phase: { $in: PARKABLE_RUN_PHASES } };
    result.translate_batch_runs_parked = await db.collection(RUNS_COLLECTION).countDocuments(openRunsFilter);
    if (!dryRun && result.translate_batch_runs_parked > 0) {
      await db.collection(RUNS_COLLECTION).updateMany(openRunsFilter, [
        {
          $set: {
            emergency_stop: { by: STOPPED_BY, at: '$$NOW', prior_phase: '$phase' },
            phase: STOPPED_RUN_PHASE,
            parked_reason: 'emergency stop (POST /api/admin/emergency-stop) — ?resume=true restores it',
            updated_at: '$$NOW',
          },
        },
      ]);
    }
  }

  // 4. Clear book.job references (so UI doesn't show stale progress)
  const bookJobFilter = { job: { $exists: true } };
  const bookJobCount = fullStop ? await db.collection('books').countDocuments(bookJobFilter) : 0;
  result.book_refs_cleared = bookJobCount;

  if (!dryRun && bookJobCount > 0) {
    await db.collection('books').updateMany(
      bookJobFilter,
      { $unset: { job: '' }, $set: { updated_at: new Date() } }
    );
  }

  // 5. Set the pause: the global flag AND every key on a full stop; the named keys, added to
  //    whatever is already paused, on a targeted one.
  if (!dryRun) {
    const update: Record<string, unknown> = fullStop
      ? { paused: true, paused_phases: [...PAUSE_KEYS], paused_at: new Date(), paused_by: 'emergency-stop', paused_phases_set_at: new Date(), paused_phases_reason: 'emergency stop (full)' }
      : { paused_phases_set_at: new Date(), paused_phases_reason: 'emergency stop (targeted)' };
    await control.updateOne(
      { _id: 'processing_control' as any },
      fullStop ? { $set: update } : { $set: update, $addToSet: { paused_phases: { $each: pausedPhases } } },
      { upsert: true }
    );
    await db.collection('processing_control_log').insertOne({
      action: 'pause', timestamp: new Date(), source: 'emergency-stop-api',
      reason: 'emergency stop', paused_phases: pausedPhases || 'all',
      jobs_cancelled: activeJobCount, batch_jobs_cancelled: activeBatchCount,
      translate_batch_runs_parked: result.translate_batch_runs_parked,
    });
  }

  // 6. Purge SQS AI queues (unless skipped or dry run)
  const skipPurge = url.searchParams.get('skip_purge') === 'true';
  let queuesPurged: { purged: string[]; errors: string[] } | null = null;

  if (!dryRun && !skipPurge && fullStop) {
    try {
      queuesPurged = await purgeAIQueues();
    } catch (err) {
      queuesPurged = { purged: [], errors: [err instanceof Error ? err.message : String(err)] };
    }
  }

  return NextResponse.json({
    success: true,
    ...result,
    ...(queuesPurged ? { queues_purged: queuesPurged } : {}),
    ...(skipPurge ? { queues_skipped: true } : {}),
    paused_phases: pausedPhases ?? [...PAUSE_KEYS],
    global_pause: fullStop,
    message: dryRun
      ? 'Dry run — no changes made'
      : `Emergency stop activated${fullStop ? '' : ` for ${pausedPhases!.join(', ')}`}. ${activeJobCount} jobs + ${activeBatchCount} unsubmitted batch jobs cancelled; ${result.batch_jobs_left_for_collector} submitted batch jobs left for the collector; ${result.translate_batch_runs_parked} batch translation runs parked.${queuesPurged ? ` Queues purged: ${queuesPurged.purged.join(', ') || 'none'}.` : ''} Call with ?resume=true (or ?resume=true&key=<key>) to re-enable.`,
  });
});
