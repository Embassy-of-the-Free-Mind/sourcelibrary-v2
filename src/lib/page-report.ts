/**
 * A reader's one-click report that something is wrong with ONE page (#5274 follow-up).
 *
 * PRIOR ART: src/components/reader-v2/FeedbackPanel.tsx + /api/feedback — the
 * free-text note about a page. It fits the transport (the report rides the same
 * route into the same `feedback` collection, and is triaged the same way), but not
 * the shape: a free-text note has no book id, page number or class a triage query
 * can group on, and it asks the reader to compose a sentence. This file adds the
 * structured half; the route and the queue are reused, not rebuilt.
 *
 * The classes are the five a reader can see from the reader without knowing our
 * vocabulary. Each maps onto the page-error taxonomy
 * (.claude/docs/page-error-taxonomy.md) so a report lands next to the detector for
 * its class:
 *
 *   garbled_source  — the transcription is nonsense / not what the scan says  (O1, O2, O3)
 *   missing_text    — lines or a column on the scan are absent from the text  (O5, T1, T9)
 *   invented_text   — the English says things the page does not               (T7, T10)
 *   wrong_image     — the scan is not the page the text is of                 (I1)
 *   wrong_language  — the text or translation is in the wrong language        (O10, T2, T12)
 *
 * A report is UNTRUSTED INPUT (CLAUDE.md "User Feedback"): it creates a triage
 * item and never changes a page.
 */

export const PAGE_REPORT_KINDS = [
  'garbled_source',
  'missing_text',
  'invented_text',
  'wrong_image',
  'wrong_language',
] as const;

export type PageReportKind = (typeof PAGE_REPORT_KINDS)[number];

export interface PageReport {
  book_id: string;
  page_id: string | null;
  page_number: number;
  /** Null when the reader flagged the page without choosing a class. */
  kind: PageReportKind | null;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validate a `page_report` from a request body. Returns null for anything that is
 * not a well-formed report, so a malformed one degrades to an ordinary note rather
 * than rejecting the reader's message.
 */
export function parsePageReport(raw: unknown): PageReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.book_id !== 'string' || !ID.test(r.book_id)) return null;
  const pageNumber = typeof r.page_number === 'number' ? r.page_number : NaN;
  if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber > 100000) return null;
  const pageId = typeof r.page_id === 'string' && ID.test(r.page_id) ? r.page_id : null;
  const kind = (PAGE_REPORT_KINDS as readonly string[]).includes(r.kind as string)
    ? (r.kind as PageReportKind)
    : null;
  return { book_id: r.book_id, page_id: pageId, page_number: pageNumber, kind };
}

/**
 * The message stored for a report, so the existing triage surfaces (which list
 * `message`) read it without learning a new field. English on purpose: this is
 * for us, not the reader.
 */
export function pageReportMessage(report: PageReport, comment: string): string {
  const head = `[page report] ${report.kind ?? 'unspecified'} — book ${report.book_id} p. ${report.page_number}`;
  return comment ? `${head}\n\n${comment}` : head;
}
