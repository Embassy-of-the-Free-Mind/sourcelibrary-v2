#!/usr/bin/env node
// PRIOR ART: scripts/eval/context-bleed-5274/ocr-overlap.mjs — compares a page's text with its NEIGHBOURS'; this
// compares a page's NEW read with its OWN previous read, which is what catches a reply that belongs to another
// request entirely (post-run judge, 2026-11-04: a Dào Dé Jīng leaf came back from agy as a Latin legal treatise).
/**
 * reply-swap-check (#5274): for every page the context-bleed runner rewrote, is the new text still about the same
 * leaf as the text it replaced? $0, Mongo only (secondary), no model.
 *
 *   OCR:   new ocr.data vs the page_revisions snapshot this run took (field 'ocr', created on/after --since).
 *          Character 3-gram overlap of the two transcriptions, plus the declared <language> tags.
 *   English: new translation vs the snapshot it replaced, word overlap of names/numbers/capitalised words is too
 *          weak across a re-translation, so English is checked against its OWN source: the share of the OCR's
 *          proper-ish tokens (capitalised Latin-script words, numbers) that reappear in the English. Low share on
 *          a page with many such tokens is a candidate, not a finding.
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/reply-swap-check.mjs \
 *        --ledger DIR/ledger.jsonl --since 2026-11-04T00:00:00Z --out FILE.json
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const since = new Date(arg('since', '2026-11-04T00:00:00Z'));
const rows = new Map();
for (const l of fs.readFileSync(arg('ledger'), 'utf8').trim().split('\n')) { const r = JSON.parse(l); rows.set(r.page_id, r); }
const done = [...rows.values()].filter((r) => ['retranslated', 'not-translatable'].includes(r.state));

const body = (s) => String(s || '').replace(/<(scan-quality|language|script|page-type|page-num|header|meta|signature|catchword)>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
const grams = (s) => { const t = body(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); const g = new Set(); for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3)); return g; };
const jac = (a, b) => { if (!a.size || !b.size) return null; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.min(a.size, b.size); };
const lang = (s) => (String(s || '').match(/<language>([\s\S]*?)<\/language>/) || [])[1]?.trim() || null;
const toks = (s) => new Set((body(s).match(/\b(?:[A-Z][a-zà-ÿ]{3,}|\d{2,})\b/g) || []).map((w) => w.toLowerCase()));

const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const db = c.db('bookstore');
const out = [];
for (let i = 0; i < done.length; i += 200) {
  const chunk = done.slice(i, i + 200), ids = chunk.map((r) => r.page_id);
  const pages = await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const revs = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', created_at: { $gte: since } }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
  const firstRev = new Map();
  for (const v of revs) if (!firstRev.has(v.page_id)) firstRev.set(v.page_id, v);
  for (const p of pages) {
    const r = rows.get(p.id), old = firstRev.get(p.id);
    const o = { page_id: p.id, book_id: p.book_id, page: p.page_number, language: r.language, state: r.state, ocr_reread: !!r.ocr_reread };
    if (old) { o.ocr_sim = jac(grams(old.data), grams(p.ocr?.data)); o.lang_old = lang(old.data); o.lang_new = lang(p.ocr?.data); o.old_len = body(old.data).trim().length; o.new_len = body(p.ocr?.data).trim().length; }
    const st = toks(p.ocr?.data), en = String(p.translation?.data || '').toLowerCase();
    if (st.size >= 5 && en) { let n = 0; for (const t of st) if (en.includes(t)) n++; o.tok_n = st.size; o.tok_share = n / st.size; }
    out.push(o);
  }
}
await c.close();
const ocrFlags = out.filter((o) => o.ocr_sim != null && o.old_len >= 40 && o.ocr_sim < 0.2);
const enFlags = out.filter((o) => o.tok_share != null && o.tok_n >= 8 && o.tok_share < 0.15);
fs.writeFileSync(arg('out'), JSON.stringify({ at: new Date().toISOString(), pages: out.length, ocr_compared: out.filter((o) => o.ocr_sim != null).length, ocr_flags: ocrFlags, en_flags: enFlags, all: out }, null, 1));
console.log(`pages ${out.length}; OCR compared ${out.filter((o) => o.ocr_sim != null).length}, flagged ${ocrFlags.length}; English token-checked ${out.filter((o) => o.tok_share != null && o.tok_n >= 8).length}, flagged ${enFlags.length}`);
for (const o of ocrFlags) console.log(`  OCR ${o.page_id} p${o.page} ${o.language} sim=${o.ocr_sim?.toFixed(2)} ${o.lang_old} -> ${o.lang_new}`);
for (const o of enFlags.slice(0, 40)) console.log(`  EN  ${o.page_id} p${o.page} ${o.language} share=${o.tok_share.toFixed(2)} of ${o.tok_n}`);
