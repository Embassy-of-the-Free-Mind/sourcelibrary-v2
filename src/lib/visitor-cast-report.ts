/**
 * Who visits the library (#312): the snapshot /admin/visitors renders.
 *
 * PRIOR ART: src/lib/model-usage-report.ts — the same split (one `ops_reports` document
 * written by a script, the page computes nothing). Written by
 * scripts/audit/visitor-cast.mjs --apply. Absent document → null ("not yet counted").
 */
import { getReadDb } from '@/lib/mongodb';

export const VISITOR_CAST_REPORT_ID = 'visitor-cast';

export interface Ranked { key: string; count: number; pct: number }
export interface Claim extends Ranked { label: string }

export interface CastMember {
  key: string;
  kind: 'readers' | 'pool' | 'walker' | 'declared';
  name: string;
  reads: number;
  share_pct: number;
  addresses: number;
  reads_per_address: number;
  pages_per_book: number;
  books_touched: number;
  where: { deep_page: number; book_root: number; elsewhere: number };
  claims: Claim[];
  hints: Ranked[];
  countries: Ranked[];
  arrives_from: Ranked[];
  hours_utc: number[];
  top_books: { slug: string; reads: number; pct: number; title: string; language: string | null; year: number | null }[];
  languages: Ranked[];
  centuries: Ranked[];
}

export interface Crawler {
  key: string;
  name: string;
  hits: number;
  addresses_at_least: number;
  actions: Ranked[];
  claims: Claim[];
  tried: Ranked[];
  top_books: { slug: string; reads: number; title: string }[];
}

export interface EdgeRule {
  key: string;
  rule_id: string;
  name: string;
  action: 'block' | 'challenge';
  turned_away: number;
  solved: number;
  passed_with_cookie: number;
  solve_rate_pct: number | null;
  addresses_at_least: number | null;
  networks: { name: string; count: number }[];
  claims: { ua: string; count: number; label: string }[];
  tried: { path: string; count: number }[];
}

export interface VisitorCastReport {
  _id: string;
  generated_at: Date;
  generated_by: string;
  window: { since: string; until: string; hours: number };
  page_views: number;
  cast: CastMember[];
  crawlers: Crawler[];
  crawler_days: string[];
  edge: EdgeRule[] | null;
  edge_since: string | null;
  edge_error: string | null;
  method: string;
}

/** Throws on a database error; null only when the script has never written it. */
export async function getVisitorCastReport(): Promise<VisitorCastReport | null> {
  const db = await getReadDb();
  return db
    .collection<VisitorCastReport>('ops_reports')
    .findOne({ _id: VISITOR_CAST_REPORT_ID }, { maxTimeMS: 10000 });
}

const n = (v: number) => Math.round(v).toLocaleString('en-US');

/**
 * Two or three plain sentences describing a kind of visitor as one person would be
 * described: how many of them, how they arrive, how far they read. Every clause is a
 * number from the card; nothing here is a judgement the numbers do not carry.
 */
export function portrait(c: CastMember): string {
  const bookViews = c.where.deep_page + c.where.book_root;
  const deepShare = bookViews ? c.where.deep_page / bookViews : 0;
  const parts: string[] = [];
  parts.push(
    c.addresses === 1
      ? `One address, ${n(c.reads)} pages in a day.`
      : `${n(c.addresses)} addresses, ${c.reads_per_address < 1.15 ? 'about one page each' : `${c.reads_per_address} pages each on average`}.`,
  );
  const from = c.arrives_from[0];
  if (from) {
    const where = deepShare > 0.7 ? 'straight onto a page deep inside a book' : deepShare < 0.3 ? 'mostly at a book’s front door' : 'about half the time deep inside a book';
    parts.push(`${from.pct}% arrive from ${from.key}, ${where}.`);
  }
  if (bookViews) {
    parts.push(
      c.pages_per_book <= 1.05
        ? `They never turn a second page of the same book (${n(c.books_touched)} books touched).`
        : `On a book they open they read ${c.pages_per_book} pages (${n(c.books_touched)} books touched).`,
    );
  }
  return parts.join(' ');
}
