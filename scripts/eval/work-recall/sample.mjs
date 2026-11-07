// PRIOR ART: scripts/eval/build-work-gold-set.mjs says in its header it cannot measure recall; this is the per-book sibling-search frame it names (#7761).
// Build the uniform-sample recall frame + positive control. Deterministic (hash order).
import fs from 'fs';
const [,, booksF, outF, N = '300', NCTRL = '100'] = process.argv;
const books = fs.readFileSync(booksF, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(b => b.id);
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const STOP = new Set('the and of de et in la le les des du der die das und von zu ad cum per pro sive seu vel liber libri libro book books opera omnia tomus tome vol volume part pars teil band edition editio nova new item quae qui quod est sunt una ex ab an on to with for a by im zum zur del della di il lo los las el en y ou au aux sur traite tractatus über eine ein'.split(' '));
const fold = s => (s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
function toks(t) { const s = fold(t); const out = new Set();
  for (const w of s.match(/[\p{L}]+/gu) || []) { if (/\p{Script=Han}/u.test(w)) { for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2)); } else if (w.length >= 3 && !STOP.has(w)) out.add(w); }
  return out; }
const surname = a => { const s = fold(a).replace(/\(.*?\)|\d+|ca\.?|ed\.?|editor|trans\.?/g, ' ').trim(); if (!s) return ''; const p = s.includes(',') ? s.split(',')[0] : s.split(/\s+/).filter(Boolean).pop(); return (p || '').replace(/[^\p{L}]/gu, ''); };
for (const b of books) { b._t = toks(b.display_title || b.title); b._s = b.author_id || surname(b.author); }
const df = new Map(); for (const b of books) for (const t of b._t) df.set(t, (df.get(t) || 0) + 1);
const idf = t => Math.log(books.length / (df.get(t) || 1));
const byTok = new Map(); for (const b of books) for (const t of b._t) if ((df.get(t) || 0) < 400) { if (!byTok.has(t)) byTok.set(t, []); byTok.get(t).push(b); }
const byAuth = new Map(); for (const b of books) if (b._s && b._s.length >= 3) { if (!byAuth.has(b._s)) byAuth.set(b._s, []); byAuth.get(b._s).push(b); }
const score = (a, b) => { let s = 0; for (const t of a._t) if (b._t.has(t)) s += idf(t); return s; };
function candidates(x, excludeSameWork) {
  const pool = new Map();
  const ok = b => b.id !== x.id && !(excludeSameWork && x.work_id && b.work_id === x.work_id);
  const auth = (x._s && byAuth.get(x._s)) || [];
  for (const b of auth) if (ok(b)) pool.set(b.id, { b, s: score(x, b) + 5, via: 'author' });
  for (const t of x._t) for (const b of byTok.get(t) || []) if (ok(b) && !pool.has(b.id)) pool.set(b.id, { b, s: 0, via: 'title' });
  for (const v of pool.values()) if (v.via === 'title') v.s = score(x, v.b);
  const all = [...pool.values()].filter(v => v.via === 'author' || v.s >= 6);
  const top = all.sort((p, q) => q.s - p.s).slice(0, 16);
  // same author, other language, zero title overlap: translations hide here
  const tr = all.filter(v => v.via === 'author' && v.b.language && v.b.language !== x.language && !top.includes(v)).slice(0, 6);
  return [...top, ...tr];
}
const thin = b => ({ id: b.id, title: b.display_title && b.display_title !== b.title ? `${b.title} [display: ${b.display_title}]` : b.title, author: b.author, year: b.published ?? b.year ?? null, language: b.language, pages: b.pages_count, work_id: b.work_id });
const ordered = [...books].sort((a, b) => hash('recall7761:' + a.id) - hash('recall7761:' + b.id));
const wsize = new Map(); for (const b of books) if (b.work_id) wsize.set(b.work_id, (wsize.get(b.work_id) || 0) + 1);
const frame = ordered.slice(0, +N).map(x => ({ frame: 'uniform', target: thin(x), cluster_size: wsize.get(x.work_id) || 0, candidates: candidates(x, true).map(v => ({ ...thin(v.b), via: v.via, score: +v.s.toFixed(1) })) }));
// positive control: books in multi-book clusters; can retrieval surface a KNOWN sibling?
const ctrl = ordered.filter(b => (wsize.get(b.work_id) || 0) > 1 && !/^kr:/.test(b.work_id)).slice(0, +NCTRL);
let found = 0; for (const x of ctrl) if (candidates(x, false).some(v => v.b.work_id === x.work_id)) found++;
fs.writeFileSync(outF, frame.map(f => JSON.stringify(f)).join('\n') + '\n');
const noCand = frame.filter(f => !f.candidates.length).length;
console.log(JSON.stringify({ frame: frame.length, frame_with_no_candidates: noCand, singleton_targets: frame.filter(f => f.cluster_size === 1).length, mean_candidates: +(frame.reduce((s, f) => s + f.candidates.length, 0) / frame.length).toFixed(1), positive_control: `${found}/${ctrl.length} known siblings retrieved` }));
