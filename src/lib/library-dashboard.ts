/**
 * Readers and types for the /admin library dashboard (#3943).
 *
 * PRIOR ART: src/lib/dashboard-snapshot.ts — owns the hourly canon/coverage
 * totals and is reused here unchanged; this file adds the DAILY breakdown doc
 * (`system_config.library_dashboard`, written on Hetzner by
 * scripts/analytics/snapshot-library-dashboard.mjs) and the small reads the
 * page needs (metrics snapshot/history, homepage stats). Every function here
 * is a findOne or a bounded find: the page never aggregates on request (#2980).
 */
import type { Db } from 'mongodb';

export const LIBRARY_DASHBOARD_ID = 'library_dashboard';
/** The daily job runs at 05:55 UTC; two missed runs is the signal to look at the Hetzner log. */
export const LIBRARY_DASHBOARD_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

export interface Totals { books: number; pages: number; ocr: number; translated: number; archived: number; blank: number }
export interface LanguageRow { name: string; books: number; pages: number; ocr: number; translated: number }
/** Per-group completion of live books: page sums plus the mean per-book share transcribed / translated and the readable count (ladder predicate). */
export interface CompletionGroup { books: number; pages: number; ocr: number; translated: number; meanOcrPct: number; meanTrPct: number; readable: number; english: number }
export interface CenturyRow extends Partial<CompletionGroup> { label: string; books: number; pages: number }
export interface LanguageAllRow extends CompletionGroup { name: string }
/** 20 bins of 5%: how many live books have that share of pages transcribed / translated. */
export interface Completion { bins: number; ocr: number[]; translated: number[]; books: number }
export type Rung = 'no_text' | 'transcribing' | 'transcribed' | 'translating' | 'readable' | 'complete';
export interface Ladder { en: Partial<Record<Rung, number>>; other: Partial<Record<Rung, number>>; unstamped: number }
export interface StepRow { live: number; hidden: number; pages_live: number; pages_hidden: number }
export interface PipelineDay { day: string; books: number; total: number | null; ocr: number | null; translated: number | null; funnel: Record<string, number | null> }
export interface GeminiDay { day: string; ocr: number; translation: number; enrich: number; other: number; pagesOcr: number; pagesTranslated: number }

export interface LibraryDashboard {
  generatedAt: Date | string;
  elapsedSec: number;
  totals: { live: Totals; all: Totals; readableLive: number; readableAll: number; held: number; feedbackOpen: number; visibleCollections: number };
  byLanguage: LanguageRow[];
  noLanguage: number;
  byCentury: CenturyRow[];
  yearMissing: number;
  ladder: { rungs: Rung[]; live: Ladder; all: Ladder };
  statusLive: { status: string; n: number }[];
  libraries: { name: string; books: number }[];
  noLibrary: number;
  addedByMonth: { month: string; books: number; pages: number }[];
  collections: { name: string; slug: string; texts: number; readable: number; art: number }[];
  nextStep: { steps: Record<string, StepRow>; ocrBacklog: { name: string; books: number; pages: number }[] };
  /** Added 2026-10-01 (second snapshot version); absent on a doc written by the first. */
  completion?: Completion;
  languagesAll?: LanguageAllRow[];
  pipeline: { days: PipelineDay[]; funnel: string[] };
  gemini: GeminiDay[];
}

export interface MetricsHistoryRow {
  date: string; mau: number; avgDau: number; signupsTotal: number; verified: number; humanPvs7: number; dwellMedianSec: number;
  storage?: { r2_bytes: number; r2_objects: number; text_bytes_est: number; pages_total: number };
}

/** The subset of system_config.metrics_snapshot the dashboard renders (full shape: scripts/analytics/snapshot-metrics.mjs). */
export interface MetricsSnapshot {
  generatedAt: Date | string;
  users: { total: number; verified: number; everLoggedIn: number; new30: number; new7: number };
  engagement: { mau: number; avgDau: number; dwellMedianSec: number };
  deltas: { signups7: { now: number; prev: number }; pageviews7: { now: number; prev: number } };
  conversion: { uniqVisitors: number; returningVisitors: number };
  traffic: { humanPvs: number; dailyPageviews: { date: string; hits: number }[] };
  series: { signupsByDay: { date: string; n: number }[] };
  search: { human: number; zeroResult: number; topQueries: { query: string; count: number }[]; zeroQueries: { query: string; count: number }[] };
  missionActions: { download: number; cite: number; share: number };
  social: { feedbackUnread: number };
  readingMembers?: { users: number; sessions: number; books: number; median: number; p90: number; deep: number; veryDeep: number; multiDayUsers: number; multiBookUsers: number; top10PctPageShare: number };
}

export interface HomepageStats { totalBooks: number; translatedToEnglish: number; languageCount: number; authorCount: number; artworkCount: number; illustrationCount: number; firstTranslationCount: number; firstTranslatedWorksProvisional?: number; updatedAt?: Date | string }

const byId = (id: string) => ({ _id: id as unknown as import('mongodb').ObjectId });

export async function readLibraryDashboard(db: Db): Promise<{ data: LibraryDashboard; ageMs: number; stale: boolean } | null> {
  const doc = await db.collection('system_config').findOne(byId(LIBRARY_DASHBOARD_ID));
  if (!doc?.generatedAt) return null;
  const ageMs = Date.now() - new Date(doc.generatedAt).getTime();
  return { data: doc as unknown as LibraryDashboard, ageMs, stale: ageMs > LIBRARY_DASHBOARD_STALE_AFTER_MS };
}

export async function readMetricsSnapshot(db: Db): Promise<{ data: MetricsSnapshot; ageMs: number } | null> {
  const doc = await db.collection('system_config').findOne(byId('metrics_snapshot'));
  if (!doc?.generatedAt) return null;
  return { data: doc as unknown as MetricsSnapshot, ageMs: Date.now() - new Date(doc.generatedAt).getTime() };
}

export async function readHomepageStats(db: Db): Promise<HomepageStats | null> {
  const doc = await db.collection('system_config').findOne(byId('homepage_stats'));
  return (doc as unknown as HomepageStats) ?? null;
}

/** One row per day since the register began (2026-06-28); a few hundred small docs at most. */
export async function readMetricsHistory(db: Db): Promise<MetricsHistoryRow[]> {
  const rows = await db.collection('metrics_history')
    .find({}, { projection: { date: 1, mau: 1, avgDau: 1, signupsTotal: 1, verified: 1, humanPvs7: 1, dwellMedianSec: 1, storage: 1 } })
    .sort({ date: 1 }).limit(2000).toArray();
  return rows as unknown as MetricsHistoryRow[];
}
