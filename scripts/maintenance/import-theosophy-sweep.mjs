#!/usr/bin/env node
/**
 * Exhaustive sweep — remaining importable books from the Campbell index.
 *
 * Takes the parsed Campbell works (.claude/docs/theosophical-import/campbell-works.json),
 * filters to pre-1929 book-length entries NOT already in SL, finds a confident
 * Internet Archive scan for each (token + surname + year scoring), and imports
 * every real public-domain match. Dedup is enforced at the import endpoint (409).
 *
 * Conservative: skips any candidate without a high-confidence IA match, and logs
 * every bucket (imported / exists / no-match / low-confidence / failed) so nothing
 * is silently dropped. Results -> /tmp/sweep-results.json.
 *
 * Auth via CRON_SECRET bearer. Imports are additive, hidden, reversible.
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'fs';

const BASE = process.env.SL_BASE || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) { console.error('Missing CRON_SECRET'); process.exit(1); }
const AUTH = { Authorization: `Bearer ${CRON_SECRET}`, 'Content-Type': 'application/json' };
const WORKS_PATH = process.env.WORKS_PATH || '/tmp/campbell-works.json';

const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\b(the|a|an|of|and|or|on|in|to|de|la|le|des|its|being|with)\b/g, ' ').replace(/\s+/g, ' ').trim();
const surname = (a) => { if (!a) return ''; a = a.replace(/\(.*?\)/g, '').split(/[,;]/)[0].trim(); const p = a.split(/\s+/).filter(Boolean); return (p[p.length - 1] || '').toLowerCase().replace(/[^a-z]/g, ''); };
const tokens = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 2));
const overlap = (a, b) => { const A = tokens(a), B = tokens(b); if (!A.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / A.size; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARTICLE = /\b(part \d|comments?|deposition|review|notes on|problem|evidence|position|address|essay|article|reply|stray thoughts|selections?)\b/i;

async function iaSearch(work) {
  const titleWords = norm(work.title).split(' ').filter((w) => w.length > 3).slice(0, 5).join(' ');
  const sn = surname(work.author);
  const q = `(${titleWords}) AND mediatype:texts${sn ? ` AND ${sn}` : ''} AND year:[1700 TO 1935]`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&rows=8&sort[]=downloads+desc&output=json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const docs = (await r.json())?.response?.docs || [];
    let best = null;
    for (const d of docs) {
      if (!d.identifier) continue;
      const yr = parseInt(d.year, 10);
      if (yr && yr > 1929) continue; // public domain only
      const titleScore = overlap(work.title, d.title || '');
      const creator = Array.isArray(d.creator) ? d.creator.join(' ') : (d.creator || '');
      const snMatch = sn && surname(creator) === sn ? 1 : (sn && creator.toLowerCase().includes(sn) ? 0.6 : 0);
      const yearScore = work.year && yr ? Math.max(0, 1 - Math.abs(yr - work.year) / 40) : 0.3;
      const score = titleScore * 0.6 + snMatch * 0.3 + yearScore * 0.1;
      if (!best || score > best.score) best = { id: d.identifier, iaTitle: d.title, iaYear: yr || null, creator, titleScore, snMatch, score };
    }
    return best;
  } catch { return null; }
}

async function importBook(payload) {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(`${BASE}/api/import/ia`, { method: 'POST', headers: AUTH, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
      const text = await res.text();
      if (res.ok || res.status === 409) return { ok: res.ok, status: res.status, text };
      if (res.status >= 500 && a < 3) { await sleep(8000); continue; }
      return { ok: false, status: res.status, text };
    } catch (e) { if (a === 3) return { ok: false, status: 0, text: String(e) }; await sleep(8000); }
  }
}

// ---- build candidate list ----
const works = JSON.parse(readFileSync(WORKS_PATH, 'utf8'));
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const sl = await client.db('bookstore').collection('books').find({}, { projection: { _id: 0, title: 1, display_title: 1 } }).toArray();
const slTitles = new Set();
for (const b of sl) for (const t of [b.title, b.display_title]) { const n = norm(t); if (n.length > 3) slTitles.add(n); }
const inSL = (t) => { const n = norm(t); if (slTitles.has(n)) return true; if (n.length < 10) return false; for (const s of slTitles) if (s.length > 10 && (s.includes(n) || n.includes(t))) return true; return false; };

const candidates = works.filter((w) => w.year && w.year <= 1929 && w.title.split(/\s+/).length >= 3 && !ARTICLE.test(w.title) && !/^(about )/i.test(w.author) && !inSL(w.title));
console.log(`Candidates (pre-1929, book-ish, not in SL): ${candidates.length}`);

const results = { imported: [], exists: [], noMatch: [], lowConf: [], failed: [] };
const seenIds = new Set();
let i = 0;
for (const w of candidates) {
  i++;
  const m = await iaSearch(w);
  await sleep(350);
  if (!m) { results.noMatch.push({ ...w }); console.log(`[${i}/${candidates.length}] NO-IA   ${w.title.slice(0, 45)}`); continue; }
  if (m.titleScore < 0.5 || m.snMatch === 0) { results.lowConf.push({ ...w, ia: m.id, iaTitle: m.iaTitle, score: +m.score.toFixed(2) }); console.log(`[${i}/${candidates.length}] LOWCONF ${w.title.slice(0, 40)} ~ ${String(m.iaTitle).slice(0, 30)}`); continue; }
  if (seenIds.has(m.id)) { results.exists.push({ ...w, ia: m.id, note: 'dup-in-batch' }); continue; }
  seenIds.add(m.id);
  const payload = { ia_identifier: m.id, title: w.title, author: w.author, year: w.year, original_language: 'English' };
  const r = await importBook(payload);
  if (r.status === 409) { results.exists.push({ ...w, ia: m.id }); console.log(`[${i}/${candidates.length}] EXISTS  ${w.title.slice(0, 45)}`); }
  else if (r.ok) { results.imported.push({ ...w, ia: m.id }); console.log(`[${i}/${candidates.length}] OK      ${w.title.slice(0, 45)} <- ${m.id}`); }
  else { results.failed.push({ ...w, ia: m.id, status: r.status }); console.log(`[${i}/${candidates.length}] FAIL${r.status} ${w.title.slice(0, 40)}`); }
  await sleep(250);
}

writeFileSync('/tmp/sweep-results.json', JSON.stringify(results, null, 1));
console.log(`\n=== SWEEP DONE ===`);
console.log(`imported: ${results.imported.length} | already-held: ${results.exists.length} | low-confidence (skipped): ${results.lowConf.length} | no IA match: ${results.noMatch.length} | failed: ${results.failed.length}`);
await client.close();
