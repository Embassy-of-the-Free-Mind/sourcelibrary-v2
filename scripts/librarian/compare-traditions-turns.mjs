// Run the #6077 comparison questions against a deploy; check every URL (HTTP
// status) and every quote (against the page it links). Writes JSON, prints one
// line per turn. Anonymous turns are capped at 5/hour per IP: one full run.
// usage: node --env-file=.env.production.local scripts/librarian/compare-traditions-turns.mjs <base-url> <out.json> [startIdx] [endIdx]
// The limiter buckets by UTC clock hour (rate-limit.ts), so the 5 slots reopen at :00.
import { MongoClient } from 'mongodb';
import fs from 'node:fs';

const [base, outPath, startArg, endArg] = process.argv.slice(2);
const QUESTIONS = [
  'How do Chan, Sufi and Kabbalist texts describe the annihilation of the self?',
  'What does the Zhuangzi say about the heavenly and the human, and is there a parallel in the Ikhwān al-Ṣafāʾ?',
  'Using only the books on the eternity-spot-check shelf, how do Buddhist and Sufi texts describe the stages of the path?',
  'Compare what the Hermetica and the Neoplatonists say about the soul\'s ascent and return to the One.',
  'How do Daoist and Vedantic texts speak of the source that is beyond names?',
  // Added once the Chan canon (cbeta-chan-2026-10) and Tsongkhapa's Mind-Only section were translated.
  'Is the world only mind? Compare Yogācāra in Tsongkhapa, Śaṅkara\'s Advaita, and Chan records.',
];

const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function runTurn(q) {
  const res = await fetch(`${base}/api/embassy/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: q, stream: true, history: [] }),
  });
  if (!res.ok) return { status: res.status, error: await res.text() };
  const raw = await res.text();
  const tools = []; let text = ''; let fixes = []; let threadId = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
    if (ev.type === 'threadId') threadId = ev.threadId;
    if (ev.type === 'tool_call') tools.push({ name: ev.name, query: ev.query });
    if (ev.type === 'tool_result') tools.push({ result: ev.name, summary: ev.summary });
    if (ev.type === 'chunk') text += ev.text || '';
    if (ev.type === 'citation_fixes') fixes = ev.fixes || [];
  }
  for (const f of fixes) if (f.from && f.to) text = text.split(f.from).join(f.to);
  return { status: res.status, threadId, tools, text, fixes };
}

async function checkUrls(text) {
  const urls = [...new Set([...text.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map(m => m[1]))];
  const out = [];
  for (const u of urls) {
    let code = 0;
    try { code = (await fetch(u, { redirect: 'follow', method: 'GET' })).status; } catch { code = -1; }
    out.push({ url: u, code });
  }
  return out;
}

function pageRef(u) {
  const m = u.match(/\/book\/([^/?#)]+)(?:\/page-number\/(\d+)|\?page=(\d+))/);
  return m ? { slug: decodeURIComponent(m[1]), page: Number(m[2] || m[3]) } : null;
}

async function checkQuotes(db, text) {
  // A quote = a blockquote paragraph or a “…”/"…" run of 25+ chars; its page =
  // the first page link in the same paragraph or the next one.
  const paras = text.split(/\n\s*\n/);
  const results = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const quotes = [];
    if (/^\s*>/m.test(p)) {
      const bq = p.split('\n').filter(l => l.trim().startsWith('>')).map(l => l.replace(/^\s*>\s?/, '')).join(' ');
      for (const seg of bq.split(/\s*[—–-]\s*\*?\[?Page|\(\[|\[/)) if (seg.replace(/[*_"“”]/g, '').trim().length >= 25) { quotes.push(seg); break; }
    }
    for (const m of p.matchAll(/[“"]([^”"]{25,})[”"]/g)) quotes.push(m[1]);
    if (quotes.length === 0) continue;
    const links = [...(p + '\n' + (paras[i + 1] || '')).matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map(m => pageRef(m[1])).filter(Boolean);
    for (const q of quotes) {
      const clean = q.replace(/\*\*?|_/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').trim();
      if (!links.length) { results.push({ quote: clean.slice(0, 120), verdict: 'no-page-link' }); continue; }
      let best = { verdict: 'not-found', ratio: 0 };
      for (const ref of links) {
        const book = await db.collection('books').findOne({ $or: [{ slug: ref.slug }, { id: ref.slug }] }, { projection: { id: 1 } });
        if (!book) continue;
        const pg = await db.collection('pages').findOne({ book_id: book.id, page_number: ref.page }, { projection: { 'translation.data': 1, 'ocr.data': 1 } });
        if (!pg) continue;
        const hay = norm(`${pg.translation?.data || ''} ${pg.ocr?.data || ''}`);
        const needle = norm(clean.replace(/\.\.\.|…/g, ' '));
        // Ellipses split a quote into pieces; each piece must appear.
        const pieces = clean.split(/\.\.\.|…/).map(norm).filter(s => s.length >= 8);
        if (pieces.length && pieces.every(s => hay.includes(s))) { best = { verdict: 'exact', ratio: 1, ref }; break; }
        const words = needle.split(' ').filter(w => w.length > 3);
        const hit = words.filter(w => hay.includes(w)).length / Math.max(1, words.length);
        if (hit > best.ratio) best = { verdict: hit >= 0.8 ? 'near' : 'not-found', ratio: Number(hit.toFixed(2)), ref };
      }
      results.push({ quote: clean.slice(0, 160), ...best });
    }
  }
  return results;
}

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const prior = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : [];
const start = Number(startArg || 0);
const end = endArg === undefined ? QUESTIONS.length - 1 : Number(endArg);
for (let i = start; i <= end; i++) {
  const q = QUESTIONS[i];
  const t0 = Date.now();
  const turn = await runTurn(q);
  const urls = turn.text ? await checkUrls(turn.text) : [];
  const quotes = turn.text ? await checkQuotes(db, turn.text) : [];
  const rec = { i, q, ms: Date.now() - t0, ...turn, urls, quotes };
  prior[i] = rec;
  fs.writeFileSync(outPath, JSON.stringify(prior, null, 2));
  const bad = urls.filter(u => u.code !== 200);
  console.log(`#${i} status=${turn.status} ${Math.round(rec.ms / 1000)}s tools=${turn.tools?.filter(t => t.name).map(t => t.name).join(',')} urls=${urls.length} bad=${bad.length} quotes=${quotes.length} exact=${quotes.filter(x => x.verdict === 'exact').length} near=${quotes.filter(x => x.verdict === 'near').length}`);
}
await c.close();
