#!/usr/bin/env node
/**
 * Merge the two v5 retrieval lanes into one classifier input, deduplicated by page (book#page): a page found by
 * both an English probe sentence (semantic) and a native-language term (lexical) is ONE row carrying both
 * provenances (lanes: ["semantic","lexical"]), so the register/language analysis can ask "which lane found it"
 * without double-counting. Optional --max N draws a language-stratified sample (equal per edition language,
 * round-robin) for a costed pilot. PRIOR ART: none — v4 had one lane, so nothing to merge.
 *   node build/merge-v5.mjs [--max 20000] → hits-v5-merged.jsonl + merge-v5-summary.json
 */
import fs from 'node:fs'; import path from 'node:path';
const V5 = process.env.V5_OUT || path.join(process.env.HOME, 'sourcelibrary', 'scripts', 'output', 'experience-map', 'v5');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }; const MAX = +arg('--max', 0);
const rows = new Map();
for (const [file, lane] of [['hits-v5.jsonl', 'semantic'], ['hits-v5-lex.jsonl', 'lexical']]) { const f = path.join(V5, file); if (!fs.existsSync(f)) { console.log(`no ${file}`); continue; } let n = 0; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); n++; const have = rows.get(r.page_id); if (!have) { rows.set(r.page_id, { ...r, lanes: [lane], probes: [{ lane, dim: r.dim, probe: r.probe, probe_lang: r.probe_lang || 'English', probe_source: r.probe_source || 'probes-v2' }] }); continue; } if (!have.lanes.includes(lane)) have.lanes.push(lane); have.probes.push({ lane, dim: r.dim, probe: r.probe, probe_lang: r.probe_lang || 'English', probe_source: r.probe_source || 'probes-v2' }); if (lane === 'lexical' && !have.probe_lang) { have.probe_lang = r.probe_lang; have.probe_source = r.probe_source; } } console.log(`${file}: ${n} rows`); }
let list = [...rows.values()]; const both = list.filter((r) => r.lanes.length > 1).length;
const byLang = {}; for (const r of list) (byLang[r.book_language || '?'] ||= []).push(r);
if (MAX && list.length > MAX) { const langs = Object.values(byLang); for (const a of langs) a.sort(() => Math.random() - 0.5); const out = []; let i = 0; while (out.length < MAX) { let any = false; for (const a of langs) { if (i < a.length) { out.push(a[i]); any = true; if (out.length >= MAX) break; } } if (!any) break; i++; } list = out; }
const o = fs.createWriteStream(path.join(V5, 'hits-v5-merged.jsonl')); for (const r of list) o.write(JSON.stringify(r) + '\n'); o.end();
const perLang = {}; for (const r of list) perLang[r.book_language || '?'] = (perLang[r.book_language || '?'] || 0) + 1; const perLane = {}; for (const r of list) { const k = r.lanes.join('+'); perLane[k] = (perLane[k] || 0) + 1; }
fs.writeFileSync(path.join(V5, 'merge-v5-summary.json'), JSON.stringify({ built: new Date().toISOString(), unique_pages: rows.size, found_by_both_lanes: both, written: list.length, max: MAX, perLane, perLang }, null, 1));
console.log(`${rows.size} unique pages (${both} found by both lanes) → wrote ${list.length}; lanes:`, perLane, '\nlanguages:', Object.entries(perLang).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([l, n]) => `${l}:${n}`).join('  '));
