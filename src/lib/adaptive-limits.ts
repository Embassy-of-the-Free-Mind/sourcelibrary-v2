import type { Db } from 'mongodb';

// ── Limit ranges: min/default/max for each adaptive limit ──

export const LIMIT_RANGES = {
  ocr_submit:          { min: 2,   default: 10,  max: 20  },
  ocr_lambda_max:      { min: 3,   default: 10,  max: 20  },
  translate_submit:    { min: 2,   default: 20,  max: 50  },
  translate_lambda_max:{ min: 3,   default: 15,  max: 30  },
  global_active_max:   { min: 5,   default: 20,  max: 40  },
  image_submit:        { min: 3,   default: 10,  max: 20  },
  image_max:           { min: 5,   default: 25,  max: 50  },
  sqs_ocr_depth:       { min: 100, default: 300, max: 500  },
  sqs_translate_depth: { min: 200, default: 500, max: 1000 },
  pages_per_run:       { min: 200, default: 2000, max: 5000 },
} as const;

export type LimitKey = keyof typeof LIMIT_RANGES;
export type AdaptiveLimits = Record<LimitKey, number>;
export type HealthGrade = 'healthy' | 'degraded' | 'critical';

/** SQS queue depths passed in from the cron (already measured there) */
export interface SqsDepths {
  ocr: number;
  translate: number;
}

interface HealthState {
  grade: HealthGrade;
  find_ms: number;
  count_ms: number;
  active_jobs: number;
  last_cron_duration_ms: number;
  sqs_combined_depth: number;
  sample_book_id: string | null;
  measured_at: Date;
  consecutive_healthy: number;
  consecutive_degraded: number;
  jobs_cancelled: number;
}

interface AdaptiveDoc {
  _id: 'adaptive_limits';
  limits: AdaptiveLimits;
  health: HealthState;
  updated_at: Date;
  updated_by: 'adaptive' | 'admin';
  locked: boolean;
}

/** Default limits (used by admin reset) */
function defaultLimits(): AdaptiveLimits {
  const limits = {} as AdaptiveLimits;
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    limits[key as LimitKey] = range.default;
  }
  return limits;
}

/** Minimum limits — used to seed on first run so new/recovering systems start conservative */
function minLimits(): AdaptiveLimits {
  const limits = {} as AdaptiveLimits;
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    limits[key as LimitKey] = range.min;
  }
  return limits;
}

/** Clamp all limits within their min/max ranges */
function clampLimits(limits: AdaptiveLimits): AdaptiveLimits {
  const clamped = { ...limits };
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    const k = key as LimitKey;
    clamped[k] = Math.max(range.min, Math.min(range.max, Math.round(clamped[k])));
  }
  return clamped;
}

/** Time a query and return milliseconds (or timeout value on error) */
async function timedQuery(fn: () => Promise<unknown>, timeoutMs = 2500): Promise<number> {
  const start = Date.now();
  try {
    await fn();
    return Date.now() - start;
  } catch {
    return timeoutMs; // treat errors as worst-case latency
  }
}

/** Grade a single signal */
function gradeLatency(findMs: number, countMs: number): HealthGrade {
  if (findMs > 1000 || countMs > 1500) return 'critical';
  if (findMs > 300 || countMs > 500) return 'degraded';
  return 'healthy';
}

function gradeJobs(active: number): HealthGrade {
  // Writer Lambda caps DB connections at 50 — job count alone doesn't saturate the DB.
  // Old thresholds (30/50) caused false-critical death spirals where the system never recovered.
  if (active > 200) return 'critical';
  if (active > 100) return 'degraded';
  return 'healthy';
}

function gradeCronDuration(ms: number): HealthGrade {
  // Vercel timeout is 300s. Pipeline legitimately takes 150-200s when processing
  // large backlogs (23+ OCR books + metadata enrichment). Only flag as degraded/critical
  // when approaching or exceeding the timeout.
  if (ms > 250_000) return 'critical';
  if (ms > 150_000) return 'degraded';
  return 'healthy';
}

/** Composite: worst of four signals */
function compositeGrade(latency: HealthGrade, jobs: HealthGrade, cron: HealthGrade, sqs: HealthGrade): HealthGrade {
  const grades = [latency, jobs, cron, sqs];
  if (grades.includes('critical')) return 'critical';
  if (grades.includes('degraded')) return 'degraded';
  return 'healthy';
}

/** Grade OCR and translation SQS queues independently */
function gradeSqsDepthByQueue(depth: number, type: 'ocr' | 'translate'): HealthGrade {
  // Per-queue thresholds (lower than combined since they're independent)
  const thresholds = type === 'ocr'
    ? { degraded: 3000, critical: 6000 }
    : { degraded: 2000, critical: 5000 };
  if (depth > thresholds.critical) return 'critical';
  if (depth > thresholds.degraded) return 'degraded';
  return 'healthy';
}

/**
 * Probe DB health, adjust limits, return current limits for the pipeline cron.
 * Writes health + limits to system_config.adaptive_limits.
 *
 * On degraded or critical: slams all limits to minimums AND cancels pending (not processing) jobs.
 * On healthy (2+ consecutive): ramps up by 30%.
 *
 * @param logger - optional CronLogger for decision recording
 * @param sqsDepths - SQS queue depths (already measured by cron), used as 4th health signal
 */
export async function getAdaptiveLimits(
  db: Db,
  logger?: { decision: (type: 'skip' | 'backpressure' | 'time_budget' | 'circuit_breaker' | 'early_return' | 'rollback', reason: string, data?: Record<string, unknown>) => void },
  sqsDepths?: SqsDepths,
): Promise<AdaptiveLimits & { _health: HealthState }> {
  const doc = await db.collection('system_config').findOne({ _id: 'adaptive_limits' as any }) as unknown as AdaptiveDoc | null;

  // Seed on first run — start at minimums so new/recovering systems are conservative
  const currentLimits: AdaptiveLimits = doc?.limits ?? minLimits();
  const prevHealth = doc?.health;
  const locked = doc?.locked ?? false;

  // ── Signal 1: Query latency ──
  // Find a sample book from active jobs, fallback to a known book
  let sampleBookId: string | null = null;
  try {
    const activeJob = await db.collection('jobs').findOne(
      { status: { $in: ['pending', 'processing'] } },
      { projection: { book_id: 1 } }
    );
    sampleBookId = activeJob?.book_id ?? null;
  } catch { /* non-critical */ }

  // If no active job, use any recent book
  if (!sampleBookId) {
    try {
      const anyBook = await db.collection('books').findOne(
        {},
        { sort: { updated_at: -1 }, projection: { id: 1 } }
      );
      sampleBookId = anyBook?.id ?? null;
    } catch { /* non-critical */ }
  }

  const [findMs, countMs] = await Promise.all([
    sampleBookId
      ? timedQuery(() =>
          db.collection('pages').findOne(
            { book_id: sampleBookId, 'translation.data': { $exists: true } },
            { projection: { id: 1 }, maxTimeMS: 2500 } as any
          )
        )
      : Promise.resolve(0),
    sampleBookId
      ? timedQuery(() =>
          db.collection('pages').countDocuments(
            { book_id: sampleBookId!, 'ocr.data': { $exists: true, $ne: '' } },
            { maxTimeMS: 2500 }
          )
        )
      : Promise.resolve(0),
  ]);

  // ── Signal 2: Active jobs ──
  let activeJobs = 0;
  try {
    activeJobs = await db.collection('jobs').countDocuments({
      status: 'processing',
    });
  } catch { /* non-critical */ }

  // ── Signal 3: Previous cron duration ──
  let lastCronMs = 0;
  try {
    const lastRun = await db.collection('cron_runs').findOne(
      { cron: 'post-import-pipeline' },
      { sort: { timestamp: -1 }, projection: { duration_ms: 1 } }
    );
    lastCronMs = lastRun?.duration_ms ?? 0;
  } catch { /* non-critical */ }

  // ── Signal 4: SQS queue depth (passed in from cron) ──
  // Grade each queue independently so OCR backlog doesn't starve translation
  const sqsOcrDepth = sqsDepths?.ocr ?? 0;
  const sqsTranslateDepth = sqsDepths?.translate ?? 0;
  const sqsCombined = sqsOcrDepth + sqsTranslateDepth;
  const sqsOcrGrade = gradeSqsDepthByQueue(sqsOcrDepth, 'ocr');
  const sqsTranslateGrade = gradeSqsDepthByQueue(sqsTranslateDepth, 'translate');
  // For the overall grade, use the worse of the two queue grades
  const sqsGrade = compositeGrade(sqsOcrGrade, sqsTranslateGrade, 'healthy', 'healthy');

  // ── Grade ──
  const grade = compositeGrade(
    gradeLatency(findMs, countMs),
    gradeJobs(activeJobs),
    gradeCronDuration(lastCronMs),
    sqsGrade,
  );

  const consecutiveHealthy = grade === 'healthy' ? (prevHealth?.consecutive_healthy ?? 0) + 1 : 0;
  const consecutiveDegraded = grade === 'degraded' ? (prevHealth?.consecutive_degraded ?? 0) + 1 : 0;

  // ── Active cancel: kill pending jobs only on critical (not degraded — proportional reduction is enough) ──
  let jobsCancelled = 0;
  if (!locked && grade === 'critical') {
    jobsCancelled = await cancelPendingJobs(db, logger);
  }

  const health: HealthState = {
    grade,
    find_ms: findMs,
    count_ms: countMs,
    active_jobs: activeJobs,
    last_cron_duration_ms: lastCronMs,
    sqs_combined_depth: sqsCombined,
    sample_book_id: sampleBookId,
    measured_at: new Date(),
    consecutive_healthy: consecutiveHealthy,
    consecutive_degraded: consecutiveDegraded,
    jobs_cancelled: jobsCancelled,
  };

  // ── Adjust limits (unless admin-locked) ──
  let newLimits = { ...currentLimits };
  let adjustment = 'none';

  if (!locked) {
    if (grade === 'critical') {
      // Slam to minimums — critical means DB is at risk of saturation.
      // Mar 10 outage showed this level needs aggressive response.
      for (const [key, range] of Object.entries(LIMIT_RANGES)) {
        newLimits[key as LimitKey] = range.min;
      }
      adjustment = 'critical_slam_to_min';
    } else if (grade === 'degraded') {
      // Proportional reduction: cut by 50% instead of slamming to min.
      // This lets the system find a steady equilibrium rather than
      // oscillating between burst and flatline.
      for (const key of Object.keys(LIMIT_RANGES) as LimitKey[]) {
        newLimits[key] = Math.round(currentLimits[key] * 0.5);
      }
      newLimits = clampLimits(newLimits);
      adjustment = 'degraded_reduce_50pct';
    } else if (grade === 'healthy' && consecutiveHealthy >= 1) {
      // Ramp up by 20% after 1 healthy cycle (was 30% after 2 cycles).
      // Smaller step + faster trigger = smoother ramp without overshooting.
      for (const key of Object.keys(LIMIT_RANGES) as LimitKey[]) {
        newLimits[key] = Math.round(currentLimits[key] * 1.2);
      }
      newLimits = clampLimits(newLimits);
      adjustment = 'healthy_ramp_20pct';
    }
    // else: healthy first cycle → hold steady (observation period)
  }

  // ── Persist ──
  try {
    await db.collection('system_config').updateOne(
      { _id: 'adaptive_limits' as any },
      {
        $set: {
          limits: newLimits,
          health,
          updated_at: new Date(),
          updated_by: 'adaptive',
          locked,
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error('[adaptive-limits] persist failed:', e);
  }

  // Log decision
  if (logger && adjustment !== 'none') {
    logger.decision('backpressure', `adaptive: ${adjustment} (grade=${grade}, find=${findMs}ms, count=${countMs}ms, jobs=${activeJobs}, cron=${lastCronMs}ms, sqs_ocr=${sqsOcrDepth}, sqs_translate=${sqsTranslateDepth}${jobsCancelled ? `, cancelled=${jobsCancelled}` : ''})`, {
      grade, find_ms: findMs, count_ms: countMs, active_jobs: activeJobs, last_cron_duration_ms: lastCronMs,
      sqs_ocr_depth: sqsOcrDepth, sqs_translate_depth: sqsTranslateDepth, sqs_combined_depth: sqsCombined,
      jobs_cancelled: jobsCancelled, adjustment,
    });
  }

  return { ...newLimits, _health: health };
}

/**
 * Cancel pending (NOT processing) jobs to reduce in-flight pressure.
 * Processing jobs are left alone — they've already started and cancelling them
 * would waste the work done so far.
 */
async function cancelPendingJobs(
  db: Db,
  logger?: { decision: (type: 'skip' | 'backpressure' | 'time_budget' | 'circuit_breaker' | 'early_return' | 'rollback', reason: string, data?: Record<string, unknown>) => void },
): Promise<number> {
  try {
    const result = await db.collection('jobs').updateMany(
      { status: 'pending' },
      {
        $set: {
          status: 'cancelled',
          updated_at: new Date(),
          cancelled_at: new Date(),
          cancelled_by: 'adaptive-limits',
        },
      },
    );
    const cancelled = result.modifiedCount;
    if (cancelled > 0) {
      // Clear book.job references so books can be re-submitted later
      await db.collection('books').updateMany(
        { 'job.job_id': { $exists: true } },
        { $unset: { job: '' }, $set: { updated_at: new Date() } },
      );
      if (logger) {
        logger.decision('circuit_breaker', `adaptive: cancelled ${cancelled} pending jobs`, { jobs_cancelled: cancelled });
      }
    }
    return cancelled;
  } catch (e) {
    console.error('[adaptive-limits] cancelPendingJobs failed:', e);
    return 0;
  }
}

/**
 * Admin override: set specific limits and/or lock adaptive adjustments.
 * Validates against min/max ranges.
 */
export async function setAdaptiveLimits(
  db: Db,
  overrides?: Partial<AdaptiveLimits>,
  locked?: boolean
): Promise<AdaptiveDoc> {
  const doc = await db.collection('system_config').findOne({ _id: 'adaptive_limits' as any }) as unknown as AdaptiveDoc | null;
  const current = doc?.limits ?? defaultLimits();

  const merged = { ...current, ...overrides };
  const clamped = clampLimits(merged);

  const update: Record<string, unknown> = {
    limits: clamped,
    updated_at: new Date(),
    updated_by: 'admin',
  };
  if (locked !== undefined) {
    update.locked = locked;
  }

  await db.collection('system_config').updateOne(
    { _id: 'adaptive_limits' as any },
    { $set: update },
    { upsert: true }
  );

  return (await db.collection('system_config').findOne({ _id: 'adaptive_limits' as any })) as unknown as AdaptiveDoc;
}
