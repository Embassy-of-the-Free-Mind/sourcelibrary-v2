/**
 * PRIOR ART: scripts/lib/book-checks.mjs is the writer (recordBookCheck(), the row schema, the registry check);
 * src/lib/book-history.ts assembles a book's provenance timeline from audit_log, never QA verdicts. This is the
 * read side of book_checks for the API (#6174): latest row per method, and whether the text a check read is
 * still the text on the page.
 */
import type { Db } from 'mongodb';

export type CheckVerdict = 'show' | 'caveat' | 'fix';

export interface CheckProvenance {
  page_number: number;
  page_id?: string | null;
  ocr_model: string | null;
  translation_model: string | null;
  ocr_updated_at?: Date | string | null;
  translation_updated_at?: Date | string | null;
  changed_since_check?: boolean;
  unknown_reason?: string;
  source?: string;
}

export type FindingStage = 'ocr' | 'translation' | 'other';

/** One page with a serious finding (#6199). A page read and found clean has no entry. */
export interface PageFinding {
  page_number: number;
  wrong_page?: true;
  errors: { stage: FindingStage; class?: string; problem?: string }[];
}

export interface BookCheck {
  book_id: string;
  checked_at: Date;
  method_id: string;
  method_version: string;
  run_id: string;
  frame?: Record<string, unknown>;
  pages_read: number[];
  reader: { kind: 'model' | 'human' | 'detector'; model?: string; role?: string; image_opened: boolean | 'unrecorded' };
  verdict: CheckVerdict;
  verdict_source?: string;
  classes?: string[];
  note?: string;
  /** Absent = the run kept no per-page record; `[]` = every page read was free of serious errors. */
  page_findings?: PageFinding[];
  evidence_path: string;
  text_provenance: CheckProvenance[];
  api_usd?: number;
  subscription_usd_eq?: number;
}

export interface PageTextStamp {
  page_number: number;
  ocr?: { updated_at?: Date | string | null } | null;
  translation?: { updated_at?: Date | string | null } | null;
}

/** Most recent row per method_id. `rows` must be sorted newest first. */
export function latestPerMethod(rows: BookCheck[]): Record<string, BookCheck> {
  const out: Record<string, BookCheck> = {};
  for (const r of rows) if (!out[r.method_id]) out[r.method_id] = r;
  return out;
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);

/**
 * Pages whose text changed after the check read them: the check no longer describes what a reader sees there.
 * A page is stale when the row already says so (changed_since_check), or when the page's current OCR or translation
 * is newer than the stamp the row recorded (or, with no stamp, newer than checked_at). A page record that is gone
 * counts as stale.
 */
export function stalePages(row: BookCheck, pages: Map<number, PageTextStamp>): number[] {
  const checked = new Date(row.checked_at).getTime();
  const out: number[] = [];
  for (const e of row.text_provenance) {
    const now = pages.get(e.page_number);
    if (e.changed_since_check || !now) { out.push(e.page_number); continue; }
    const ocrNow = ms(now.ocr?.updated_at), trNow = ms(now.translation?.updated_at);
    const ocrThen = ms(e.ocr_updated_at) ?? checked, trThen = ms(e.translation_updated_at) ?? checked;
    if ((ocrNow !== null && ocrNow > ocrThen) || (trNow !== null && trNow > trThen)) out.push(e.page_number);
  }
  return out;
}

const HISTORY_LIMIT = 500;

/**
 * All checks of one book, newest first, with the latest per method and its stale pages. Two indexed queries:
 * book_checks on {book_id, checked_at} and pages on {book_id, page_number} for the latest rows' pages only.
 * `bookIds` is the book's `id` and, when it differs, its `_id` as a string (book-deletion-and-identity.md).
 */
export async function getBookChecks(db: Db, bookIds: string[]) {
  const history = (await db.collection('book_checks')
    .find({ book_id: { $in: bookIds } }, { projection: { _id: 0, recorded_at: 0, recorded_by: 0 } })
    .sort({ checked_at: -1 })
    .limit(HISTORY_LIMIT)
    .toArray()) as unknown as BookCheck[];
  const latest = latestPerMethod(history);
  const nums = [...new Set(Object.values(latest).flatMap((r) => r.text_provenance.map((e) => e.page_number)))];
  const pages = new Map<number, PageTextStamp>();
  if (nums.length) {
    const rows = await db.collection('pages')
      .find({ book_id: { $in: bookIds }, page_number: { $in: nums } }, { projection: { _id: 0, page_number: 1, 'ocr.updated_at': 1, 'translation.updated_at': 1 } })
      .toArray();
    for (const p of rows) pages.set(p.page_number as number, p as unknown as PageTextStamp);
  }
  const latestWithStale = Object.fromEntries(Object.entries(latest).map(([m, r]) => {
    const stale = stalePages(r, pages);
    return [m, { ...r, stale_pages: stale, stale: stale.length > 0 }];
  }));
  return { latest: latestWithStale, history, truncated: history.length === HISTORY_LIMIT };
}
