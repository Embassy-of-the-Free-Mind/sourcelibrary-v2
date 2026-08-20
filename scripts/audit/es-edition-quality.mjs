#!/usr/bin/env node
/**
 * Quality audit of the Spanish editions (pages.translations.es vs pages.translation).
 *
 * Mechanical checks only — no model judge (a judge needs a positive control and
 * a budget; see .claude/docs/invariants/measurement-instruments.md). Per page:
 *
 *   ratio      ES/EN body length (editorial wrappers stripped). Band 0.7–1.6 is
 *              normal for EN→ES; outside 0.5–2.0 should be impossible (worker guard).
 *   tags       XML-like tag multiset preserved (<note>, <header>, <meta>, <term>…).
 *   headings   markdown heading count preserved.
 *   numerals   set of numbers ≥ 2 digits preserved (dates, folio refs, chapters).
 *   spanish    share of Spanish function words vs English function words — catches
 *              pages left (partly) in English or the model answering in English.
 *   repetition most-repeated 6-gram share — catches runaway loops.
 *   truncated  ES ends without terminal punctuation while EN has it.
 *   empty      ES body empty while EN has ≥ 200 chars.
 *
 * Output: a markdown report (stdout) + JSON (--out) with per-book stats and the
 * flagged pages, so a human (or a re-run with a stricter prompt) can act on
 * exactly those pages. Writes nothing to the database.
 *
 *   node --env-file=.env.production.local scripts/audit/es-edition-quality.mjs [--book=<id>[,..]] [--out=file.json] [--limit-per-book=N]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const val = (f) => { const m = args.find((a) => a.startsWith(`${f}=`)); return m ? m.slice(f.length + 1) : undefined; };
const BOOK = val('--book');
const OUT = val('--out');
const LIMIT = parseInt(val('--limit-per-book') || '0', 10);

const WRAP = /<(meta|image-desc|vocab|summary|keywords|warning|scan-quality|language|page-type|page-num|columns|script)\b[^>]*>[\s\S]*?<\/\1>/gi;
const body = (t) => String(t || '').replace(WRAP, ' ').replace(/<[^>]+>/g, ' ').replace(/[#*_>|`-]+/g, ' ').replace(/\s+/g, ' ').trim();
const tagset = (t) => { const m = {}; for (const x of String(t || '').matchAll(/<\/?([a-z][a-z0-9-]*)\b/gi)) { const k = x[1].toLowerCase(); m[k] = (m[k] || 0) + 1; } return m; };
const headings = (t) => (String(t || '').match(/^#{1,6}\s/gm) || []).length;
const numerals = (t) => new Set((body(t).match(/\b\d{2,}\b/g) || []));
const ES_FN = /\b(el|la|los|las|de|del|que|y|en|un|una|por|con|para|es|se|su|al|como|más|pero|sus|le|ya|o|este|esta|porque|cuando|también|donde|sobre|entre|hasta|desde|sin|muy|ser|son|fue|era|han|sido|tiene|hay)\b/gi;
const EN_FN = /\b(the|of|and|to|in|is|that|it|was|for|on|are|as|with|his|they|be|at|this|have|from|or|by|one|had|not|but|what|all|were|when|we|there|can|which|their|said|if|will|each|about|how|up|out|them|then|she|many|some|so|these|would|other|into|has|more|her|two|like|him|see|could|than|been|who|its|now|made|over|did|down|only|way|may|after|where|most|through|also|before|such|because|must|very|should|those|being|between)\b/gi;
function spanishShare(t) {
  const b = body(t); if (!b) return null;
  const es = (b.match(ES_FN) || []).length, en = (b.match(EN_FN) || []).length;
  return es + en === 0 ? null : es / (es + en);
}
function repetition(t) {
  const w = body(t).toLowerCase().split(' ').filter(Boolean);
  if (w.length < 60) return 0;
  const counts = new Map(); let max = 0;
  for (let i = 0; i + 6 <= w.length; i++) { const k = w.slice(i, i + 6).join(' '); const n = (counts.get(k) || 0) + 1; counts.set(k, n); if (n > max) max = n; }
  return (max * 6) / w.length;
}
const endsTerminal = (t) => /[.!?»"”)\]:;…]\s*$/.test(body(t));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

// Every check is RELATIVE to the English page. The first run of this audit flagged
// 462 pages; every "severe" sample was a false positive — repetition that the
// English table also has (Dresden Codex glyph registers), English lemmas quoted
// inside errata tables, <unclear> tags counted differently. A check that does not
// look at the source page measures the source's shape, not the translation.
const hasTable = (t) => /^\|.*\|\s*$/m.test(String(t || ''));
function checkPage(en, es) {
  const enB = body(en), esB = body(es);
  const flags = [];
  const ratio = enB.length ? esB.length / enB.length : null;
  if (enB.length >= 200 && esB.length === 0) flags.push('empty');
  else if (ratio !== null && enB.length >= 200 && (ratio < 0.7 || ratio > 1.6)) flags.push(ratio < 0.7 ? 'short' : 'long');
  // Structure: only tag TYPES the English has and the Spanish LOST (fewer), ignoring
  // inline markup whose count legitimately drifts in translation.
  const te = tagset(en), ts = tagset(es);
  const IGNORE = new Set(['unclear', 'term', 'gloss', 'i', 'b', 'sup', 'sub', 'br']);
  const lost = Object.keys(te).filter((k) => !IGNORE.has(k) && (ts[k] || 0) < te[k]);
  if (lost.length) flags.push(`tags-lost:${lost.slice(0, 3).join('/')}`);
  if (headings(en) > headings(es)) flags.push('headings-lost');
  const ne = numerals(en), ns = numerals(es);
  if (!sameSet(ne, ns)) { const missing = [...ne].filter((x) => !ns.has(x)); if (missing.length > Math.max(1, ne.size * 0.2)) flags.push(`numerals:-${missing.length}`); }
  // Language: Spanish function-word share; tables quote source lemmas legitimately,
  // so require a clear majority of English OUTSIDE table pages.
  const sp = spanishShare(es);
  if (sp !== null && enB.length >= 200 && sp < (hasTable(es) ? 0.5 : 0.7)) flags.push(`english:${Math.round((1 - sp) * 100)}%`);
  // Runaway: repetition the SPANISH introduced (beyond what the English already has).
  const repEn = repetition(en), repEs = repetition(es);
  if (repEs > 0.25 && repEs > repEn * 1.5 + 0.1) flags.push(`repetition:${Math.round(repEs * 100)}%`);
  // Truncation: English closes, Spanish does not, AND the Spanish is visibly shorter.
  if (enB.length >= 200 && endsTerminal(en) && !endsTerminal(es) && ratio !== null && ratio < 0.9) flags.push('truncated');
  return { ratio, spanishShare: sp, repetition: repEs, flags };
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const bookFilter = BOOK ? { id: { $in: BOOK.split(',') } } : { pages_translated_es: { $gt: 0 } };
const books = await db.collection('books').find(bookFilter, { projection: { _id: 0, id: 1, title: 1, language: 1, pages_translated_es: 1, pages_translated: 1 } }).toArray();

const report = { generated: new Date().toISOString(), books: [], totals: { pages: 0, flagged: 0, byFlag: {} } };
for (const b of books) {
  const cur = db.collection('pages').find({ book_id: b.id, 'translations.es.data': { $type: 'string', $ne: '' } }, { projection: { id: 1, page_number: 1, 'translation.data': 1, 'translations.es.data': 1 }, sort: { page_number: 1 }, ...(LIMIT ? { limit: LIMIT } : {}) });
  const stat = { id: b.id, title: (b.title || '').slice(0, 60), language: b.language, pages: 0, flagged: 0, ratios: [], spanish: [], byFlag: {}, worst: [] };
  for await (const p of cur) {
    const r = checkPage(p.translation?.data, p.translations.es.data);
    stat.pages++; report.totals.pages++;
    if (r.ratio !== null) stat.ratios.push(r.ratio);
    if (r.spanishShare !== null) stat.spanish.push(r.spanishShare);
    if (r.flags.length) {
      stat.flagged++; report.totals.flagged++;
      for (const f of r.flags) { const k = f.split(':')[0]; stat.byFlag[k] = (stat.byFlag[k] || 0) + 1; report.totals.byFlag[k] = (report.totals.byFlag[k] || 0) + 1; }
      stat.worst.push({ page_id: p.id, page_number: p.page_number, ratio: r.ratio && +r.ratio.toFixed(2), flags: r.flags, url: `https://sourcelibrary.org/book/${b.id}/page/${p.id}?lang=es` });
    }
  }
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
  stat.medianRatio = med(stat.ratios); stat.medianSpanish = med(stat.spanish);
  // Severity order for the worst list: empty/english/repetition/truncated first, then structure, then length.
  const sev = (f) => f.some((x) => /^(empty|english|repetition)/.test(x)) ? 0 : f.some((x) => /^(truncated|short)/.test(x)) ? 1 : f.some((x) => /^(tags|headings|numerals)/.test(x)) ? 2 : 3;
  stat.worst.sort((a, b2) => sev(a.flags) - sev(b2.flags));
  stat.worst = stat.worst.slice(0, 12);
  delete stat.ratios; delete stat.spanish;
  report.books.push(stat);
}
report.books.sort((a, b) => (b.flagged / Math.max(1, b.pages)) - (a.flagged / Math.max(1, a.pages)));

// ---- markdown ----
const pct = (n, d) => d ? `${((100 * n) / d).toFixed(1)}%` : '–';
console.log(`# Spanish editions — quality audit (${report.generated.slice(0, 16)}Z)\n`);
console.log(`${report.books.length} books, ${report.totals.pages} Spanish pages, ${report.totals.flagged} flagged (${pct(report.totals.flagged, report.totals.pages)}).`);
console.log(`Flags: ${Object.entries(report.totals.byFlag).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
console.log('| flagged | pages | med ratio | med Spanish | worst flags | book |\n|---|---|---|---|---|---|');
for (const s of report.books) console.log(`| ${pct(s.flagged, s.pages)} | ${s.pages} | ${s.medianRatio ?? '–'} | ${s.medianSpanish != null ? pct(s.medianSpanish, 1) : '–'} | ${Object.entries(s.byFlag).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ')} | ${s.title} (${s.language}) |`);
const severe = report.books.flatMap((s) => s.worst.filter((w) => w.flags.some((f) => /^(empty|english|repetition|truncated|short)/.test(f))).map((w) => ({ ...w, book: s.title })));
console.log(`\n## Severe pages (${severe.length} shown, worst first)\n`);
for (const w of severe.slice(0, 60)) console.log(`- p${w.page_number} ratio ${w.ratio ?? '–'} [${w.flags.join(', ')}] ${w.book} — ${w.url}`);
if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 1)); console.error(`\nJSON → ${OUT}`); }
await client.close();
