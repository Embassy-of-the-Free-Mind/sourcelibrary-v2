#!/usr/bin/env node
/**
 * Final BPH catalogue convergence pass.
 *
 * Goal: bring the BPH Mongo "visible-with-pages" count and the
 * bph_works `sl_book_id IS NOT NULL` count into alignment, after the
 * prior shared-UBN dedupe, AP-IIIF backfill, Gemini fuzzy-match, and
 * Gemini-collision dedupe runs. Remaining orphans fall into three
 * buckets handled in one transaction:
 *
 *   1. RELINK — bph_works.ubn=X is linked to a hidden Mongo book; the
 *      orphan is the live copy. Repoint sl_book_id at the orphan. No
 *      Mongo change. Fixes the audit trail.
 *
 *   2. DEDUPE-COLLISION — bph_works.ubn=X is linked to another *active*
 *      Mongo book. Score both by (pages_translated → pages_ocr →
 *      pages_count). Swap to the better copy if needed; hide the loser.
 *
 *   3. HIDE-DROP — orphan is genuinely not in BPH's digital catalogue
 *      (verified by Supabase search) or is a small fragment of a work
 *      already represented. Mark `visible:false` with a `dedupe.reason`
 *      audit trail. A GitHub issue lists all drops for partner review.
 *
 * Idempotent: skips books already marked visible:false with a dedupe
 * stamp, and skips relinks where bph_works already points at the orphan.
 *
 * Usage
 *   set -a; source .env.production.local; set +a
 *   node scripts/bph-final-catalogue-pass.mjs              # dry-run
 *   node scripts/bph-final-catalogue-pass.mjs --apply      # do it
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const APPLY = process.argv.includes('--apply');

const today = new Date().toISOString().slice(0, 10);
const REPORT_JSON = `.claude/docs/bph-final-pass-${today}.json`;
const REPORT_MD = `.claude/docs/bph-final-pass-${today}.md`;

if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Explicit case list (built from spot-checks; encoded here for auditability) ──

// Orphans to RELINK to existing bph_works UBN (twin currently linked is hidden,
// or orphan matches an unlinked catalogue row found via title search).
const RELINK = [
  // numeric-UBN orphans where ubn → hidden Mongo book
  { mongoId: '697958faeef1c286564aa43d', ubn: '3047',  why: 'orphan live, twin hidden — Complementum astrologiae' },
  { mongoId: '697a5562c915282d8f071f74', ubn: '3585',  why: 'orphan live, twin hidden — Dichiaratione' },
  { mongoId: '697c8e0fbaa544415f85b6c6', ubn: '5220',  why: 'orphan live, twin hidden — Lehren der Rosenkreuzer' },
  { mongoId: '697e23c8bb80b2397e771e23', ubn: '6941',  why: 'orphan live, twin hidden — Hypnerotomachie/Songe de Poliphile' },
  { mongoId: '6980941e4664a62963e01f38', ubn: '8338',  why: 'orphan live, twin hidden — Liber egregius' },
  { mongoId: '69819209e4f4f6455d89c7b8', ubn: '8413',  why: 'orphan live, twin hidden — Von der liebe gottes' },
  { mongoId: '69c63cbcb463eebe7caac51f', ubn: '15423', why: 'orphan live, twin hidden — Vier Tractaetlein' },
  { mongoId: '69c746236a0f3d112faf7f5c', ubn: '17508', why: 'orphan live, twin hidden — Historia Barlaam' },
  { mongoId: '69c7eea2fb10016c3f389f29', ubn: '20591', why: 'orphan live, twin hidden — Le cimetière d\'Amboise' },
  { mongoId: '69c7e48e295ea01b70c8d988', ubn: '20573', why: 'orphan live, twin hidden — Geometrie practique' },
  { mongoId: '69c7f9496c6f3cc53c84261b', ubn: '20840', why: 'orphan live, twin hidden — Erzählungen' },
  { mongoId: '69c803a86c6f3cc53c844c10', ubn: '21141', why: 'orphan live, twin hidden — Controversiae cum Judaeis' },
  { mongoId: '69c804406c6f3cc53c844dd0', ubn: '21142', why: 'orphan live, twin hidden — Philosophia pia' },
  { mongoId: '69c815536c6f3cc53c84857d', ubn: '21528', why: 'orphan live, twin hidden — Histoire de Labadie' },
  { mongoId: '69c8168e6c6f3cc53c848b0c', ubn: '21571', why: 'orphan live, twin hidden — Opera Cyrillus' },
  { mongoId: '69c8437d6c6f3cc53c851018', ubn: '30161', why: 'orphan live, twin hidden — Medulla animae' },
  { mongoId: '69c853c66c6f3cc53c8536f2', ubn: '30601', why: 'orphan live, twin hidden — Kirchen-Postill' },
  { mongoId: '69c84e366c6f3cc53c852895', ubn: '30465', why: 'orphan live, twin hidden — Raphael artem medicam' },
  { mongoId: '69c850b66c6f3cc53c852e7c', ubn: '30562', why: 'orphan live, twin hidden — Mitternächtige Post-Reuter' },
  { mongoId: '69c85e7f6c6f3cc53c855203', ubn: '30882', why: 'orphan live, twin hidden — Enchiridion Leonis' },
  { mongoId: '69c868636c6f3cc53c8566cb', ubn: '648',   why: 'orphan live, twin hidden — Anleitung gabal' },
  { mongoId: '69c88a0d6c6f3cc53c85a52d', ubn: '13257', why: 'orphan live, twin hidden — Silentium post clamores' },
  { mongoId: '69c8a3ef6c6f3cc53c85e76e', ubn: '31185', why: 'orphan live, twin hidden — Origine de la maçonnerie' },
  // IA-imported BPH book that turns out to have unlinked bph_works rows
  { mongoId: '69482af9914d007380634cf1', ubn: '13470', why: 'IA-imported Mögling 1618 matches unlinked UBN 13470 (Speculum Sophicum)' },
];

// Active-twin dedupe pairs — pick canonical by page scoring inside script.
// (orphan UBN already linked to a different live Mongo book)
const DEDUPE_COLLISIONS = [
  { orphanId: '69c8681f6c6f3cc53c856667', ubn: '608',   note: 'Ander Theil Gnothi — both Weigel 1618' },
  { orphanId: '69c79f1492b884e4f817372f', ubn: '19517', note: 'Sefer ha-bahir — same 1651 edition' },
  { orphanId: '69c863316c6f3cc53c855ca6', ubn: '30959', note: 'Mongo book titled Die uralte Weisheit by Besant 1780 is impossible (Besant 1847-1933); identical pages to Morgenröte twin' },
  { orphanId: '6867bf5a009d20a23245ac0d', ubn: '2067',  note: 'Das Buch Meteororum — Paracelsus 1566, UBN 2067 is exact match' },
  { orphanId: '699ef9fd0600353e655fe517', ubn: '13298', note: 'Sleutel Russian Eckartshausen — UBN 13298 is exact match (same title, same year)' },
];

// Drops — books to mark visible:false. Each entry needs a `reason` for the
// audit trail and the GitHub issue.
const DROPS = [
  { mongoId: '68611c716122a466ae2491ab', reason: 'fragment_preface', detail: 'Plantarum seu Stirpium Icones — 10-page preface only, not a real catalogue book' },
  { mongoId: '685a9b1bcdbe778e22823a64', reason: 'composite_fragment', detail: 'De Voluptate (Ficino, 40p) — extract from composite UBN 26106 whose canonical is the full composite, not this single tract' },
  { mongoId: '674057212677591a7c897d60', reason: 'composite_fragment', detail: 'De Voluptate (Ficino, 9p) - "Fragment" — even smaller extract of UBN 26106; UBN 26106 is being unlinked because no Mongo book represents the full composite' },
  { mongoId: '68d5571a110616ec557a3708', reason: 'not_in_catalogue', detail: 'Astronomicon libri VIII (Firmicus 1533) — no matching row in bph_works (only 1831 Firmicus volume catalogued)' },
  { mongoId: 'd850a255-4633-43d5-8383-7c67a7e55144', reason: 'not_in_catalogue', detail: 'Incipit: Ex Ilss. quodam Philosophi R.C. extractum (Anonymous 1650) — no matching row in bph_works' },
  { mongoId: 'fec0b295-0795-440f-a467-434e17ba2a8e', reason: 'not_in_catalogue', detail: 'Asis rimonim (Gallico 1575, Hebrew) — no matching row in bph_works' },
  { mongoId: '697768b0e832d9422ad6e0ba', reason: 'not_in_catalogue', detail: 'De bombardis (Besold 1620) — corrupted dc_identifier ["1","8","3","0","doi:..."]; no matching row in bph_works' },
  { mongoId: '69482afb914d007380634d28', reason: 'wrong_edition', detail: 'De verbo mirifico (Reuchlin 1494) — BPH catalogues 1514 and 1552 editions, not the 1494 first edition' },
];

// Unlinks — catalogue rows whose existing sl_book_id is a wrong/poor match.
// Setting sl_book_id = null moves the row back to "catalogued, not digitised".
const UNLINKS = [
  { ubn: '1', detail: 'UBN 1 row is "Aldine press books at the Harry Ransom HRC" (Kallendorf 1998 modern bibliographic catalogue). It is wrongly linked to Drebbel "Tractatus duo" (1628) — the latter has corrupted dc_identifier ["1","4","5","6","doi:..."] and the numeric "1" caught this row.' },
  { ubn: '26106', detail: 'UBN 26106 is a composite Hermetica volume (Pimander, Asclepius, De voluptate, De sole, etc., bound together). Currently linked to a 9p "De Voluptate - Fragment" which represents only one tract of the composite. No Mongo book contains the full composite, so the row should be marked not-yet-digitised.' },
];

// Cleanup — fix bogus dc_identifier on Mongo books unlinked above so they
// don't get re-matched on the next sync.
const DC_FIXES = [
  { mongoId: '6836f8ee811c8ab472a49e36', detail: 'Tractatus duo (Drebbel 1628) — strip bogus numeric UBN candidates ["1","4","5","6"], keep only the Zenodo DOI.', newDc: ['doi:10.5281/zenodo.18053504'] },
];

function scoreBook(b) {
  return [b?.pages_translated || 0, b?.pages_ocr || 0, b?.pages_count || 0];
}
function compareScore(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

async function patchBphWorks(ubn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(ubn)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Supabase PATCH ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function getBphRow(ubn) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(ubn)}&select=ubn,title,sl_book_id`, {
    headers: sbHeaders,
  });
  const rows = await r.json();
  return rows[0];
}

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const books = mongo.db('bookstore').collection('books');

  const summary = { relink: [], dedupe: [], drop: [], skipped: [] };

  // ── RELINK ──
  for (const r of RELINK) {
    const orphan = await books.findOne({ id: r.mongoId }, { projection: { id: 1, slug: 1, title: 1, visible: 1 } });
    if (!orphan || orphan.visible === false) { summary.skipped.push({ kind: 'relink', mongoId: r.mongoId, reason: 'orphan missing/hidden' }); continue; }
    const row = await getBphRow(r.ubn);
    if (!row) { summary.skipped.push({ kind: 'relink', mongoId: r.mongoId, ubn: r.ubn, reason: 'ubn missing in bph_works' }); continue; }
    if (row.sl_book_id === r.mongoId) { summary.skipped.push({ kind: 'relink', mongoId: r.mongoId, ubn: r.ubn, reason: 'already linked' }); continue; }
    const entry = { mongoId: r.mongoId, ubn: r.ubn, title: orphan.title, from: row.sl_book_id, to: orphan.id, why: r.why };
    summary.relink.push(entry);
    if (APPLY) {
      try { await patchBphWorks(r.ubn, { sl_book_id: orphan.id, sl_book_slug: orphan.slug || orphan.id }); console.log(`relink ubn=${r.ubn} → ${orphan.id} (${orphan.title?.slice(0,40)})`); }
      catch (e) { entry.error = e.message; console.log(`FAIL relink ubn=${r.ubn}: ${e.message}`); }
    }
  }

  // ── DEDUPE-COLLISION ──
  for (const c of DEDUPE_COLLISIONS) {
    const row = await getBphRow(c.ubn);
    if (!row?.sl_book_id) { summary.skipped.push({ kind: 'dedupe', orphanId: c.orphanId, ubn: c.ubn, reason: 'no canonical linked' }); continue; }
    const [orphan, canon] = await Promise.all([
      books.findOne({ id: c.orphanId }, { projection: { id: 1, slug: 1, title: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, dedupe: 1 } }),
      books.findOne({ id: row.sl_book_id }, { projection: { id: 1, slug: 1, title: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, dedupe: 1 } }),
    ]);
    if (!orphan || !canon) { summary.skipped.push({ kind: 'dedupe', ubn: c.ubn, reason: 'orphan or canon missing' }); continue; }
    if (orphan.visible === false && orphan.dedupe) { summary.skipped.push({ kind: 'dedupe', ubn: c.ubn, reason: 'orphan already deduped' }); continue; }

    const orphanWins = compareScore(scoreBook(orphan), scoreBook(canon)) > 0;
    const winner = orphanWins ? orphan : canon;
    const loser  = orphanWins ? canon  : orphan;
    const action = orphanWins ? 'swap_and_hide' : 'hide_orphan';
    const entry = {
      ubn: c.ubn, action, note: c.note,
      orphan: { id: orphan.id, title: orphan.title, ocr: orphan.pages_ocr||0, trans: orphan.pages_translated||0, pages: orphan.pages_count||0 },
      canon: { id: canon.id, title: canon.title, ocr: canon.pages_ocr||0, trans: canon.pages_translated||0, pages: canon.pages_count||0 },
      winner_id: winner.id, loser_id: loser.id,
    };
    summary.dedupe.push(entry);
    if (APPLY) {
      try {
        if (orphanWins) {
          await patchBphWorks(c.ubn, { sl_book_id: orphan.id, sl_book_slug: orphan.slug || orphan.id });
        }
        await books.updateOne(
          { id: loser.id },
          { $set: { visible: false, dedupe: { canonical_id: winner.id, reason: orphanWins ? 'final_pass_collision_swap' : 'final_pass_collision_hide', ubn: c.ubn, hidden_at: new Date().toISOString() } } },
        );
        console.log(`${action} ubn=${c.ubn} ${orphan.title?.slice(0,40)} (winner=${winner.id})`);
      } catch (e) { entry.error = e.message; console.log(`FAIL dedupe ubn=${c.ubn}: ${e.message}`); }
    }
  }

  // ── HIDE-DROP ──
  for (const d of DROPS) {
    const b = await books.findOne({ id: d.mongoId }, { projection: { id: 1, slug: 1, title: 1, author: 1, year: 1, pages_count: 1, pages_translated: 1, visible: 1, dedupe: 1 } });
    if (!b) { summary.skipped.push({ kind: 'drop', mongoId: d.mongoId, reason: 'book missing' }); continue; }
    if (b.visible === false && b.dedupe) { summary.skipped.push({ kind: 'drop', mongoId: d.mongoId, reason: 'already hidden' }); continue; }
    const entry = { mongoId: d.mongoId, title: b.title, author: b.author, year: b.year, pages: b.pages_count, translated: b.pages_translated, reason: d.reason, detail: d.detail };
    summary.drop.push(entry);
    if (APPLY) {
      try {
        await books.updateOne(
          { id: d.mongoId },
          { $set: { visible: false, dedupe: { reason: 'final_pass_' + d.reason, detail: d.detail, hidden_at: new Date().toISOString() } } },
        );
        console.log(`drop ${d.reason} ${b.title?.slice(0,50)}`);
      } catch (e) { entry.error = e.message; console.log(`FAIL drop ${d.mongoId}: ${e.message}`); }
    }
  }

  // ── UNLINK ──
  summary.unlink = [];
  for (const u of UNLINKS) {
    const row = await getBphRow(u.ubn);
    if (!row) { summary.skipped.push({ kind: 'unlink', ubn: u.ubn, reason: 'ubn missing in bph_works' }); continue; }
    if (!row.sl_book_id) { summary.skipped.push({ kind: 'unlink', ubn: u.ubn, reason: 'already unlinked' }); continue; }
    const entry = { ubn: u.ubn, was_linked_to: row.sl_book_id, title: row.title, detail: u.detail };
    summary.unlink.push(entry);
    if (APPLY) {
      try { await patchBphWorks(u.ubn, { sl_book_id: null, sl_book_slug: null }); console.log(`unlink ubn=${u.ubn} (was → ${row.sl_book_id})`); }
      catch (e) { entry.error = e.message; console.log(`FAIL unlink ubn=${u.ubn}: ${e.message}`); }
    }
  }

  // ── DC_FIXES ──
  summary.dc_fix = [];
  for (const f of DC_FIXES) {
    const b = await books.findOne({ id: f.mongoId }, { projection: { id: 1, title: 1, 'dublin_core.dc_identifier': 1 } });
    if (!b) { summary.skipped.push({ kind: 'dc_fix', mongoId: f.mongoId, reason: 'book missing' }); continue; }
    const entry = { mongoId: f.mongoId, title: b.title, old: b.dublin_core?.dc_identifier, new: f.newDc, detail: f.detail };
    summary.dc_fix.push(entry);
    if (APPLY) {
      try { await books.updateOne({ id: f.mongoId }, { $set: { 'dublin_core.dc_identifier': f.newDc } }); console.log(`dc_fix ${b.title?.slice(0,40)}`); }
      catch (e) { entry.error = e.message; console.log(`FAIL dc_fix ${f.mongoId}: ${e.message}`); }
    }
  }

  await mongo.close();

  // ── Reports ──
  const tally = {
    relink: summary.relink.length,
    dedupe_swap: summary.dedupe.filter(d => d.action === 'swap_and_hide').length,
    dedupe_hide: summary.dedupe.filter(d => d.action === 'hide_orphan').length,
    drop: summary.drop.length,
    unlink: summary.unlink.length,
    dc_fix: summary.dc_fix.length,
    skipped: summary.skipped.length,
  };
  console.log('\nTally:', tally);

  fs.writeFileSync(REPORT_JSON, JSON.stringify({ generated_at: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', tally, summary }, null, 2));

  const md = [
    `# BPH final catalogue pass — ${today}`, '',
    `Mode: **${APPLY ? 'APPLY' : 'dry-run'}**`, '',
    `Tally: relink ${tally.relink}, dedupe-swap ${tally.dedupe_swap}, dedupe-hide ${tally.dedupe_hide}, drop ${tally.drop}, skipped ${tally.skipped}`, '',
    `## Relinks (no count change — bph_works now points at the live copy)`, '',
    '| UBN | Mongo id | Title | From → To |',
    '|---|---|---|---|',
    ...summary.relink.map(r => `| ${r.ubn} | \`${r.mongoId}\` | ${(r.title || '').slice(0, 50)} | \`${r.from || '∅'}\` → \`${r.to}\` |`),
    '', `## Dedupe collisions`, '',
    '| UBN | Action | Winner | Loser | Note |',
    '|---|---|---|---|---|',
    ...summary.dedupe.map(d => `| ${d.ubn} | ${d.action} | \`${d.winner_id}\` (OCR ${(d.winner_id===d.orphan.id?d.orphan:d.canon).ocr}/${(d.winner_id===d.orphan.id?d.orphan:d.canon).pages}) | \`${d.loser_id}\` (OCR ${(d.loser_id===d.orphan.id?d.orphan:d.canon).ocr}/${(d.loser_id===d.orphan.id?d.orphan:d.canon).pages}) | ${d.note} |`),
    '', `## Drops`, '',
    '| Mongo id | Title | Year | Pages (T/N) | Reason | Detail |',
    '|---|---|---|---|---|---|',
    ...summary.drop.map(d => `| \`${d.mongoId}\` | ${(d.title || '').slice(0, 40)} | ${d.year || '?'} | ${d.translated || 0}/${d.pages || 0} | ${d.reason} | ${d.detail} |`),
    '', `## Unlinks (catalogue row keeps existing — just removes the wrong SL link)`, '',
    '| UBN | Was linked to | Catalogue title | Detail |',
    '|---|---|---|---|',
    ...summary.unlink.map(u => `| ${u.ubn} | \`${u.was_linked_to}\` | ${(u.title || '').slice(0, 40)} | ${u.detail} |`),
    '', `## dc_identifier cleanups`, '',
    ...summary.dc_fix.map(f => `- \`${f.mongoId}\` ${f.title}: \`${JSON.stringify(f.old)}\` → \`${JSON.stringify(f.new)}\``),
    '', `## Skipped`, '',
    ...summary.skipped.map(s => `- ${s.kind}: ${s.mongoId || s.orphanId || s.ubn} — ${s.reason}`),
  ].join('\n');
  fs.writeFileSync(REPORT_MD, md);
  console.log(`\nReports:\n  ${REPORT_JSON}\n  ${REPORT_MD}`);
}

main().catch(e => { console.error(e); process.exit(1); });
