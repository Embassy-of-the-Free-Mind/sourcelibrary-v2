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
} as const;

export type LimitKey = keyof typeof LIMIT_RANGES;
export type AdaptiveLimits = Record<LimitKey, number>;
export type HealthGrade = 'healthy' | 'degraded' | 'critical';

interface HealthState {
  grade: HealthGrade;
  find_ms: number;
  count_ms: number;
  active_jobs: number;
  last_cron_duration_ms: number;
  sample_book_id: string | null;
  measured_at: Date;
  consecutive_healthy: number;
  consecutive_degraded: number;
}

interface AdaptiveDoc {
  _id: 'adaptive_limits';
  limits: AdaptiveLimits;
  health: HealthState;
  updated_at: Date;
  updated_by: 'adaptive' | 'admin';
  locked: boolean;
}

/** Default limits (used to seed the document on first run) */
function defaultLimits(): AdaptiveLimits {
  const limits = {} as AdaptiveLimits;
  for (const [key, range] of Object.entries(LIMIT_RANGES)) {
    limits[key as LimitKey] = range.default;
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
  if (active > 50) return 'critical';
  if (active > 30) return 'degraded';
  return 'healthy';
}

function gradeCronDuration(ms: number): HealthGrade {
  if (ms > 180_000) return 'critical';
  if (ms > 60_000) return 'degraded';
  return 'healthy';
}

/** Composite: worst of three signals */
function compositeGrade(latency: HealthGrade, jobs: HealthGrade, cron: HealthGrade): HealthGrade {
  if (latency === 'critical' || jobs === 'critical' || cron === 'critical') return 'critical';
  if (latency === 'degraded' || jobs === 'degraded' || cron === 'degraded') return 'degraded';
  return 'healthy';
}

/**
 * Probe DB health, adjust limits, return current limits for the pipeline cron.
 * Writes health + limits to system_config.adaptive_limits.
 *
 * @param logger - optional CronLogger for decision recording
 */
export async function getAdaptiveLimits(
  db: Db,
  logger?: { decision: (type: 'skip' | 'backpressure' | 'time_budget' | 'circuit_breaker' | 'early_return' | 'rollback', reason: string, data?: Record<string, unknown>) => void }
): Promise<AdaptiveLimits & { _health: HealthState }> {
  const doc = await db.collection('system_config').findOne({ _id: 'adaptive_limits' as any }) as unknown as AdaptiveDoc | null;

  // Seed on first run
  const currentLimits: AdaptiveLimits = doc?.limits ?? defaultLimits();
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
      status: { $in: ['pending', 'processing'] },
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

  // ── Grade ──
  const grade = compositeGrade(
    gradeLatency(findMs, countMs),
    gradeJobs(activeJobs),
    gradeCronDuration(lastCronMs)
  );

  const consecutiveHealthy = grade === 'healthy' ? (prevHealth?.consecutive_healthy ?? 0) + 1 : 0;
  const consecutiveDegraded = grade === 'degraded' ? (prevHealth?.consecutive_degraded ?? 0) + 1 : 0;

  const health: HealthState = {
    grade,
    find_ms: findMs,
    count_ms: countMs,
    active_jobs: activeJobs,
    last_cron_duration_ms: lastCronMs,
    sample_book_id: sampleBookId,
    measured_at: new Date(),
    consecutive_healthy: consecutiveHealthy,
    consecutive_degraded: consecutiveDegraded,
  };

  // ── Adjust limits (unless admin-locked) ──
  let newLimits = { ...currentLimits };
  let adjustment = 'none';

  if (!locked) {
    if (grade === 'critical') {
      // Slam to minimums
      for (const [key, range] of Object.entries(LIMIT_RANGES)) {
        newLimits[key as LimitKey] = range.min;
      }
      adjustment = 'critical_slam_to_min';
    } else if (grade === 'degraded') {
      // Cut by 50%
      for (const key of Object.keys(LIMIT_RANGES) as LimitKey[]) {
        newLimits[key] = Math.round(currentLimits[key] * 0.5);
      }
      newLimits = clampLimits(newLimits);
      adjustment = 'degraded_cut_50pct';
    } else if (grade === 'healthy' && consecutiveHealthy >= 2) {
      // Ramp up by 30%
      for (const key of Object.keys(LIMIT_RANGES) as LimitKey[]) {
        newLimits[key] = Math.round(currentLimits[key] * 1.3);
      }
      newLimits = clampLimits(newLimits);
      adjustment = 'healthy_ramp_30pct';
    }
    // else: healthy but first cycle → hold steady
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
    logger.decision('backpressure', `adaptive: ${adjustment} (grade=${grade}, find=${findMs}ms, count=${countMs}ms, jobs=${activeJobs}, cron=${lastCronMs}ms)`, {
      grade, find_ms: findMs, count_ms: countMs, active_jobs: activeJobs, last_cron_duration_ms: lastCronMs, adjustment,
    });
  }

  return { ...newLimits, _health: health };
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
