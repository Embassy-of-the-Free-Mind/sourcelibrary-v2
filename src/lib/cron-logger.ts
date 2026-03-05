import { getDb } from '@/lib/mongodb';

export type CronName =
  | 'post-import-pipeline'
  | 'enrich-books'
  | 'process-batches'
  | 'sync-page-counts'
  | 'sync-gallery-images'
  | 'archive-ocr'
  | 'submit-batch-ocr'
  | 'submit-ocr'
  | 'social-post'
  | 'social-reset';

export type CronRunStatus = 'success' | 'partial' | 'failed';

export interface CronDecision {
  type: 'skip' | 'backpressure' | 'time_budget' | 'circuit_breaker' | 'early_return' | 'rollback';
  reason: string;
  data?: Record<string, unknown>;
}

export interface CronError {
  message: string;
  phase?: string;
  book_id?: string;
  category?: string;
}

export interface CronRunRecord {
  cron: CronName;
  timestamp: Date;
  duration_ms: number;
  status: CronRunStatus;
  failed: boolean;
  actions: Record<string, number>;
  decisions: CronDecision[];
  errors: CronError[];
  error_count: number;
  summary: string;
}

const MAX_DECISIONS = 100;

class CronLogger {
  private cron: CronName;
  private startTime: number;
  private actions: Record<string, number> = {};
  private decisions: CronDecision[] = [];
  private errors: CronError[] = [];
  private _status: CronRunStatus = 'success';

  constructor(cron: CronName) {
    this.cron = cron;
    this.startTime = Date.now();
  }

  /** Increment an action counter */
  action(name: string, count = 1): this {
    this.actions[name] = (this.actions[name] || 0) + count;
    return this;
  }

  /** Set multiple action counters at once */
  setActions(actions: Record<string, number>): this {
    for (const [k, v] of Object.entries(actions)) {
      this.actions[k] = v;
    }
    return this;
  }

  /** Record an invisible decision (skip, backpressure, etc.) */
  decision(type: CronDecision['type'], reason: string, data?: Record<string, unknown>): this {
    if (this.decisions.length < MAX_DECISIONS) {
      this.decisions.push({ type, reason, ...(data ? { data } : {}) });
    }
    return this;
  }

  /** Convenience: skipped work */
  skip(reason: string, data?: Record<string, unknown>): this {
    return this.decision('skip', reason, data);
  }

  /** Convenience: backpressure limit hit */
  backpressure(limit: string, data?: Record<string, unknown>): this {
    return this.decision('backpressure', limit, data);
  }

  /** Convenience: time budget exhausted */
  timeBudgetExhausted(phase: string): this {
    return this.decision('time_budget', `Exhausted at ${phase}`);
  }

  /** Record an error */
  error(message: string, extra?: { phase?: string; book_id?: string; category?: string }): this {
    this.errors.push({ message, ...extra });
    return this;
  }

  /** Record errors from a string array (backwards compat with existing log.errors patterns) */
  addErrors(errors: string[]): this {
    for (const e of errors) {
      this.errors.push({ message: e });
    }
    return this;
  }

  /** Mark run as failed */
  setFailed(): this {
    this._status = 'failed';
    return this;
  }

  /** Mark run as partial (some work done, some errors) */
  setPartial(): this {
    if (this._status !== 'failed') {
      this._status = 'partial';
    }
    return this;
  }

  /** Auto-detect status from errors */
  private resolveStatus(): CronRunStatus {
    if (this._status === 'failed') return 'failed';
    if (this.errors.length > 0) return 'partial';
    return this._status;
  }

  /** Build human-readable summary from action counters */
  private buildSummary(): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(this.actions)) {
      if (v > 0) parts.push(`${k}: ${v}`);
    }
    if (this.errors.length > 0) {
      parts.push(`errors: ${this.errors.length}`);
    }
    if (this.decisions.length > 0) {
      const bp = this.decisions.filter(d => d.type === 'backpressure').length;
      const tb = this.decisions.filter(d => d.type === 'time_budget').length;
      if (bp > 0) parts.push(`backpressure: ${bp}`);
      if (tb > 0) parts.push(`time_budget: ${tb}`);
    }
    return parts.join(', ') || 'no-op';
  }

  /** Get duration in ms since creation */
  get durationMs(): number {
    return Date.now() - this.startTime;
  }

  /** Write the cron run record to MongoDB. Non-blocking — catches errors. */
  async flush(): Promise<void> {
    const status = this.resolveStatus();
    const record: CronRunRecord = {
      cron: this.cron,
      timestamp: new Date(),
      duration_ms: this.durationMs,
      status,
      failed: status === 'failed',
      actions: this.actions,
      decisions: this.decisions,
      errors: this.errors,
      error_count: this.errors.length,
      summary: this.buildSummary(),
    };

    try {
      const db = await getDb();
      await db.collection('cron_runs').insertOne(record);
    } catch (e) {
      console.error(`[cron-logger] flush failed for ${this.cron}:`, e);
    }
  }
}

/** Create a new cron logger. Call flush() when done. */
export function createCronLogger(cron: CronName): CronLogger {
  return new CronLogger(cron);
}
