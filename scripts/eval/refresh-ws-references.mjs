#!/usr/bin/env node
// PRIOR ART: harvest-wikisource-gt.mjs SELECTS pages (shuffled, capped at --max) and
// wikisource-gt-to-groundtruth.mjs converts a harvest file into ground-truth-ws/. Neither can
// do this job: re-running the harvester draws a DIFFERENT page set, which would orphan the
// stored arm outputs in results/scorecard-outputs-*.jsonl, and the converter re-reads the
// harvest file whose `reference` was already cleaned by the buggy cleaner. This refreshes the
// PINNED pages in place from live wikitext, which is the only way to apply a cleaner fix
// without moving the bench underneath the results.
/**
 * refresh-ws-references.mjs — re-clean the pinned Wikisource references from source.
 *
 * Run after any change to lib/wikisource-text.mjs. Dry-run by default: it prints what each
 * reference would gain or lose and writes nothing until --write.
 *
 * Two things move a reference and they must not be confused, so both are reported:
 *   cleaner  — the same wikitext, cleaned differently (that is the point of the run)
 *   drift    — the page itself was edited on Wikisource since it was pinned
 * Measured 2026-09-05, drift is ~0.01% of characters across the pinned set (see
 * reference-error-rate.mjs instrument B), so a large delta here is the cleaner, not Wikisource.
 *
 *   node scripts/eval/refresh-ws-references.mjs            # dry run
 *   node scripts/eval/refresh-ws-references.mjs --write
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { cleanPageText, pageQuality } from './lib/wikisource-text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const WRITE = process.argv.includes('--write');
const DIR = path.join(__dirname, argOf('gt-dir', 'ground-truth-ws'));
const MAX_CHARS = parseInt(argOf('max-chars', '2000'), 10);   // the harvester's own reference cap
const UA = 'SourceLibrary-GT-Refresh/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) node-fetch';

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== '_manifest.json').sort();
const pages = [];
for (const f of files) {
  const gt = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const m = (gt.source_url || '').match(/^https:\/\/([a-z-]+)\.wikisource\.org\/wiki\/(.+)$/);
  if (!m) { console.log(`  -  ${f}: not a Wikisource page, left alone`); continue; }
  pages.push({ file: f, gt, wiki: m[1], title: decodeURIComponent(m[2]).replace(/_/g, ' ') });
}

const byWiki = pages.reduce((a, p) => { (a[p.wiki] ||= []).push(p); return a; }, {});
const wikitext = new Map();
for (const [wiki, ps] of Object.entries(byWiki)) {
  for (let i = 0; i < ps.length; i += 20) {
    const qs = new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'content|ids', rvslots: 'main',
      titles: ps.slice(i, i + 20).map(p => p.title).join('|'), format: 'json', formatversion: '2' });
    const r = await fetch(`https://${wiki}.wikisource.org/w/api.php`, {
      method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs });
    const j = await r.json();
    for (const p of j.query?.pages || []) if (!p.missing) wikitext.set(p.title, p.revisions[0].slots.main.content);
    await new Promise(res => setTimeout(res, 150));
  }
}
console.log(`fetched ${wikitext.size}/${pages.length} current revisions\n`);

let changed = 0, gained = 0, lost = 0, missing = 0, levelChanges = 0;
const rows = [];
for (const p of pages) {
  const wt = wikitext.get(p.title);
  if (!wt) { missing++; console.log(`  !  ${p.file}: page not returned by the API — left untouched`); continue; }
  const next = cleanPageText(wt).slice(0, MAX_CHARS);
  const prev = p.gt.ocr_ground_truth || '';
  const level = pageQuality(wt);
  const delta = next.length - prev.length;
  if (next === prev && level === p.gt.quality_level) continue;
  changed++;
  if (delta > 0) gained += delta; else lost += -delta;
  if (level !== p.gt.quality_level) levelChanges++;
  rows.push({ file: p.file, language: p.gt.language, prevChars: prev.length, nextChars: next.length, delta,
    levelBefore: p.gt.quality_level, levelAfter: level });
  if (WRITE) {
    fs.writeFileSync(path.join(DIR, p.file), JSON.stringify({ ...p.gt, quality_level: level, ocr_ground_truth: next }, null, 2) + '\n');
  }
}

rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
console.log(`${changed}/${pages.length} references change${WRITE ? 'd' : ' (dry run)'}  +${gained} / −${lost} chars  ${levelChanges} proofread-level changes  ${missing} unfetchable\n`);
for (const r of rows.slice(0, 20)) {
  console.log(`  ${(r.delta > 0 ? '+' : '') + r.delta}`.padEnd(8) + `${r.language.padEnd(8)} ${r.prevChars} → ${r.nextChars}  ${r.file.replace(/\.json$/, '').slice(0, 52)}${r.levelBefore !== r.levelAfter ? `  [L${r.levelBefore}→L${r.levelAfter}]` : ''}`);
}
const byLang = rows.reduce((a, r) => { (a[r.language] ||= { n: 0, delta: 0 }); a[r.language].n++; a[r.language].delta += r.delta; return a; }, {});
console.log('\nby language:', JSON.stringify(byLang));
if (!WRITE) console.log('\nDry run — pass --write to apply, then re-run bench2-coverage-report.mjs to see what it does to the arms.');
