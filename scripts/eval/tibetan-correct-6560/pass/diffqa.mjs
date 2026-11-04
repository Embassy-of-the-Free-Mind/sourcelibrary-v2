#!/usr/bin/env node
// PRIOR ART: rescore.mjs (severity per JUDGED span, after an audit) and leafcheck.mjs audit-req (judges every changed
// span of a SAMPLE of pages). Derek, 2026-10-27 05:10Z (#6740): QA everything written by diffing it against the draft,
// accepting low-risk spans from the text alone and sending only risky spans to the image. This classifies the spans and
// merges the judge's verdicts back, span by span; the judging itself is leafcheck.mjs audit-req --pages --spans.
/**
 *   list   [--drafts=D.jsonl] --run=cli-ocr-<id> --out=L.jsonl   (needs --env-file; #7263 wave 3)
 *          L for one apply run: every page that run wrote with a change, the draft from D (apply-volume.sh keeps the
 *          drafts as derge-drafts.jsonl before the write) or, without D, from the run's page_revisions rows (the prior
 *          text writePageText kept), and `next` as stored now. A page rewritten since is left out.
 *   restore --pages=IDS.json --from-run=cli-ocr-<id> --run=diffqa-6740-<name> --why="..." [--apply]   (needs --env-file)
 *          Put whole pages back to the text --from-run replaced (its page_revisions row), compare-and-set: only a page
 *          still holding exactly what that run wrote. For an audited page that introduced a severe error (#6740 rule).
 *   spans  --list=L.jsonl --dict=SYL.json --out=S.jsonl   L rows {page_id, book_id, page_number, draft, next}
 *          One row per changed span (syllable hunk) with class LOW or RISKY and why. Rules, from the note:
 *          LOW   = tsheg/merge only (ཆེནཔོ→ཆེན་པོ); a particle swapped within its own class (ཀྱི/གྱི/གི…); a one-letter fix
 *                  to a dictionary word (the new syllable is common in the Derge e-text, the old one rare or absent).
 *          RISKY = everything else, and always: > 8 syllables or a line's worth added/removed, a negation (མ མི མེད མིན)
 *                  added/removed, a number or ordinal, a mantra (Sanskrit marks/letters).
 *   merge  --list=L.jsonl --spans=S.jsonl --key=K.json --replies=R.jsonl --out=M.jsonl
 *          Per page: every RISKY span the leaf does not clearly show as the correction (draft, other, unclear, no
 *          answer) goes back to the draft's syllables; LOW spans and confirmed spans stay. Rows {page_id, text, reverted}.
 *   write  --merge=M.jsonl --run=diffqa-6740-<name> [--apply]   (needs --env-file)
 *          Each merged page through writePageText, compare-and-set on the correction it was merged from (a page changed
 *          since is skipped), the whole prior ocr kept in page_revisions under the run id (revert-run.mjs undoes it);
 *          ocr.diffqa records the spans put back; translation_stale (lane diffqa-6740) where English exists.
 */
import fs from 'node:fs';
import { diffSyllables } from '../../../lib/tibetan-yatags-guard.mjs';
import { contentHash } from '../../../lib/write-provenance.mjs';

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
/**
 * The correction with the listed hunks put back to the draft's text. Offsets are NFC (syllableTokens normalises), so a
 * correction that is not NFC is refused rather than silently renormalised. Removing an added span also removes one
 * adjacent tsheg (else prev་་next); a span re-inserted before the first syllable gets a trailing tsheg.
 */
export function revertHunks(draft, next, d, idx) {
  if (next !== next.normalize('NFC')) throw new Error('revertHunks: correction is not NFC');
  const D = draft.normalize('NFC'), N = next;
  const SEP = /[\u0F0B\u0F0C]/u;
  const edits = [];
  for (const h of d.hunks.map((h, k) => ({ ...h, k })).filter((h) => idx.has(h.k))) {
    const aTxt = h.a.length ? D.slice(d.A[h.a[0]].start, d.A[h.a.at(-1)].end) : '';
    if (h.b.length) {
      let s0 = d.B[h.b[0]].start, e0 = d.B[h.b.at(-1)].end;
      if (!aTxt) { if (SEP.test(N[e0] || '')) e0++; else if (SEP.test(N[s0 - 1] || '')) s0--; }
      edits.push([s0, e0, aTxt]);
    } else { // insertion point: after the B syllable aligned before this hunk
      const pi = d.pairs.findIndex(([i]) => i === h.a[0]);
      let pj = null; for (let t = pi - 1; t >= 0; t--) if (d.pairs[t][1] !== null) { pj = d.pairs[t][1]; break; }
      if (pj === null) { const at = d.B[0]?.start ?? 0; edits.push([at, at, `${aTxt}་`]); } else { const pos = d.B[pj].end; edits.push([pos, pos, `་${aTxt}`]); }
    }
  }
  let out = N; for (const [s, e, t] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, s) + t + out.slice(e);
  return out;
}
const CMD = process.argv[2];
if (CMD === 'list') {
  const { MongoClient } = await import('mongodb');
  const RUN = arg('run'); if (!/^cli-ocr-/.test(RUN || '')) { console.error('--run=cli-ocr-<id> is required'); process.exit(2); }
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const drafts = arg('drafts') ? new Map(readJsonl(arg('drafts')).map((r) => [r.key, r.text]))
    : new Map((await c.db('bookstore').collection('page_revisions').find({ run_id: RUN, field: 'ocr', aborted: { $exists: false } }, { projection: { page_id: 1, data: 1 } }).toArray()).map((r) => [r.page_id, r.data]));
  const ps = await c.db('bookstore').collection('pages').find({ id: { $in: [...drafts.keys()] }, 'ocr.engine.run.job_id': RUN },
    { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
  await c.close();
  const rows = ps.filter((p) => p.ocr.data !== drafts.get(p.id)).sort((a, b) => a.page_number - b.page_number)
    .map((p) => ({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, draft: drafts.get(p.id), next: p.ocr.data }));
  fs.writeFileSync(arg('out'), rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
  console.log(JSON.stringify({ run: RUN, drafts: drafts.size, written_by_run: ps.length, changed: rows.length }));
} else if (CMD === 'restore') {
  const { MongoClient } = await import('mongodb');
  const { writePageText, textHash, priorFieldFromRevision } = await import('../../../lib/page-text-writer.mjs');
  const APPLY = process.argv.includes('--apply'); const RUN = arg('run'), FROM = arg('from-run'), WHY = arg('why');
  if (!/^diffqa-6740-/.test(RUN || '') || !/^cli-ocr-/.test(FROM || '') || !WHY) { console.error('--run=diffqa-6740-<name> --from-run=cli-ocr-<id> --why=... are required'); process.exit(2); }
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const t = { pages: 0, restored: 0, changed_since: 0, no_revision: 0 };
  for (const id of JSON.parse(fs.readFileSync(arg('pages'), 'utf8'))) {
    t.pages++;
    const rev = await db.collection('page_revisions').findOne({ page_id: id, run_id: FROM, field: 'ocr', aborted: { $exists: false } });
    if (!rev) { t.no_revision++; continue; }
    const page = await db.collection('pages').findOne({ id }, { projection: { id: 1, ocr: 1 } });
    if (textHash(page.ocr) !== rev.next_hash) { t.changed_since++; continue; }
    if (!APPLY) continue;
    const w = await writePageText(db, id, 'ocr', { ...priorFieldFromRevision(rev), updated_at: new Date(), restored: { from_run: FROM, run: RUN, at: new Date(), why: WHY } },
      { by: 'diffqa.mjs restore', reason: `#6740 rolling audit: ${WHY}; page put back to the text ${FROM} replaced`, run_id: RUN, expect_prior_hash: textHash(page.ocr), verbatim: true });
    if (w.status === 'written') t.restored++; else t.changed_since++;
  }
  await c.close();
  console.log(JSON.stringify({ apply: APPLY, run: RUN, ...t }));
} else if (CMD === 'spans') {
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
  const noReply = [];
  const rows = []; const t = { pages: 0, risky_judged: 0, kept: 0, reverted: 0, by_side: {}, ctl: 0, ctl_right: 0, no_reply: 0 };
  for (const [pid, k] of Object.entries(key)) {
    const r = list.get(pid); if (!r) continue;
    if (!rep.has(pid)) { t.no_reply++; noReply.push(pid); continue; }
    const ans = parse(rep.get(pid)); const idx = new Set(); const why = [];
    for (const it of k.items) {
      const s = side(it, ans[it.item]);
      if (it.kind === 'control') { t.ctl++; if (s === 'base') t.ctl_right++; continue; }
      t.risky_judged++; t.by_side[s] = (t.by_side[s] || 0) + 1;
      if (s === 'arm') { t.kept++; continue; }
      idx.add(it.hunk); t.reverted++; why.push(`${it.arm || '∅'}→${it.base || '∅'} (${s}, line ${it.line})`);
    }
    t.pages++;
    if (idx.size) {
      if (r.next !== r.next.normalize('NFC')) { t.skipped_not_nfc = (t.skipped_not_nfc || 0) + 1; continue; }
      const d = diffSyllables(r.draft, r.next); rows.push({ page_id: pid, book_id: r.book_id, page_number: r.page_number, next_hash_from: r.next, text: revertHunks(r.draft, r.next, d, idx), reverted: why });
    }
  }
  fs.writeFileSync(arg('out'), rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
  // A page the judge never answered is NOT done: its risky spans stay on the correction until it is judged. It is listed
  // for re-judging (<out>.no-reply.json) rather than reverted wholesale: a quota stop would otherwise revert every
  // unjudged page, good fixes included (#6740 review, finding 1).
  fs.writeFileSync(`${arg('out')}.no-reply.json`, JSON.stringify(noReply));
  console.log(JSON.stringify({ ...t, pages_changed: rows.length }));
} else if (CMD === 'write') {
  const { MongoClient } = await import('mongodb');
  const { writePageText, textHash } = await import('../../../lib/page-text-writer.mjs');
  const { markTranslationsStale } = await import('../../../lib/syriac-kraken-lane.mjs');
  const APPLY = process.argv.includes('--apply'); const RUN = arg('run');
  if (!/^diffqa-6740-/.test(RUN || '')) { console.error('--run=diffqa-6740-<name> is required'); process.exit(2); }
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const t = { rows: 0, written: 0, changed_since: 0, stale_marked: 0 }; const done = [];
  for (const r of readJsonl(arg('merge'))) {
    t.rows++;
    const page = await db.collection('pages').findOne({ id: r.page_id }, { projection: { id: 1, ocr: 1 } });
    if (!page || contentHash(page.ocr?.data || '') !== contentHash(r.next_hash_from)) { t.changed_since++; continue; }
    if (!APPLY) continue;
    const next = { ...page.ocr, data: r.text, content_hash: contentHash(r.text), updated_at: new Date(),
      diffqa: { run: RUN, reverted_spans: r.reverted, from_hash: contentHash(r.next_hash_from), issue: 6740 } };
    const w = await writePageText(db, r.page_id, 'ocr', next, { by: 'diffqa.mjs (sealed Opus leaf check of risky spans)', reason: `#6740 diff-QA: ${r.reverted.length} span(s) the leaf does not show as corrected put back to the Yigdzin draft`, run_id: RUN, expect_prior_hash: textHash(page.ocr), verbatim: true });
    if (w.status === 'written') { t.written++; done.push({ id: r.page_id, text: r.text }); } else t.changed_since++;
  }
  if (APPLY && done.length) t.stale_marked = await markTranslationsStale(db, done, new Date(), 'diffqa-6740');
  console.log(JSON.stringify({ apply: APPLY, run: RUN, ...t })); await c.close();
} else if (CMD) { console.error('usage: diffqa.mjs spans|merge|write (see the header)'); process.exit(2); }
