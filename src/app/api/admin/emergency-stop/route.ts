import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { getDb } from '@/lib/mongodb';
import { purgeAIQueues } from '@/lib/sqs-client';
import { PAUSE_KEYS, PAUSE_ALIASES, classifyPauseEntry, pausedKeys, validatePauseKeys, type PauseKey } from '@/lib/pause';

export const maxDuration = 60;

/** Chained/seam batch translation runs (scripts/lib/translate-batch-seam.mjs RUNS_COLLECTION). */
const RUNS_COLLECTION = 'translate_batch_runs';
/**
 * Terminal phases of both batch lanes: chained (complete, parked, failed) and seam
 * (written, shadow_complete, failed). Everything else is a run a tick would move.
 */
const RUN_TERMINAL_PHASES = ['complete', 'parked', 'failed', 'written', 'shadow_complete'];
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
 * FULL STOP (no body): cancels every pending/processing job and batch job, clears
 * book.job refs, parks every open translate_batch_runs run, purges the SQS AI queues,
 * and sets BOTH `paused: true` and `paused_phases` to every pause key. Both, because a
 * selective-unpause scope bypasses the global flag (29 scopes were set on 2026-10-01, so
 * the flag alone stopped none of their books) and a step pause is absolute (#5492).
 *
 * TARGETED STOP (body `{ "paused_phases": ["translate", ...] }`): validates every entry
 * against scripts/lib/pause.mjs (via src/lib/pause.ts) and rejects unknown ones with a 400
 * listing the valid keys. Adds the keys to `paused_phases` without setting the global
 * flag. Jobs are cancelled and queues purged as before; open batch translation runs are
 * parked only when `translate` is among the keys.
 *
 * Query params:
 *   ?dry_run=true          — show what would be cancelled without doing it
 *   ?skip_purge=true       — do not purge the SQS AI queues
 *   ?resume=true           — clear every pause and un-park the runs this route parked
 *   ?resume=true&key=K     — resume ONE step: everything else that was stopped stays stopped
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
      // "Everything that was stopped stays stopped, except K." A global pause stops every
      // step, so it becomes every key but K — scoped books, which the global flag let
      // through, now stop too: the conversion only ever stops more, never less.
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
    book_refs_cleared: 0,
    translate_batch_runs_parked: 0,
    dry_run: dryRun,
  };

  // 1. Count/cancel active Lambda jobs (jobs collection)
  const activeJobsFilter = {
    status: { $in: ['pending', 'processing'] },
  };
  const activeJobCount = await db.collection('jobs').countDocuments(activeJobsFilter);
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

  // 2. Count/cancel active batch jobs (batch_jobs collection)
  const activeBatchFilter = {
    status: { $in: ['pending', 'processing'] },
  };
  const activeBatchCount = await db.collection('batch_jobs').countDocuments(activeBatchFilter);
  result.batch_jobs_cancelled = activeBatchCount;

  if (!dryRun && activeBatchCount > 0) {
    await db.collection('batch_jobs').updateMany(
      activeBatchFilter,
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

  // 3. Park open batch translation runs. They live in their own collection, so steps 1–2
  //    never reached them, and the chained lane is the main translation lane (#5492). The
  //    prior phase is kept so ?resume can put each run back where it was; a run whose Batch
  //    job is already at Gemini keeps the job's name on the run, so its results can still be
  //    collected after the resume.
  if (stopsTranslate) {
    const openRunsFilter = { phase: { $nin: RUN_TERMINAL_PHASES } };
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
  const bookJobCount = await db.collection('books').countDocuments(bookJobFilter);
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

  if (!dryRun && !skipPurge) {
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
      : `Emergency stop activated${fullStop ? '' : ` for ${pausedPhases!.join(', ')}`}. ${activeJobCount} jobs + ${activeBatchCount} batch jobs cancelled, ${result.translate_batch_runs_parked} batch translation runs parked.${queuesPurged ? ` Queues purged: ${queuesPurged.purged.join(', ') || 'none'}.` : ''} Call with ?resume=true (or ?resume=true&key=<key>) to re-enable.`,
  });
});
