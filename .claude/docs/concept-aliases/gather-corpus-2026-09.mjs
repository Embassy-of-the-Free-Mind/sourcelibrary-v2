// PRIOR ART: /root/gather-candidates.mjs on Hetzner (the curated-seed gatherer, not in the
// repo) — same bridge-DB queries; this one takes exact corpus term_keys instead of regex
// prefixes and drops the sorted evidence query (14 s → 0.5 s per seed).
// Step 3 of the page-terms handoff: gather alias CANDIDATES for corpus-derived seeds.
// Adapted from /root/gather-candidates.mjs (curated seeds with regex-ish variants used as
// prefixes). Differences: every seed is ONE exact term_key (no prefix expansion — a corpus
// seed like "soul" would otherwise pull 40 "soul …" keys as seed forms); candidates capped
// at 20 with 2 evidence rows each to keep one judge request under ~8 KB; seed forms carry
// the term's own top glosses as `seed_glosses`.
//   node gather-corpus.mjs <bridges.sqlite> <raw.sqlite> <batch.json> <out.jsonl> [offset] [count]
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [,, BR, RAW, BATCH, OUT, OFF = '0', CNT = '999999'] = process.argv;
const br = new DatabaseSync(BR, { readOnly: true });
const raw = new DatabaseSync(RAW, { readOnly: true });
const batch = JSON.parse(fs.readFileSync(BATCH, 'utf8')).slice(Number(OFF), Number(OFF) + Number(CNT));
const gk = (s) => String(s).normalize('NFC').toLowerCase().replace(/[*_"'“”‘’«».,;:()]/g, ' ').replace(/\s+/g, ' ').trim();
const MAX_CAND = 20;

const surfByKey = br.prepare('SELECT term, kind, n, books, pages FROM surf WHERE term_key = ? ORDER BY n DESC');
const glossesOf = br.prepare('SELECT gloss, gloss_key, lang, kind, SUM(n) n, SUM(books) books FROM tg WHERE term_key = ? GROUP BY gloss_key ORDER BY n DESC LIMIT 10');
const termsWithGloss = br.prepare('SELECT term_key, term, lang, kind, SUM(n) n, SUM(books) books FROM tg WHERE gloss_key = ? GROUP BY term_key ORDER BY n DESC LIMIT 25');
const renderOf = br.prepare('SELECT rendering, n FROM render WHERE term_key = ? ORDER BY n DESC LIMIT 5');
// No ORDER BY: sorting every row of a 25K-row key cost ~14 s per seed. Two indexed probes
// (context first, then glossed) give the same preference order at index speed.
const evCtx = raw.prepare('SELECT book_id, page_number, kind, gloss, context FROM raw WHERE term_key = ? AND context IS NOT NULL LIMIT 2');
const evGloss = raw.prepare('SELECT book_id, page_number, kind, gloss, context FROM raw WHERE term_key = ? AND gloss IS NOT NULL LIMIT 2');
const evidence = { all(tk) { const a = evCtx.all(tk); return a.length >= 2 ? a : [...a, ...evGloss.all(tk)].slice(0, 2); } };

function stats(tk) {
  const s = surfByKey.all(tk);
  return { term_key: tk, surfaces: s.slice(0, 4).map((r) => `${r.term}[${r.kind}]×${r.n}`), pages: s.reduce((a, r) => a + r.pages, 0), books: Math.max(0, ...s.map((r) => r.books)) };
}

const out = fs.openSync(OUT, 'a');
let done = 0;
const t0 = Date.now();
for (const seed of batch) {
  const tk = seed.k;
  const topGlosses = glossesOf.all(tk);
  const viaGloss = new Map();
  for (const g of topGlosses) for (const t of termsWithGloss.all(g.gloss_key)) {
    if (t.term_key === tk) continue;
    const e = viaGloss.get(t.term_key) || { term_key: t.term_key, term: t.term, lang: t.lang, n: 0, books: 0, via: [] };
    e.n += t.n; e.books += t.books; if (!e.via.includes(g.gloss)) e.via.push(g.gloss);
    viaGloss.set(t.term_key, e);
  }
  // the seed's own glosses as bridges the other way: a term whose KEY equals one of the seed's glosses
  for (const g of topGlosses) { const k2 = g.gloss_key; if (k2 && k2 !== tk && !viaGloss.has(k2) && surfByKey.get(k2)) viaGloss.set(k2, { term_key: k2, term: g.gloss, lang: null, n: g.n, books: g.books, via: [`= gloss of ${seed.t}`] }); }
  const candidates = [...viaGloss.values()].sort((a, b) => b.books - a.books || b.n - a.n).slice(0, MAX_CAND)
    .map((c) => ({ ...c, ...stats(c.term_key), evidence: evidence.all(c.term_key), renderings: renderOf.all(c.term_key) }));
  const seedForm = { ...stats(tk), renderings: renderOf.all(tk), evidence: evidence.all(tk) };
  fs.writeSync(out, JSON.stringify({ concept: seed.t, term_key: tk, books: seed.b, non_latin: seed.nl, type_source: seed.src, seed_forms: [seedForm], seed_glosses: topGlosses.map((g) => g.gloss), candidates }) + '\n');
  done++;
  if (done % 100 === 0) console.log(`${done}/${batch.length} · ${Math.round((Date.now() - t0) / 1000)}s`);
}
fs.closeSync(out);
console.log(`done ${done} seeds → ${OUT} in ${Math.round((Date.now() - t0) / 1000)}s`);
