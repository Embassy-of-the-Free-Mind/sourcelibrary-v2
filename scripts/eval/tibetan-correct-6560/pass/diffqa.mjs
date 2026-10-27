#!/usr/bin/env node
// PRIOR ART: rescore.mjs (severity per JUDGED span, after an audit) and leafcheck.mjs audit-req (judges every changed
// span of a SAMPLE of pages). Derek, 2026-10-27 05:10Z (#6740): QA everything written by diffing it against the draft,
// accepting low-risk spans from the text alone and sending only risky spans to the image. This classifies the spans and
// merges the judge's verdicts back, span by span; the judging itself is leafcheck.mjs audit-req --pages --spans.
/**
 *   spans  --list=L.jsonl --dict=SYL.json --out=S.jsonl   L rows {page_id, book_id, page_number, draft, next}
 *          One row per changed span (syllable hunk) with class LOW or RISKY and why. Rules, from the note:
 *          LOW   = tsheg/merge only (ཆེནཔོ→ཆེན་པོ); a particle swapped within its own class (ཀྱི/གྱི/གི…); a one-letter fix
 *                  to a dictionary word (the new syllable is common in the Derge e-text, the old one rare or absent).
 *          RISKY = everything else, and always: > 8 syllables or a line's worth added/removed, a negation (མ མི མེད མིན)
 *                  added/removed, a number or ordinal, a mantra (Sanskrit marks/letters).
 *   merge  --list=L.jsonl --spans=S.jsonl --key=K.json --replies=R.jsonl --out=M.jsonl
 *          Per page: every RISKY span the leaf does not clearly show as the correction (draft, other, unclear, no
 *          answer) goes back to the draft's syllables; LOW spans and confirmed spans stay. Rows {page_id, text, reverted}.
 */
import fs from 'node:fs';
import { diffSyllables } from '../../../lib/tibetan-yatags-guard.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const NEG = new Set(['མ', 'མི', 'མེད', 'མིན']);
const NUM = new Set(['གཅིག', 'ཅིག', 'གཉིས', 'གསུམ', 'བཞི', 'ལྔ', 'དྲུག', 'བདུན', 'བརྒྱད', 'དགུ', 'བཅུ', 'ཉི', 'ཤུ', 'སུམ', 'ཞེ', 'དྲུག', 'བདུན', 'གྱ', 'གོ', 'བརྒྱ', 'སྟོང', 'ཁྲི', 'འབུམ', 'ས་ཡ', 'བྱེ', 'ཕྲག', 'ཉིས', 'ཉེར', 'སོ', 'རེ', 'དོན', 'ཏོན', 'བདུན་ཅུ', 'དགུ་བཅུ']);
const SKT = /[ཱྀཾཿྃཥཎཊཌ]|ཀྵ|ཛྙ/u;
const PCLASS = [['ཀྱི', 'གྱི', 'གི', 'འི', 'ཡི'], ['ཀྱིས', 'གྱིས', 'གིས', 'ཡིས'], ['ཏེ', 'སྟེ', 'དེ'], ['ཏོ', 'དོ', 'སྟོ'], ['པ', 'བ'], ['པོ', 'བོ'], ['ཀྱང', 'ཡང', 'འང'], ['ཏུ', 'དུ', 'སུ', 'རུ'], ['ཅིང', 'ཞིང', 'ཤིང'], ['ཅིག', 'ཞིག', 'ཤིག']];
const sameClass = (a, b) => PCLASS.some((c) => c.includes(a) && c.includes(b));
function edit1(a, b) { // one code point inserted, deleted or replaced
  const x = [...a], y = [...b]; if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return x.length - i - j <= 1 && y.length - i - j <= 1;
}
export function classify(a, b, dict) {
  const A = a.join('་'), Bs = b.join('་');
  if (A.replace(/་/g, '') === Bs.replace(/་/g, '')) return ['LOW', 'tsheg'];
  if (Math.max(a.length, b.length) > 8 || Math.abs(a.length - b.length) >= 4) return ['RISKY', 'line-size'];
  if (a.filter((s) => NEG.has(s)).length !== b.filter((s) => NEG.has(s)).length) return ['RISKY', 'negation'];
  if ([...a, ...b].some((s) => NUM.has(s))) return ['RISKY', 'number'];
  if (SKT.test(A) || SKT.test(Bs)) return ['RISKY', 'mantra'];
  if (a.length === b.length && a.length > 0) {
    if (a.every((s, i) => s === b[i] || sameClass(s, b[i]))) return ['LOW', 'particle-class'];
    if (a.every((s, i) => s === b[i] || (edit1(s, b[i]) && (dict[b[i]] || 0) >= 20 && (dict[s] || 0) * 20 <= (dict[b[i]] || 0)))) return ['LOW', 'typo-to-word'];
  }
  return ['RISKY', a.length && b.length ? 'substitution' : (a.length ? 'dropped' : 'added')];
}
/** The correction with the listed hunks put back to the draft's text. */
export function revertHunks(draft, next, d, idx) {
  const D = draft.normalize('NFC'), N = next.normalize('NFC');
  const edits = [];
  for (const h of d.hunks.map((h, k) => ({ ...h, k })).filter((h) => idx.has(h.k))) {
    const aTxt = h.a.length ? D.slice(d.A[h.a[0]].start, d.A[h.a.at(-1)].end) : '';
    if (h.b.length) edits.push([d.B[h.b[0]].start, d.B[h.b.at(-1)].end, aTxt]);
    else { // insertion point: after the B syllable aligned before this hunk
      const pi = d.pairs.findIndex(([i]) => i === h.a[0]);
      let pos = 0; for (let t = pi - 1; t >= 0; t--) if (d.pairs[t][1] !== null) { pos = d.B[d.pairs[t][1]].end; break; }
      edits.push([pos, pos, (pos ? '་' : '') + aTxt]);
    }
  }
  let out = N; for (const [s, e, t] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, s) + t + out.slice(e);
  return out;
}
const CMD = process.argv[2];
if (CMD === 'spans') {
  const dict = JSON.parse(fs.readFileSync(arg('dict'), 'utf8'));
  const out = [];
  for (const r of readJsonl(arg('list'))) {
    const d = diffSyllables(r.draft, r.next);
    d.hunks.forEach((h, k) => {
      const a = h.a.map((i) => d.A[i].syl), b = h.b.map((j) => d.B[j].syl);
      const [cls, why] = classify(a, b, dict);
      out.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, k, base: a.join('་'), arm: b.join('་'), cls, why });
    });
  }
  fs.writeFileSync(arg('out'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const by = {}; for (const s of out) by[`${s.cls}:${s.why}`] = (by[`${s.cls}:${s.why}`] || 0) + 1;
  console.log(JSON.stringify({ spans: out.length, pages: new Set(out.map((s) => s.page_id)).size, risky_pages: new Set(out.filter((s) => s.cls === 'RISKY').map((s) => s.page_id)).size, by }));
} else if (CMD === 'merge') {
  const list = new Map(readJsonl(arg('list')).map((r) => [r.page_id, r]));
  const key = JSON.parse(fs.readFileSync(arg('key'), 'utf8'));
  const rep = new Map(readJsonl(arg('replies')).filter((r) => r.text).map((r) => [r.uid, r.text]));
  const parse = (t) => { const m = String(t).match(/<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)/); const o = {}; for (let l of (m ? m[1] : String(t)).split('\n')) { l = l.trim().replace(/,$/, ''); if (l.startsWith('{')) try { const j = JSON.parse(l); o[+j.item] = j; } catch { /* */ } } return o; };
  const side = (it, a) => { const x = String(a?.answer || '').trim().toUpperCase(); return x === 'A' || x === 'B' ? ((x === 'A') === (it.A_is === 'arm') ? 'arm' : 'base') : (x ? x.toLowerCase() : 'none'); };
  const rows = []; const t = { pages: 0, risky_judged: 0, kept: 0, reverted: 0, by_side: {}, ctl: 0, ctl_right: 0, no_reply: 0 };
  for (const [pid, k] of Object.entries(key)) {
    const r = list.get(pid); if (!r) continue;
    if (!rep.has(pid)) { t.no_reply++; continue; }
    const ans = parse(rep.get(pid)); const idx = new Set(); const why = [];
    for (const it of k.items) {
      const s = side(it, ans[it.item]);
      if (it.kind === 'control') { t.ctl++; if (s === 'base') t.ctl_right++; continue; }
      t.risky_judged++; t.by_side[s] = (t.by_side[s] || 0) + 1;
      if (s === 'arm') { t.kept++; continue; }
      idx.add(it.hunk); t.reverted++; why.push(`${it.arm || '∅'}→${it.base || '∅'} (${s}, line ${it.line})`);
    }
    t.pages++;
    if (idx.size) { const d = diffSyllables(r.draft, r.next); rows.push({ page_id: pid, book_id: r.book_id, page_number: r.page_number, next_hash_from: r.next, text: revertHunks(r.draft, r.next, d, idx), reverted: why }); }
  }
  fs.writeFileSync(arg('out'), rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
  console.log(JSON.stringify({ ...t, pages_changed: rows.length }));
} else if (CMD) { console.error('usage: diffqa.mjs spans|merge (see the header)'); process.exit(2); }
