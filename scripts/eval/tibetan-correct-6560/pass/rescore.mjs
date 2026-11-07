#!/usr/bin/env node
// PRIOR ART: leafcheck.mjs audit-score — the same audit key and judge replies, scored as a binary per page (worse when
// the leaf shows the draft at more spans than the correction). Derek, 2026-10-26 23:15Z (#6740): that under-counts what
// a correction fixes. This scores each page as errors FIXED vs INTRODUCED, by severity, from the same judge readings.
/**
 *   node rescore.mjs --key=audit-key.json --replies=audit-tiles-out.jsonl [--out=S.json]
 * A span the leaf shows as the correction is FIXED; one it shows as the draft is INTRODUCED; other/unclear count neither.
 * SEVERE (rule fixed before the table was read):
 *   - line-level: one side has >= 6 syllables and the two differ by >= 4 (a dropped, invented or duplicated line);
 *   - negation: a negation syllable (མི མ མེད མིན) on one side and not the other;
 *   - mantra: either side carries a Sanskrit mark or letter (ཱ ཱི ཱུ ྀ ཾ ཿ ྃ ཥ ཎ ཊ ཌ ཀྵ ཛྙ) and the two differ.
 *   (A difference in tsheg only is minor, checked first. First run 2026-10-26 counted the short vowels ི ུ as Sanskrit
 *   marks, a regex bug: fixed to the long vowel sign and the marks listed.)
 *   Everything else (particle, spelling, tsheg, normalisation) is MINOR.
 * A page PASSES when fixed >= introduced and it has no severe error introduced.
 */
import fs from 'node:fs';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
const replies = Object.fromEntries(fs.readFileSync(arg('replies'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => r.text).map((r) => [r.uid, r.text]));
function parse(text) {
  const m = String(text).match(/<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)/); const out = {};
  for (let l of (m ? m[1] : String(text)).split('\n')) { l = l.trim().replace(/,$/, ''); if (!l.startsWith('{')) continue; try { const j = JSON.parse(l); out[Number(j.item)] = j; } catch { /* unanswered */ } }
  return out;
}
const side = (it, a) => { const x = String(a?.answer || '').trim().toUpperCase(); if (x === 'A' || x === 'B') return (x === 'A') === (it.A_is === 'arm') ? 'arm' : 'base'; return x ? x.toLowerCase() : null; };
const syl = (s) => String(s || '').split('་').filter(Boolean);
const NEG = new Set(['མི', 'མ', 'མེད', 'མིན']);
const SKT = /[ཱྀཾཿྃཥཎཊཌ]|ཀྵ|ཛྙ/u; // long vowel, reversed i, anusvara, visarga, candrabindu, retroflexes, kssa, jnya
function severity(it) {
  // tsheg / shad spacing only (ལྕུགམ→ལྕུག་མ, ༌→་): normalisation, minor
  if ((it.arm || '').replace(/[་༌\s]/g, '') === (it.base || '').replace(/[་༌\s]/g, '')) return ['minor', 'tsheg'];
  const a = syl(it.arm), b = syl(it.base);
  if (Math.max(a.length, b.length) >= 6 && Math.abs(a.length - b.length) >= 4) return ['severe', 'line'];
  const na = a.filter((x) => NEG.has(x)).length, nb = b.filter((x) => NEG.has(x)).length;
  if (na !== nb) return ['severe', 'negation'];
  if ((SKT.test(it.arm || '') || SKT.test(it.base || '')) && it.arm !== it.base) return ['severe', 'mantra'];
  return ['minor', 'minor'];
}
const pages = [];
for (const [pid, k] of Object.entries(key)) {
  const ans = parse(replies[pid] || '');
  const p = { page_id: pid, page_number: k.page_number, book_id: k.book_id, fixed_severe: 0, fixed_minor: 0, intro_severe: 0, intro_minor: 0, unclear: 0, severe_introduced: [] };
  for (const it of k.items) {
    if (it.kind !== 'span') continue;
    const s = side(it, ans[it.item]); const [sev, why] = severity(it);
    if (s === 'arm') p[`fixed_${sev}`]++;
    else if (s === 'base') { p[`intro_${sev}`]++; if (sev === 'severe') p.severe_introduced.push(`${why}: ${it.base || '∅'}→${it.arm || '∅'} (line ${it.line})`); }
    else p.unclear++;
  }
  p.fixed = p.fixed_severe + p.fixed_minor; p.introduced = p.intro_severe + p.intro_minor; p.net = p.fixed - p.introduced;
  p.pass = p.net >= 0 && p.intro_severe === 0;
  pages.push(p);
}
pages.sort((a, b) => a.page_number - b.page_number);
const sum = (f) => pages.reduce((t, p) => t + p[f], 0);
const out = { pages: pages.length, pass: pages.filter((p) => p.pass).length, fail: pages.filter((p) => !p.pass).length,
  fixed_severe: sum('fixed_severe'), fixed_minor: sum('fixed_minor'), intro_severe: sum('intro_severe'), intro_minor: sum('intro_minor'),
  pages_with_severe_introduced: pages.filter((p) => p.intro_severe).length, page_rows: pages };
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
const { page_rows, ...head } = out; console.log(JSON.stringify(head));
for (const p of pages) console.log(`p.${p.page_number}\tfixed ${p.fixed_severe}S+${p.fixed_minor}m\tintro ${p.intro_severe}S+${p.intro_minor}m\tnet ${p.net}\t${p.pass ? 'PASS' : 'FAIL'}\t${p.severe_introduced.join('; ')}`);
