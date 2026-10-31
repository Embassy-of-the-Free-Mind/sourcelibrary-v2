#!/usr/bin/env node
// PRIOR ART: scripts/audit/note-tag-provenance.mjs and scripts/audit/translation-reasoning-leak.mjs — the read-only
// translation detectors (a server-side prefilter, the rule applied locally, ids and counts out, no page text). Neither
// fits: one checks notes on pages with no body, the other walks the whole corpus for reasoning. This one reads only a
// WINDOW of recent translation writes, because its question is whether new writes still carry the phrases.
// scripts/analysis/experience-map/ontology/apparatus-share.mjs samples search hits per ontology node; it has no window,
// no language split and no licensing source. The rule is lifeWordFindings (scripts/lib/life-word-gloss.mjs).
/**
 * life-word-glosses — "life force" / "vital energy" in the translator's own <gloss>/<note>/<term>, on NEW translation
 * writes, counted per book language and per prompt version (#7458).
 *
 * Translation prompt v21 tells the model to render 氣, prāṇa, āyus, 命, pneuma/srog by what they say and to keep "life
 * force" for a source that names such a force (vis vitalis, Lebenskraft). This counts whether new writes obey it.
 * FLAG-ONLY: it never writes to pages, and it exits 0 whatever it finds. The remedy is the prompt, not a sweep; the
 * 17,696 stored pages (2026-10-26 count) are deliberately not rewritten.
 *
 *   node --env-file=.env.production.local scripts/audit/life-word-glosses.mjs                 # last 7 days
 *   node --env-file=.env.production.local scripts/audit/life-word-glosses.mjs --days 30 --out DIR
 *   node --env-file=.env.production.local scripts/audit/life-word-glosses.mjs --from 2026-10-01 --to 2026-10-31
 *
 * Output: a table on stdout; with --out, summary.json and pages.jsonl (ids, page numbers, language, prompt version,
 * tags and the matched phrase: no page text). "licensed" = the page's OCR names a vital force itself, so the phrase
 * may be right there. The count is a FLOOR: it reads the phrase list in LIFE_PHRASE, not every way of saying it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { lifeWordFindings, LIFE_PHRASE_PREFILTER } from '../lib/life-word-gloss.mjs';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i === -1 ? d : args[i + 1]; };
const to = opt('to') ? new Date(opt('to')) : new Date();
const from = opt('from') ? new Date(opt('from')) : new Date(to.getTime() - Number(opt('days', 7)) * 86400e3);
const OUT = opt('out');
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = client.db('bookstore');
const pages = db.collection('pages');
const window = { 'translation.updated_at': { $gte: from, $lt: to } };

try {
  // Denominator: every translation written in the window, by book and prompt version (no text leaves Atlas).
  const written = await pages.aggregate([
    { $match: window },
    { $group: { _id: { book: '$book_id', v: '$translation.prompt_version' }, n: { $sum: 1 } } },
  ], { maxTimeMS: 1_800_000, allowDiskUse: true }).toArray();
  // Candidates: the prefilter is a superset of the rule, so text leaves Atlas only for pages that may match.
  const cand = await pages.find({ ...window, 'translation.data': LIFE_PHRASE_PREFILTER },
    { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'translation.prompt_version': 1, 'ocr.data': 1 }, maxTimeMS: 1_800_000 }).toArray();

  const bookIds = [...new Set([...written.map((w) => w._id.book), ...cand.map((p) => p.book_id)])];
  const lang = new Map();
  for (let i = 0; i < bookIds.length; i += 5000) {
    for (const b of await db.collection('books').find({ id: { $in: bookIds.slice(i, i + 5000) } }, { projection: { _id: 0, id: 1, language: 1 } }).toArray()) lang.set(b.id, b.language || 'unknown');
  }
  const L = (id) => lang.get(id) || 'unknown';
  const blank = () => ({ written: 0, flagged_pages: 0, unlicensed_pages: 0, licensed_pages: 0, phrases: 0 });
  const byLang = {}, byVersion = {}, byTag = {};
  for (const w of written) {
    (byLang[L(w._id.book)] ||= blank()).written += w.n;
    (byVersion[String(w._id.v ?? '')] ||= blank()).written += w.n;
  }
  const rows = [];
  for (const p of cand) {
    const f = lifeWordFindings(p.translation?.data, p.ocr?.data);
    if (!f.hits.length) continue;
    const v = String(p.translation?.prompt_version ?? '');
    for (const t of [byLang[L(p.book_id)] ||= blank(), byVersion[v] ||= blank()]) {
      t.flagged_pages++; t.phrases += f.hits.length;
      if (f.licensed) t.licensed_pages++; else t.unlicensed_pages++;
    }
    for (const h of f.hits) byTag[h.tag] = (byTag[h.tag] || 0) + 1;
    rows.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, language: L(p.book_id), prompt_version: v, licensed: f.licensed, tags: [...new Set(f.hits.map((h) => h.tag))], phrases: f.hits.map((h) => h.phrase.toLowerCase()) });
  }
  const rate = (t) => (t.written ? +(1000 * t.unlicensed_pages / t.written).toFixed(2) : null);
  const table = (o) => Object.entries(o).sort((a, b) => b[1].written - a[1].written).map(([k, t]) => ({ key: k, ...t, unlicensed_per_1k: rate(t) }));
  const summary = {
    window: { from: from.toISOString(), to: to.toISOString() },
    written: written.reduce((s, w) => s + w.n, 0), candidates: cand.length, flagged_pages: rows.length,
    unlicensed_pages: rows.filter((r) => !r.licensed).length, by_tag: byTag,
    by_language: table(byLang), by_prompt_version: table(byVersion),
    rule: 'scripts/lib/life-word-gloss.mjs lifeWordFindings; a floor, flag-only (#7458)',
  };
  console.log(`life-word glosses, translations written ${summary.window.from.slice(0, 10)} → ${summary.window.to.slice(0, 10)}: ${summary.written} pages, ${summary.unlicensed_pages} with an unlicensed life phrase in gloss/note/term`);
  console.log('language'.padEnd(22), 'written'.padStart(8), 'unlicensed'.padStart(11), 'licensed'.padStart(9), 'per 1k'.padStart(7));
  for (const t of summary.by_language.filter((t) => t.written || t.flagged_pages).slice(0, 25)) console.log(String(t.key).padEnd(22), String(t.written).padStart(8), String(t.unlicensed_pages).padStart(11), String(t.licensed_pages).padStart(9), String(t.unlicensed_per_1k ?? '').padStart(7));
  console.log('by prompt version:', summary.by_prompt_version.filter((t) => t.written).map((t) => `${t.key || '(none)'} ${t.unlicensed_pages}/${t.written}`).join(' · '));
  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
    fs.writeFileSync(path.join(OUT, 'pages.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
    console.log(`wrote ${path.join(OUT, 'summary.json')} and pages.jsonl (${rows.length} rows)`);
  }
} finally {
  await client.close();
}
