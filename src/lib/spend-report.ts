/**
 * Private spend & unit-cost report (/admin/spend, #5225).
 *
 * PRIOR ART: src/lib/auth-helpers.ts (requireInnerCircle / isPlatformSuperadmin) — the
 * role gates there answer "is this an admin?"; this page needs a NAMED allow-list
 * narrower than any role, and a second, narrower list for the people/hours sections.
 *
 * The public repo (AGPL) holds only the renderer. Every figure, invoice, vendor
 * note, narrative sentence and person's name lives in ONE private Mongo document
 * written by the ops repo's `costs/spend-dashboard/build-data.py --push`. The
 * allow-lists live in a sibling document so a data refresh can never widen access
 * and an access change never needs a data rebuild. Both are read server-side, after
 * the gate, and nothing here is reachable through an API route.
 *
 * Why Mongo and not R2 or env: the ops scripts already hold MONGODB_URI (they
 * read `books` for the backlog tally), the document is ~40 KB, and a refresh must
 * not require a deploy — an env var would. Fail-closed throughout: no access
 * document → only platform superadmins pass; no data document → the page says so.
 */
import { redirect } from 'next/navigation';
import type { Session } from 'next-auth';
import { getDb } from '@/lib/mongodb';
import { getSession, isPlatformSuperadmin } from '@/lib/auth-helpers';

export const OPS_REPORTS_COLLECTION = 'ops_reports';
export const SPEND_REPORT_ID = 'spend-dashboard';
export const SPEND_ACCESS_ID = 'spend-dashboard-access';
export const SPEND_REPORT_SCHEMA_VERSION = 1;

export type Grade = 'settled' | 'est' | 'unknown' | 'export';

export interface MonthlyVendorCell { v: number; grade: Grade; note?: string }
export interface MonthlyRow { month: string; vendors: Record<string, MonthlyVendorCell> }
export interface DailyRow { day: string; byDriver: number[]; byProject: number[] }
export interface SkuRow { month: string; project: string; service: string; sku: string; cost: number }
export interface PerBookRow { category: string; what: string; low: number; high: number }
export interface BacklogRow {
  lane: 'hidden' | 'live'; category: string; books: number; pages: number;
  ocr_pages_needed: number; translation_pages_needed: number; low_usd: number; high_usd: number;
}
export interface BacklogSummary { books: number; ocr_pages: number; tr_pages: number; low_usd: number; high_usd: number }
export interface ExampleRow {
  title: string; url: string; lang: string; source: string; note?: string; pages: number;
  ocr: number; translation: number; images: number; other: number; total: number;
}
/** One edition language (books.language, first listed), from the ops lang-projection.py. */
export interface LanguageRow {
  language: string; books: number; live_books?: number; hidden_books?: number; pages: number;
  pages_ocr: number; pages_translated: number; books_done: number; books_started: number;
  ocr_pages_needed: number; translation_pages_needed: number;
  low_usd: number; high_usd: number; live_low_usd?: number; live_high_usd?: number;
}
export interface OutputMonth { month: string; ocr_pages: number; translated_pages: number }
export interface HoursMonth { hours: number; active_days: number; prompts: number }
export interface Person { name: string; role: string; monthly_usd: number | null; note?: string }

/**
 * Prose that carries figures or names. Authored in the ops repo
 * (`costs/spend-dashboard/narrative.json`), never here. Rendered as plain text
 * except `findings` / `checks_findings`, whose items may carry `<b>` and `<a>`.
 */
export interface SpendNarrative {
  languages_intro?: string;
  findings_as_of?: string;
  findings?: string[];
  still_unknown?: string;
  output_intro?: string;
  per_book_intro?: string;
  checks_intro?: string;
  checks_findings?: string[];
  backlog_intro?: string;
  phase_intro?: string;
  hours_intro?: string;
  people_intro?: string;
  notes?: string[];
  /** Denominator for the all-in cost per book tile (books ≥90% translated). */
  per_book_denominator?: number;
  /** Column labels for `phases`, in display order; keys match `phases`. */
  phase_columns?: { key: string; label: string }[];
  /** Daily AI budgets for the pace table; `note` marks e.g. the current dial. */
  pace_budgets?: { usd_per_day: number; note?: string }[];
}

export interface SpendData {
  generated: string;
  gcpFrom: string;
  gcpTo: string;
  drivers: string[];
  projects: string[];
  daily: DailyRow[];
  skus: SkuRow[];
  monthly: { note?: string; vendors: string[]; months: MonthlyRow[]; excluded: string[]; people?: Person[] };
  /** { aug: {stage: usd}, sep: {...} } — keys are the ops script's month labels. */
  phases?: Record<string, Record<string, number>> | null;
  hours?: { months: Record<string, HoursMonth> } | null;
  projection?: {
    per_book: PerBookRow[];
    backlog: BacklogRow[];
    summary: Record<'hidden' | 'live', BacklogSummary>;
    checks?: { examples: ExampleRow[] };
    measured?: string;
  } | null;
  output?: {
    months: OutputMonth[];
    books_90pct_translated: number;
    books_any_translation: number;
    pages_translated_total: number;
    pages_ocr_total: number;
    measured?: string;
  } | null;
  /** Progress and remaining cost by language; absent in documents pushed before 2026-09-29. */
  languages?: LanguageRow[] | null;
  /** Per-book completion histograms, 1% bins (index 100 = complete), over books with any OCR. */
  completion?: { ocr: number[]; translation: number[]; books_with_ocr: number; non_english_with_ocr: number } | null;
  text?: SpendNarrative;
}

export interface SpendReportDoc {
  _id: string;
  schema_version: number;
  generated_at: Date | string;
  generated_by: string;
  data: SpendData;
}

export interface SpendAccessDoc {
  _id: string;
  /** Emails allowed to open the page. Platform superadmins pass regardless. */
  viewers: string[];
  /** Emails allowed to see the hours and people sections. NO superadmin fallback. */
  people_viewers: string[];
}

function norm(e: unknown): string {
  return typeof e === 'string' ? e.trim().toLowerCase() : '';
}

export async function getSpendAccess(): Promise<SpendAccessDoc | null> {
  try {
    const db = await getDb();
    const doc = await db
      .collection<SpendAccessDoc>(OPS_REPORTS_COLLECTION)
      .findOne({ _id: SPEND_ACCESS_ID } as Record<string, unknown>);
    if (!doc) return null;
    return {
      _id: doc._id,
      viewers: Array.isArray(doc.viewers) ? doc.viewers.map(norm).filter(Boolean) : [],
      people_viewers: Array.isArray(doc.people_viewers) ? doc.people_viewers.map(norm).filter(Boolean) : [],
    };
  } catch {
    return null; // fail closed: no list → nobody but superadmins
  }
}

export interface SpendViewer {
  session: Session;
  email: string;
  /** May see the hours and people sections. */
  canSeePeople: boolean;
}

/**
 * Decide, without redirecting. Exported so the admin nav and the tests ask the
 * same question the page asks. `null` = not allowed.
 */
export async function resolveSpendViewer(session: Session | null): Promise<SpendViewer | null> {
  const email = norm(session?.user?.email);
  if (!session?.user || !email) return null;
  const access = await getSpendAccess();
  const superadmin = await isPlatformSuperadmin(email);
  const listed = Boolean(access?.viewers.includes(email));
  if (!superadmin && !listed) return null;
  const canSeePeople = Boolean(access?.people_viewers.includes(email));
  return { session, email, canSeePeople };
}

/** Page-side gate. Signed-out → sign-in; signed-in but not listed → /unauthorized. */
export async function requireSpendViewer(): Promise<SpendViewer> {
  const session = await getSession();
  if (!session?.user) redirect('/auth/signin');
  const viewer = await resolveSpendViewer(session);
  if (!viewer) redirect('/unauthorized');
  return viewer;
}

export async function getSpendReport(): Promise<SpendReportDoc | null> {
  const db = await getDb();
  const doc = await db
    .collection<SpendReportDoc>(OPS_REPORTS_COLLECTION)
    .findOne({ _id: SPEND_REPORT_ID } as Record<string, unknown>);
  if (!doc || !doc.data) return null;
  return doc;
}

/** Strip the people-only sections for viewers not on that list. Never mutates. */
export function redactForViewer(data: SpendData, viewer: SpendViewer): SpendData {
  if (viewer.canSeePeople) return data;
  const { hours: _hours, ...rest } = data;
  void _hours;
  const { people: _people, ...monthly } = data.monthly;
  void _people;
  let text: SpendNarrative | undefined;
  if (data.text) {
    const { hours_intro: _h, people_intro: _p, ...keep } = data.text;
    void _h; void _p;
    text = keep;
  }
  return { ...rest, hours: null, monthly, text };
}
