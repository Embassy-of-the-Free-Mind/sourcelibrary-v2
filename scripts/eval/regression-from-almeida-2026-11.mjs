#!/usr/bin/env node
/**
 * Turn a member's 459-line defect report (Emanuel Almeida, feedback 2026-11-07, 8 blocks) into a tagged findings
 * set and page-level regression rows in the spot-check schema.
 *
 * PRIOR ART: scripts/eval/regression-from-spot-checks.mjs — harvests AI reviewer corrections from spot-check sprint
 *   JSON; this reads a member's free-text report instead, so it reuses that script's row schema (lane, class,
 *   wrong_span/image_reading, source/wrong_english, verified) rather than its reader. scripts/lib/shortlink-code.mjs
 *   decodes the /q/ links (no lookup needed: a code IS book id + page number).
 *
 * Input: the raw report text (NOT committed; it is a member's personal submission). Defect lines start with
 *   `[category]`; fields are ` | `-separated: locator | what is wrong | what the page shows | short link(s) | passage.
 *   Line n of the report (L-number) is the n-th defect line in file order.
 * Class labels: scripts/eval/regression/almeida-2026-11-batches.json (batch membership by L-number, class per batch,
 *   per-line overrides, hand-assigned against .claude/docs/page-error-taxonomy.md). `line_sha8` there pins the
 *   L-numbering; the script refuses a raw file whose lines do not match.
 * Outputs (derived fields + short quoted spans only, never the report prose):
 *   scripts/eval/regression/almeida-2026-11-findings.jsonl    one row per line (459)
 *   scripts/eval/regression/almeida-2026-11-corrections.jsonl spot-check schema, one row per resolved page of an
 *     O- or T-class finding that quotes the wrong text. `verified` is "member-image" when the member read the scan
 *     ("(page image read)"), else "member-ocr-only". A candidate lane passes a row when it does NOT reproduce
 *     wrong_span / wrong_english on that page.
 * --mongo: confirm each page exists (read-only find) and fill page_id / image_url / engine / model; pages that do not
 *   exist are counted as unresolved. Without it, pages come from decoding the links alone (page_id null).
 * No writes to any database, no network beyond Mongo reads, no model calls.
 *
 * Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/regression-from-almeida-2026-11.mjs \
 *          <raw-report.txt> [--mongo] [--out-dir scripts/eval/regression]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeShortlinkCode, decodeUuidShortlinkCode } from '../lib/shortlink-code.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABELS = path.join(HERE, 'regression', 'almeida-2026-11-batches.json');
const ROUND = 'almeida-2026-11';
const SPAN_MAX = 120;

export const sha8 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);

/** A backticked field name or bare tag (`translation`, `continues_on_next`, `<note>`) names a place, not text. */
const NOT_TEXT = /^(?:[a-z_]+(?:\.[a-z_]+)*|<\/?[a-z-]+\/?>)$/;

/** Quoted spans in a field: "…", “…”, `…` (minus field names and bare tags). Each capped at SPAN_MAX chars, at most 6. */
export function quotedSpans(field) {
  const out = [];
  for (const m of String(field || '').matchAll(/"([^"]+)"|“([^”]+)”|`([^`]+)`/g)) {
    const s = (m[1] ?? m[2] ?? m[3]).trim();
    if (m[3] !== undefined && NOT_TEXT.test(s)) continue;
    if (s) out.push(s.length > SPAN_MAX ? s.slice(0, SPAN_MAX - 1) + '…' : s);
  }
  return out.slice(0, 6);
}

export function evidenceOf(shows) {
  if (/\(page images? read\)/i.test(shows)) return 'human-image';
  if (/image not seen/i.test(shows)) return 'ocr-only';
  return 'unspecified';
}

export function decodeCode(code) {
  return decodeShortlinkCode(code) || decodeUuidShortlinkCode(code);
}

/** Scan numbers named in the locator: "scan 56", "scans 56 and 59", "[scans 481 to 483]", "scans 811, 184, 246". */
export function scansOf(ref) {
  const out = new Set();
  for (const m of ref.matchAll(/\bscans?\s+((?:\d+(?:\s*(?:,|and|to|-|–)\s*)?)+)/gi)) {
    const body = m[1];
    for (const r of body.matchAll(/(\d+)\s*(?:to|-|–)\s*(\d+)/g)) {
      const [a, b] = [+r[1], +r[2]];
      if (b > a && b - a <= 10) for (let i = a; i <= b; i++) out.add(i);
    }
    for (const n of body.matchAll(/\d+/g)) out.add(+n[0]);
  }
  return [...out];
}

/** Parse one defect line into derived fields. Free text is not carried, only spans, ids and locators. */
export function parseLine(line) {
  const f = line.split(' | ');
  if (f.length !== 5) throw new Error(`expected 5 fields, got ${f.length}: ${line.slice(0, 80)}`);
  const [head, wrong, shows, links, passage] = f;
  const cat = head.match(/^\[([a-z]+)\]\s*/);
  if (!cat) throw new Error(`no [category]: ${line.slice(0, 80)}`);
  const ref = head.slice(cat[0].length);
  const id = ref.match(/\(([a-f0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/i);
  const printed = ref.match(/\b(pp?\.\s*[\dIVXLCDMivxlcdm]+[a-z]?(?:\s*(?:and|to|-)\s*[\dIVXLCDMivxlcdm]+[a-z]?)?)/);
  const pass = passage.match(/^(?:Passages?\s+([\d ,and]+?))?\s*\(?([^()]*)\)?\s*$/);
  return {
    category: cat[1],
    ref: ref.length > 200 ? ref.slice(0, 199) + '…' : ref,
    book_id: id ? id[1].toLowerCase() : null,
    printed_page: printed ? printed[1] : null,
    scans: scansOf(ref),
    scan_only: /scan only/i.test(ref),
    short_links: [...links.matchAll(/sourcelibrary\.org\/q\/([A-Za-z0-9]+)/g)].map((m) => m[1]),
    evidence: evidenceOf(shows),
    defect_spans: quotedSpans(wrong),
    page_spans: quotedSpans(shows.replace(/\((?:page images? read|OCR only, image not seen)\)/gi, '')),
    passage: pass?.[1]?.trim() || null,
    ledger_code: (passage.match(/\(([^()]+)\)\s*$/) || [])[1] || null,
  };
}

/** Report text → [{ line: n, feedback_id, block, raw }]. */
export function defectLines(text) {
  const out = [];
  let fb = null, block = 0;
  for (const raw of text.split('\n')) {
    const h = raw.match(/^#####\s+FEEDBACK\s+([a-f0-9]+)/i);
    if (h) { fb = h[1]; block++; continue; }
    if (!raw.startsWith('[') || raw.startsWith('[category]')) continue;
    out.push({ line: out.length + 1, feedback_id: fb, block, raw: raw.trimEnd() });
  }
  return out;
}

export function classFor(labels, n) {
  const batch = Object.keys(labels.batches).find((b) => labels.batches[b].lines.includes(n)) ?? null;
  const cls = labels.overrides[n] ?? (batch ? labels.batches[batch].class : 'none');
  return { batch, class: cls };
}

const fold = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ');
/**
 * Does the page as served today still carry a wrong span? Only spans of 4+ characters are tested (a lone "ἡ" matches
 * anywhere); null when none qualifies or when the page text was not read. A snapshot, not a verdict: the span can recur
 * correctly elsewhere on the page.
 */
export function stillServed(spans, served) {
  const testable = spans.filter((x) => !x.endsWith('…') && [...x].length >= 4);
  if (served == null || !testable.length) return null;
  const text = fold(served);
  return testable.some((x) => text.includes(fold(x)));
}

/** Words the reports quote about the text rather than from it ("a book in English gets an English "translation""). */
const GENERIC = new Set(['translation', 'original', 'translated', 'note', 'gloss']);
/**
 * The spans that are the WRONG reading: quoted in "what is wrong", minus the generic words above and minus any span the
 * page side quotes too (the source word a mistranslation is about, e.g. "circulus" in "renders "circulus" as "sphere"").
 */
export function wrongSpansOf(f) {
  return f.defect_spans.filter((x) => !GENERIC.has(x.toLowerCase()) && !f.page_spans.includes(x));
}

const laneOf = (cls) => (/^O\d/.test(cls) ? 'ocr' : /^T\d/.test(cls) ? 'translation' : null);

async function main() {
  const args = process.argv.slice(2);
  const raw = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out-dir');
  if (!raw) { console.error('usage: regression-from-almeida-2026-11.mjs <raw-report.txt> [--mongo] [--out-dir dir]'); process.exit(1); }
  const outDir = args.includes('--out-dir') ? args[args.indexOf('--out-dir') + 1] : path.join(HERE, 'regression');
  const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
  const lines = defectLines(fs.readFileSync(raw, 'utf8'));
  if (lines.length !== labels.line_sha8.length) throw new Error(`raw has ${lines.length} defect lines, labels expect ${labels.line_sha8.length}`);
  const drift = lines.filter((l, i) => sha8(l.raw) !== labels.line_sha8[i]).map((l) => l.line);
  if (drift.length) throw new Error(`raw lines differ from the labelled ones at L${drift.slice(0, 10).join(', L')}`);

  const findings = lines.map((l) => {
    const p = parseLine(l.raw);
    const c = classFor(labels, l.line);
    const pages = p.short_links.map((code) => ({ code, ...(decodeCode(code) || { bookId: null, pageNumber: null }) }));
    if (!pages.length && p.book_id) for (const s of p.scans) pages.push({ code: null, bookId: p.book_id, pageNumber: s });
    return {
      id: `${ROUND}:L${l.line}`,
      line: l.line,
      feedback_id: l.feedback_id,
      block: l.block,
      category: p.category,
      batch: c.batch,
      batch_title: c.batch ? labels.batches[c.batch].title : null,
      class: c.class,
      ...(c.class === 'none' ? { scope: labels.none_scope[c.batch] ?? null } : {}),
      ...(c.class.startsWith('new:') ? { proposed: labels.proposals[c.class] } : {}),
      ref: p.ref,
      book_id: p.book_id,
      printed_page: p.printed_page,
      scans: p.scans,
      scan_only: p.scan_only,
      short_links: p.short_links,
      pages: pages.map((x) => ({ code: x.code, book_id: x.bookId, page_number: x.pageNumber })),
      evidence: p.evidence,
      defect_spans: p.defect_spans,
      page_spans: p.page_spans,
      passage: p.passage,
      ledger_code: p.ledger_code,
    };
  });

  let db = null, client = null;
  if (args.includes('--mongo')) {
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'bookstore');
  }
  const pageCache = new Map();
  async function lookPage(bookId, pageNumber, code) {
    const key = `${bookId}:${pageNumber}:${code}`;
    if (pageCache.has(key)) return pageCache.get(key);
    let pg = null;
    if (db) {
      const redirect = code ? await db.collection('shortlink_redirects').findOne({ code }, { projection: { _id: 0, book_id: 1, page_id: 1 } }) : null;
      const q = redirect?.page_id && redirect.book_id === bookId ? { book_id: bookId, id: redirect.page_id } : { book_id: bookId, page_number: pageNumber };
      const proj = { _id: 1, id: 1, page_number: 1, 'ocr.source': 1, 'ocr.model': 1, 'translation.source': 1, 'translation.model': 1, 'ocr.data': 1, 'translation.data': 1,
        cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1 };
      pg = await db.collection('pages').findOne(q, { projection: proj });
    }
    pageCache.set(key, pg);
    return pg;
  }
  const { pageImageUrl } = await import('./spot-check/lib.mjs');

  const rows = [];
  const tally = { candidates: 0, findings_resolved: 0, findings_unresolved: 0, pages_resolved: 0, pages_unresolved: 0, no_span: 0, no_page_named: 0, still_served: 0 };
  for (const f of findings) {
    const lane = laneOf(f.class);
    if (!lane) continue;
    tally.candidates++;
    const wrongSpans = wrongSpansOf(f);
    const wrong = wrongSpans.join(' … ');
    const right = f.page_spans.join(' … ');
    if (!f.pages.length) { tally.no_page_named++; tally.findings_unresolved++; continue; }
    if (!wrong || (lane === 'ocr' && !right)) { tally.no_span++; }
    let any = false;
    for (const [i, pgRef] of f.pages.entries()) {
      let pg = null;
      if (pgRef.book_id && pgRef.page_number) pg = db ? await lookPage(pgRef.book_id, pgRef.page_number, pgRef.code) : { _id: null };
      if (!pg) { tally.pages_unresolved++; continue; }
      tally.pages_resolved++; any = true;
      if (!wrong || (lane === 'ocr' && !right)) continue;
      const served = lane === 'ocr' ? pg.ocr?.data : pg.translation?.data;
      const still = stillServed(wrongSpans, served);
      if (still === true) tally.still_served++;
      const base = {
        id: `${ROUND}:L${f.line}:${pgRef.book_id}:${pg.page_number ?? pgRef.page_number}:${lane}:${i}`,
        lane, round: ROUND, book_id: pgRef.book_id,
        page_id: pg._id ? String(pg._id) : null, page_number: pg.page_number ?? pgRef.page_number,
        image_url: pg._id ? pageImageUrl(pg) : null,
        engine: lane === 'ocr' ? pg.ocr?.source ?? null : pg.translation?.source ?? null,
        model: lane === 'ocr' ? pg.ocr?.model ?? null : pg.translation?.model ?? null,
        class: f.class, severity: 'serious',
        problem: `${f.batch_title} (member report ${f.id}${f.pages.length > 1 ? `, one of ${f.pages.length} pages named` : ''})`,
        finding: f.id,
        ...(pgRef.book_id !== f.book_id && f.book_id ? { book_id_differs_from_report: f.book_id } : {}),
        still_served: still,
      };
      const verified = f.evidence === 'human-image' ? 'member-image' : 'member-ocr-only';
      rows.push(lane === 'ocr'
        ? { ...base, wrong_span: wrong, image_reading: right, verified }
        : { ...base, source: right || null, wrong_english: wrong, verified });
    }
    if (any) tally.findings_resolved++; else tally.findings_unresolved++;
  }
  if (client) await client.close();

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${ROUND}-findings.jsonl`), findings.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, `${ROUND}-corrections.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const byClass = {};
  for (const f of findings) byClass[f.class] = (byClass[f.class] || 0) + 1;
  const byLane = {};
  for (const r of rows) { const k = `${r.lane}\t${r.class}\t${r.verified}`; byLane[k] = (byLane[k] || 0) + 1; }
  console.log(`findings: ${findings.length} lines${db ? '' : ' (no --mongo: pages from link decoding only)'}`);
  for (const [k, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) console.log(`${n}\t${k}`);
  console.log(`page-level O/T findings: ${tally.candidates}; resolved to >=1 page ${tally.findings_resolved}, unresolved ${tally.findings_unresolved} (${tally.no_page_named} name no page); pages resolved ${tally.pages_resolved}, unresolved ${tally.pages_unresolved}; findings with no quotable span ${tally.no_span}`);
  console.log(`findings naming >=1 page (any class): ${findings.filter((f) => f.pages.length).length} of ${findings.length}`);
  console.log(`regression rows: ${rows.length}${db ? `; wrong span still served today on ${tally.still_served}` : ''}`);
  for (const [k, n] of Object.entries(byLane).sort()) console.log(`${n}\t${k}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
