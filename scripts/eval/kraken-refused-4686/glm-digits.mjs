#!/usr/bin/env node
// PRIOR ART: collect-mineru.mjs (same directory: turns one engine's raw outputs into a bench arm). Nothing
// here merges two engines; the merge is scripts/lib/glm-digit-repair.mjs (Amendment 1 of the preregistration).
/**
 * glm-digits.mjs — build the GLM-digit-repaired Kraken read (#4686, Amendment 1).
 *
 *   node scripts/eval/kraken-refused-4686/glm-digits.mjs --lane=/root/kraken-digits-4686 \
 *        --bench=/root/kraken-digits-4686/bench [--cpu=/root/kraken-refused-4686/bench/refused-en-4686/out/kraken-catmus]
 *
 * Reads <lane>/kr/<book>_<page>.txt (Kraken on the GPU) and <lane>/out/<book>/<page>.txt (GLM-OCR).
 * Writes:
 *   - <lane>/merged/<book>/<page>.txt for every manifest page with a Kraken read, and <lane>/merged/changes.jsonl
 *     (one row per page: tokens, tokens changed, the changes);
 *   - bench arms for the 20 eval pages: kraken-catmus-gpu, glm-ocr, kraken-catmus-glm-digits (GPU Kraken +
 *     GLM digits: what would be written), and with --cpu, kraken-catmus-cpu-glm-digits (the scored CPU read + GLM).
 * $0: files only.
 */
import fs from 'fs';
import path from 'path';
import { repairDigits } from '../../lib/glm-digit-repair.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const LANE = argOf('lane', '/root/kraken-digits-4686');
const BENCH = argOf('bench', null);
const CPU = argOf('cpu', null);
const STRATUM = 'refused-en-4686';
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const put = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

const rows = fs.readFileSync(path.join(LANE, 'manifest.tsv'), 'utf8').trim().split('\n').map(l => l.split('\t'));
const changesOut = path.join(LANE, 'merged', 'changes.jsonl');
fs.mkdirSync(path.dirname(changesOut), { recursive: true });
const log = fs.createWriteStream(changesOut);
let pages = 0, noKraken = 0, noGlm = 0, changed = 0, tokChanged = 0, tokTotal = 0;
for (const [bid, pn] of rows) {
  const kr = read(path.join(LANE, 'kr', `${bid}_${pn}.txt`));
  if (kr == null) { noKraken++; log.write(JSON.stringify({ bid, pn: +pn, status: 'no-kraken' }) + '\n'); continue; }
  const glm = read(path.join(LANE, 'out', bid, `${pn}.txt`));
  if (glm == null) noGlm++;
  const r = repairDigits(kr, glm || '');
  const toks = (kr.match(/\S+/g) || []).length;
  pages++; tokTotal += toks; tokChanged += r.changes.length; if (r.changes.length) changed++;
  put(path.join(LANE, 'merged', bid, `${pn}.txt`), r.text);
  log.write(JSON.stringify({ bid, pn: +pn, glm: glm != null, tokens: toks, changed: r.changes.length, share: toks ? Math.round(1e4 * r.changes.length / toks) / 1e4 : 0, changes: r.changes }) + '\n');
}
log.end();
console.log(`merged ${pages} pages (no Kraken ${noKraken}, no GLM ${noGlm}); ${changed} pages changed, ${tokChanged} of ${tokTotal} tokens`);

if (BENCH) {
  const reg = JSON.parse(fs.readFileSync(new URL(`../benchmark/${STRATUM}.json`, import.meta.url), 'utf8'));
  const slugs = (reg.pages || reg).filter(p => !p.spare).map(p => p.slug);   // the 20 drawn pages; spares were never used
  const out = (arm, slug, s) => put(path.join(BENCH, STRATUM, 'out', arm, `${slug}.txt`), s ?? '');
  for (const slug of slugs) {
    const m = /^rf-([0-9a-f]{24})-p(\d+)$/.exec(slug);
    const [, bid, pn] = m;
    const kr = read(path.join(LANE, 'kr', `${bid}_${pn}.txt`));
    const glm = read(path.join(LANE, 'out', bid, `${pn}.txt`));
    out('kraken-catmus-gpu', slug, kr);
    out('glm-ocr', slug, glm);
    out('kraken-catmus-glm-digits', slug, kr == null ? '' : repairDigits(kr, glm || '').text);
    if (CPU) { const c = read(path.join(CPU, `${slug}.txt`)); out('kraken-catmus', slug, c); out('kraken-catmus-cpu-glm-digits', slug, c == null ? '' : repairDigits(c, glm || '').text); }
  }
  console.log(`bench arms written for ${slugs.length} eval pages under ${path.join(BENCH, STRATUM, 'out')}`);
}
