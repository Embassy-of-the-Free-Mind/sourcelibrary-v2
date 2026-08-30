import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { applyBphFilters, readBphFilters } from '@/lib/bph-catalog-filters';

/**
 * GET /api/catalog/bph/export — the current catalogue search, as a spreadsheet.
 * POST — a hand-picked selection of records, as the same spreadsheet.
 *
 * Asked for by José Bouman (BPH), 2026-08-12:
 *
 *   "Is it possible to export a search selection? I would like to have all
 *    books which have JRR in one of the fields.... This is an important
 *    feature, that we often! use!"
 *
 * and 2026-08-26 (#4252): "need a way to make selections from the catalog …
 * and then export the selections to be downloaded" — that is the POST: the
 * browser's checkbox basket submits `keys` (UBNs and, for the 2,012 records
 * that have none, uuids) and gets back exactly those rows, in pick order.
 *
 * The GET takes exactly the query string the browsing API takes, and runs it
 * through the SAME filter module (src/lib/bph-catalog-filters.ts) — so
 * "export" always means "the rows I am looking at", never a near-miss. Only
 * `offset`/`limit` are ignored: an export is the whole selection, not the
 * visible page.
 *
 * Public, like the catalogue itself. The staff-only columns (internal_remarks,
 * exhibition_history) are deliberately NOT in the export — they are not public
 * on the detail page either, and an export is the easiest way to leak a field
 * by accident. An editor-scoped export can be added later if the librarians
 * want their working notes included.
 */

export const dynamic = 'force-dynamic';

// Hard ceiling. The whole catalogue is ~29,900 rows, so this exports everything
// even unfiltered; it exists to bound memory, not to trim results. If a future
// catalogue outgrows it the response says so in a trailing note rather than
// silently truncating — a short export that looks complete is the failure mode
// worth engineering against.
const MAX_ROWS = 50_000;
const PAGE = 1000; // supabase-js silently caps a select at 1000 rows

// Column order follows the catalogue card: what a librarian reads first comes
// first. `full_title` sits beside `title` because manuscripts use one and
// printed books the other.
const EXPORT_COLUMNS: Array<{ key: string; header: string }> = [
  { key: 'ubn', header: 'UBN' },
  { key: 'record_type', header: 'Record type' },
  { key: 'shelf_mark', header: 'Shelf mark' },
  { key: 'state_shelf_mark', header: 'State Collection shelf mark' },
  { key: 'present_location', header: 'Present location' },
  { key: 'title', header: 'Short title' },
  { key: 'full_title', header: 'Full title' },
  { key: 'parallel_title', header: 'Full title (transcription)' },
  { key: 'uniform_title', header: 'Variant title' },
  { key: 'series_title', header: 'Series' },
  { key: 'volume_title', header: 'Volume' },
  { key: 'author', header: 'Author' },
  { key: 'variant_author', header: 'Author (as on title page)' },
  { key: 'pseudonym', header: 'Pseudonym' },
  { key: 'editor', header: 'Editor / translator' },
  { key: 'variant_editor', header: 'Editor (as on title page)' },
  { key: 'year', header: 'Year' },
  { key: 'place', header: 'Place' },
  { key: 'printer', header: 'Printer' },
  { key: 'publisher', header: 'Publisher' },
  { key: 'impressum_original', header: 'Original impressum' },
  { key: 'language', header: 'Language' },
  { key: 'keywords', header: 'Keywords' },
  { key: 'object_size_cm', header: 'Object size (cm)' },
  { key: 'bibliographic_format', header: 'Format' },
  { key: 'number_of_copies', header: 'Copies held' },
  { key: 'binding', header: 'Binding' },
  { key: 'bound_with', header: 'Bound with' },
  { key: 'provenance', header: 'Provenance' },
  { key: 'collection', header: 'Collection' },
  { key: 'bibliography', header: 'Bibliography' },
  { key: 'remarks', header: 'Remarks' },
  { key: 'ustc_sn', header: 'USTC' },
  { key: 'ia_identifier', header: 'Internet Archive id' },
  { key: 'uuid', header: 'Record id' },
];

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would
 * execute. A catalogue field can legitimately begin with "=" or "-" (a shelf
 * mark, a transcribed title), and Excel treats those as formulas — CSV
 * injection, and a real hazard for a file a librarian opens by double-clicking.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Shared CSV response builder for both export modes. */
function csvResponse(
  rows: Array<Record<string, unknown>>,
  filenameTerm: string,
  notes: string[],
): NextResponse {
  const lines = [EXPORT_COLUMNS.map((c) => csvEscape(c.header)).join(',')];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => csvEscape(row[c.key])).join(','));
  }
  for (const note of notes) {
    lines.push('');
    lines.push(csvEscape(note));
  }

  // A named, dated file: a librarian ends up with several of these in Downloads
  // and needs to tell them apart.
  const stamp = new Date().toISOString().slice(0, 10);
  const term = filenameTerm.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const filename = `bph-catalogue${term ? `-${term}` : ''}-${stamp}.csv`;

  // The BOM makes Excel read it as UTF-8; without it, every "Böhme" in the
  // export opens as "BÃ¶hme" on a default Windows install.
  return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}

// Same alphabet the create route allows for a UBN; uuids fit it too. Anything
// else in a submitted key list is attacker-shaped, not librarian-shaped.
const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_KEYS = 5_000;
// Keys per `.in()` query. supabase-js sends filters in the URL, so one query
// with thousands of keys would blow the URL limit; chunking keeps each request
// small and bounded.
const KEYS_PER_QUERY = 100;

/**
 * POST /api/catalog/bph/export — export a hand-picked selection.
 *
 * Body (form-encoded, so a plain <form> submit downloads the file):
 *   keys=<whitespace/comma-separated UBNs and uuids>
 *
 * Rows come back in the order they were picked, and any key that matches no
 * record is reported in a trailing NOTE — a shorter-than-expected export must
 * say so, never just look complete.
 */
export async function POST(req: NextRequest) {
  let raw = '';
  try {
    const form = await req.formData();
    raw = String(form.get('keys') ?? '');
  } catch {
    return NextResponse.json({ error: 'Expected form data with a "keys" field' }, { status: 400 });
  }

  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const key = part.trim();
    if (!key || seen.has(key)) continue;
    if (!KEY_RE.test(key)) {
      return NextResponse.json({ error: `Invalid record key: "${key.slice(0, 80)}"` }, { status: 400 });
    }
    seen.add(key);
    keys.push(key);
  }
  if (keys.length === 0) {
    return NextResponse.json({ error: 'No records selected' }, { status: 400 });
  }
  if (keys.length > MAX_KEYS) {
    return NextResponse.json(
      { error: `Selection too large (${keys.length} records; the limit is ${MAX_KEYS}). Use the search export instead.` },
      { status: 400 },
    );
  }

  const ubns = keys.filter((k) => !UUID_RE.test(k));
  const uuids = keys.filter((k) => UUID_RE.test(k));
  const columns = EXPORT_COLUMNS.map((c) => c.key).join(', ');

  // key (ubn or uuid) → row. A row is registered under both its keys so the
  // reorder below finds it whichever one the client selected by.
  const byKey = new Map<string, Record<string, unknown>>();
  const chunks: Array<{ column: 'ubn' | 'uuid'; values: string[] }> = [];
  for (let i = 0; i < ubns.length; i += KEYS_PER_QUERY) {
    chunks.push({ column: 'ubn', values: ubns.slice(i, i + KEYS_PER_QUERY) });
  }
  for (let i = 0; i < uuids.length; i += KEYS_PER_QUERY) {
    chunks.push({ column: 'uuid', values: uuids.slice(i, i + KEYS_PER_QUERY) });
  }
  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('bph_works')
      .select(columns)
      .in(chunk.column, chunk.values);
    if (error) {
      console.error('[catalog/bph/export] selection query failed:', error);
      return NextResponse.json({ error: 'Export failed — please try again' }, { status: 500 });
    }
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      if (typeof row.ubn === 'string' && row.ubn) byKey.set(row.ubn, row);
      if (typeof row.uuid === 'string' && row.uuid) byKey.set(row.uuid.toLowerCase(), row);
    }
  }

  const rows: Array<Record<string, unknown>> = [];
  const missing: string[] = [];
  for (const key of keys) {
    const row = byKey.get(UUID_RE.test(key) ? key.toLowerCase() : key);
    if (row) rows.push(row);
    else missing.push(key);
  }

  const notes = missing.length
    ? [`NOTE: ${missing.length} selected record(s) were not found and are not in this export: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', …' : ''}`]
    : [];
  return csvResponse(rows, `selection-${rows.length}`, notes);
}

export async function GET(req: NextRequest) {
  const filters = readBphFilters(req.nextUrl.searchParams);

  const rows: Array<Record<string, unknown>> = [];
  let truncated = false;

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let query = supabase.from('bph_works').select(EXPORT_COLUMNS.map((c) => c.key).join(', '));
    query = applyBphFilters(query, filters, {
      mode: 'new',
      hasNormalizedColumns: true,
      hasFirstTranslationColumn: true,
    });
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) {
      console.error('[catalog/bph/export] query failed:', error);
      return NextResponse.json({ error: 'Export failed — please try again' }, { status: 500 });
    }
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE) break;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }

  // Never let a cap pass for a complete answer.
  const notes = truncated
    ? [`NOTE: export capped at ${MAX_ROWS} rows — narrow the search and export again.`]
    : [];
  // The search term goes in the filename when there is one.
  const termRaw = filters.q || filters.author || filters.title || filters.shelfMark || '';
  return csvResponse(rows, termRaw, notes);
}
