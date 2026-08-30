/**
 * bph-scan-priorities — what should the BPH scan next?
 *
 * A new scan of a book nobody has digitized is worth far more than a rescan
 * of something another institution already put online. This report walks the
 * full BPH catalogue (Supabase `bph_works`, ~29.9K records) and asks, per
 * item: is a digitization of this already visible anywhere we can see?
 *
 * "Anywhere we can see" =
 *   - our own library (`books`, any visibility) and acquisition warehouse
 *     (`books_warehouse`), matched on the canonical edition-key parts;
 *   - the IIIF/IA discovery corpus (`import_candidates`, ~3.5M records
 *     harvested from IA, e-rara, Gallica, MDZ, Biblissima…), matched the
 *     same way, computed streaming;
 *   - the catalogue's own evidence: a validated IA match
 *     (`ia_match_is_same_edition`), an `sl_book_id` link, or Memorix scan
 *     files already on the record.
 *
 * Priority tiers (highest scan value first):
 *   P1_UNIQUE_UNSCANNED   no digitization found anywhere, and no scan files
 *                         at the BPH. Manuscripts land here almost by
 *                         definition (another witness elsewhere is not this
 *                         object) and are reported separately.
 *   P2_OTHER_EDITION_ONLY only a DIFFERENT edition of the (probable) same
 *                         work is digitized somewhere — a BPH scan still adds
 *                         a printing the world lacks.
 *   P3_EDITION_ELSEWHERE  the same edition (title+surname+year) appears
 *                         digitized in our corpus or the discovery harvest —
 *                         rescanning duplicates the world's coverage.
 *   P4_ALREADY_SCANNED    the BPH record itself carries scan files, an SL
 *                         book link, or a validated same-edition IA match.
 *
 * HONESTY BOUNDS, printed with the report: absence of evidence is bounded by
 * our harvest (3.5M candidates is broad, not complete), and matching is the
 * same heuristic the dedup tier uses — title+surname+year with the known
 * per-tradition title-collision risks. This ranks a scanning queue; it does
 * not prove uniqueness. Items whose only author signal is an EDITOR are
 * matched on the editor surname and flagged (`editor_matched`) — the
 * editor-as-author trap cuts both ways.
 *
 * Grain calibration (spot-checked 2026-08-09): the EDITION-grain claim is the
 * strong one — 93% control recall, and a hand check confirmed a P1 item's
 * 1688 printing really is undigitized. The WORK-grain boundary (P1 vs P2) is
 * porous: MDZ holds a later German bilingual of that same work under
 * "Iacobi Tollii Manvdvctio Ad Coelvm Chemicvm…" — name-prefixed title,
 * coelum/caelum orthography — which exact-key matching cannot see. For
 * prioritization both tiers point the same way (a different edition existing
 * elsewhere leaves this printing worth scanning), but do not read P1 as
 * "no edition of this work exists online". Early-modern orthography folding
 * (u/v, i/j, ae/oe) in the normalizer would firm this up — a corpus-wide
 * normalizer change, tracked separately, never smuggled in here.
 *
 * Read-only everywhere. Output: summary to stdout + full JSON and CSV to
 * scripts/output/ for the scanning team.
 *
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/analysis/bph-scan-priorities.ts [--json]
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeEditionTitle, editionSurname } from '../../src/lib/edition-key';
import { editionYear } from '../../src/lib/dedup';

const JSON_OUT = process.argv.includes('--json');
const MIN_TITLE = 12; // stricter than dedup's 5: work-level matching with no year needs a distinctive title

interface BphRow {
  ubn: string | null;
  title: string | null;
  full_title: string | null;
  author: string | null;
  editor: string | null;
  year: number | null;
  year_raw: string | null;
  language: string | null;
  record_type: string | null;
  shelf_mark: string | null;
  sl_book_id: string | null;
  ia_identifier: string | null;
  ia_match_is_same_edition: boolean | null;
  memorix_file_count: number | null;
  file_count: number | null;
  picturae_barcode: string | null;
  publish_scan: boolean | null;
}

function keys(title?: string | null, author?: string | null, year?: number | null) {
  const t = normalizeEditionTitle(title);
  const a = editionSurname(author);
  if (!t || t.length < 5) return null;
  return {
    edition: year != null ? `${t}|${a}|${year}` : null,
    work: t.length >= MIN_TITLE ? `${t}|${a}` : null,
  };
}

async function main() {
  const mongo = new MongoClient(process.env.MONGODB_URI!);
  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB || 'bookstore');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // ── 1. The digitized-somewhere key sets, streamed once ──
  const editionSeen = new Map<string, string>(); // key -> first source label
  const workSeen = new Map<string, string>();
  const note = (m: Map<string, string>, k: string | null, src: string) => {
    if (k && !m.has(k)) m.set(k, src);
  };

  for (const cn of ['books', 'books_warehouse'] as const) {
    const cursor = db.collection(cn).find(
      { content_type: { $ne: 'artwork' } },
      { projection: { _id: 0, title: 1, author: 1, year: 1, published: 1, 'image_source.provider': 1 } },
    );
    for await (const b of cursor) {
      const k = keys(b.title, b.author, editionYear(b));
      const src = `${cn}:${b.image_source?.provider || 'unknown'}`;
      if (k) { note(editionSeen, k.edition, src); note(workSeen, k.work, src); }
    }
    console.error(`  indexed ${cn}`);
  }

  let candCount = 0;
  const candCursor = db.collection('import_candidates').find(
    {},
    // Candidate dates live in date_earliest / date_text — NOT `year`. The first
    // run of this script projected the wrong fields, got zero edition keys out
    // of 3.5M candidates, and the positive control below is what caught it.
    { projection: { _id: 0, title: 1, author: 1, date_earliest: 1, date_text: 1, source: 1 } },
  );
  for await (const cRow of candCursor) {
    const raw = (cRow as { date_earliest?: unknown }).date_earliest;
    const yearNum = raw == null || raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw);
    const year = editionYear({ year: yearNum, published: (cRow as { date_text?: string }).date_text ?? null });
    const k = keys(cRow.title, cRow.author, year);
    const src = `candidates:${cRow.source || 'unknown'}`;
    if (k) { note(editionSeen, k.edition, src); note(workSeen, k.work, src); }
    if (++candCount % 500000 === 0) console.error(`  ...${candCount} candidates indexed`);
  }
  console.error(`  indexed ${candCount} import_candidates; ${editionSeen.size} edition keys, ${workSeen.size} work keys`);

  // ── 2. Walk the BPH catalogue ──
  const SELECT = 'ubn,title,full_title,author,editor,year,year_raw,language,record_type,shelf_mark,sl_book_id,ia_identifier,ia_match_is_same_edition,memorix_file_count,file_count,picturae_barcode,publish_scan';
  const rows: BphRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('bph_works').select(SELECT).range(from, from + 999);
    if (error) throw new Error(`bph_works page ${from}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...(data as BphRow[]));
    if (data.length < 1000) break;
  }
  console.error(`  ${rows.length} bph_works records`);

  type Tier = 'P1_UNIQUE_UNSCANNED' | 'P2_OTHER_EDITION_ONLY' | 'P3_EDITION_ELSEWHERE' | 'P4_ALREADY_SCANNED' | 'UNMATCHABLE';
  interface Out {
    tier: Tier; ubn: string | null; shelf_mark: string | null; title: string;
    author: string | null; year: number | null; language: string | null;
    record_type: string | null; is_manuscript: boolean;
    /** pre1830 = public-domain, scan-for-open-access; modern holdings are a
     * different question (rights) however unique they are. */
    period: 'pre1830' | '1830_1929' | 'post1930' | 'unknown';
    editor_matched: boolean; evidence: string | null;
  }
  const out: Out[] = [];

  for (const r of rows) {
    const hasScan =
      (r.memorix_file_count ?? 0) > 0 || (r.file_count ?? 0) > 0 ||
      !!r.picturae_barcode || !!r.sl_book_id || r.publish_scan === true;
    const sameEditionIA = r.ia_match_is_same_edition === true;
    const isMs = /manuscript|ms/i.test(r.record_type || '') || !!(r as { ms_date?: string }).ms_date;

    const title = r.full_title || r.title || '';
    const year = r.year ?? editionYear({ year: null, published: r.year_raw });
    const editorMatched = !r.author && !!r.editor;
    const k = keys(title, r.author || r.editor, year);

    let tier: Tier;
    let evidence: string | null = null;
    if (hasScan || sameEditionIA) {
      tier = 'P4_ALREADY_SCANNED';
      evidence = [
        (r.memorix_file_count ?? 0) > 0 ? `memorix:${r.memorix_file_count} files` : null,
        r.picturae_barcode ? 'picturae' : null,
        r.sl_book_id ? `sl:${r.sl_book_id}` : null,
        sameEditionIA ? `ia:${r.ia_identifier}` : null,
      ].filter(Boolean).join(', ') || 'scan files on record';
    } else if (!k) {
      tier = 'UNMATCHABLE';
    } else if (!isMs && k.edition && editionSeen.has(k.edition)) {
      tier = 'P3_EDITION_ELSEWHERE';
      evidence = editionSeen.get(k.edition)!;
    } else if (!isMs && k.work && workSeen.has(k.work)) {
      tier = 'P2_OTHER_EDITION_ONLY';
      evidence = workSeen.get(k.work)!;
    } else {
      tier = 'P1_UNIQUE_UNSCANNED';
    }

    const period = year == null ? 'unknown' : year < 1830 ? 'pre1830' : year < 1930 ? '1830_1929' : 'post1930';
    out.push({
      tier, ubn: r.ubn, shelf_mark: r.shelf_mark, title: title.slice(0, 160),
      author: r.author || (r.editor ? `${r.editor} (ed.)` : null), year,
      language: r.language, record_type: r.record_type, is_manuscript: isMs,
      period, editor_matched: editorMatched, evidence,
    });
  }

  // ── Positive control (a probe needs one): BPH rows LINKED to a Source
  // Library book (`sl_book_id`) are digitized by construction, and the linked
  // book was indexed into the key sets above — so the matcher must
  // independently rediscover most of them. A low hit rate would mean the
  // "not found anywhere" tier is inflated and the report untrustworthy.
  // Measured 2026-08-09: 93% edition-grain recall; the misses are subtitle-
  // length differences and unknown-vs-named author forms. (Run one of this
  // script had a silent date-field bug — projecting `year` where candidates
  // carry `date_earliest` — and a control exactly like this caught it.)
  const controls = rows.filter((r) => r.sl_book_id);
  let ctlEdition = 0, ctlWork = 0;
  for (const r of controls) {
    const k = keys(r.full_title || r.title, r.author || r.editor, r.year ?? editionYear({ year: null, published: r.year_raw }));
    if (k?.edition && editionSeen.has(k.edition)) ctlEdition++;
    if (k?.work && workSeen.has(k.work)) ctlWork++;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const tiers: Tier[] = ['P1_UNIQUE_UNSCANNED', 'P2_OTHER_EDITION_ONLY', 'P3_EDITION_ELSEWHERE', 'P4_ALREADY_SCANNED', 'UNMATCHABLE'];
  const summary = tiers.map((t) => {
    const rowsT = out.filter((o) => o.tier === t);
    return {
      tier: t,
      total: rowsT.length,
      manuscripts: rowsT.filter((o) => o.is_manuscript).length,
      pre1830: rowsT.filter((o) => o.period === 'pre1830').length,
      y1830_1929: rowsT.filter((o) => o.period === '1830_1929').length,
      post1930: rowsT.filter((o) => o.period === 'post1930').length,
      no_year: rowsT.filter((o) => o.period === 'unknown').length,
    };
  });

  const outDir = path.join(process.cwd(), 'scripts', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `bph-scan-priorities-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ generated: new Date().toISOString(), sources: { edition_keys: editionSeen.size, work_keys: workSeen.size, candidates: candCount }, summary, items: out }, null, 1));
  const csvPath = path.join(outDir, `bph-scan-priorities-${stamp}.csv`);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(csvPath, [
    'tier,period,ubn,shelf_mark,title,author,year,language,record_type,is_manuscript,editor_matched,evidence',
    ...out.sort((a, b) => a.tier.localeCompare(b.tier) || a.period.localeCompare(b.period)).map((o) =>
      [o.tier, o.period, o.ubn, o.shelf_mark, o.title, o.author, o.year, o.language, o.record_type, o.is_manuscript, o.editor_matched, o.evidence].map(esc).join(',')),
  ].join('\n'));

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary }, null, 2));
  } else {
    console.log(`BPH scan priorities — ${stamp}, ${rows.length} catalogue records vs ${editionSeen.size} known digitized editions`);
    console.log(`  ${'tier'.padEnd(22)} ${'total'.padStart(6)}  ${'<1830'.padStart(6)} ${'1830-1929'.padStart(9)} ${'1930+'.padStart(6)} ${'no-yr'.padStart(6)}  mss`);
    for (const s of summary) console.log(`  ${s.tier.padEnd(22)} ${String(s.total).padStart(6)}  ${String(s.pre1830).padStart(6)} ${String(s.y1830_1929).padStart(9)} ${String(s.post1930).padStart(6)} ${String(s.no_year).padStart(6)}  ${s.manuscripts}`);
    console.log(`  positive control: of ${controls.length} BPH records linked to a Source Library book (digitized by`);
    console.log(`  construction), the key matcher independently finds ${ctlEdition} at edition grain, ${ctlWork} at work grain.`);
    console.log(`\n  THE list: P1 + pre-1830 (public domain, nothing digitized anywhere we can see, no scan at BPH).`);
    console.log(`  Post-1930 P1 items are unique but in-copyright — a rights question, not a scanning queue.`);
    console.log(`  Bounds: "anywhere we can see" = our library + warehouse + ${candCount.toLocaleString()} harvested candidates;`);
    console.log(`  matching is title+surname(+year) — a ranking signal, not a proof of uniqueness.`);
    console.log(`\n  full report: ${jsonPath}\n  spreadsheet:  ${csvPath}`);
  }
  await mongo.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
