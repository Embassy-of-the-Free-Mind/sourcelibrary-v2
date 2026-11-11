// PRIOR ART: scripts/eval/seam-prevent-7118/blocks4-8399.mjs `seam` (#8407 arm C) — the measured mechanics, made a
// stage: one call per CALL boundary with seam-repair-6742/gemini-repair.mjs geminiPack (opus-reference's single-join
// label + minimal repair prompt), the excerpt windows (1,500 chars of block-drift sourceProse / translationProse), and
// placement through seam-repair.mjs edgeRefusal + mapOntoRaw. It was an eval copy over Bb's reads and had no gate.
// scripts/maintenance/seam-repair-6742/guard.mjs (the write-time SEAM_GUARD, #6742) checks EVERY join a write touches,
// with lean.mjs's tight windows and a lost-words acceptance, after the page is stored; it is a different, unmeasured-
// here mechanism and stays as it is. scripts/lib/neighbour-guard.mjs checkNeighbours (#8401) is the gate run on the result.
/**
 * The seam pass (#8399): after a run of consecutive pages is read in calls of up to 4, one agy call per page turn that
 * falls BETWEEN two calls (the turn into the run from the page before it, a turn where a block ends, a page re-read
 * alone). Each call gets the last ~1,500 characters of page N's source and English and the first of N+1's, and returns
 * a label and, for a defect, replacements for the two edge spans only. Measured on #8407's 120 blocks as arm C:
 * broken joins 26.9 → 8.8 per 100 over the reads it was given.
 *
 * Guards, each a refusal of the whole join (both sides stay as read):
 *  - placement (seam-repair.mjs edgeRefusal): the old spans are verbatim at the excerpt's edges, ≤ 3 sentences and
 *    ≤ 120 words a side, growth ≤ 60 words; mapOntoRaw puts each span on the stored text exactly once, at its edge;
 *  - SPAN_GROWTH: a replacement may not be longer than max(1.5 × its old span, old + 40) characters;
 *  - outsideUnchanged: mechanically, the edited page differs from the read only inside one stretch no longer than the
 *    old span (+ 64 for whitespace and tags), and on the edge side of it there is no prose left (the span is at the edge);
 *  - no new text in both pages: the two pages' longest shared run (neighbour-guard leakNorm) may not grow past 40 chars;
 *  - the neighbour gate (#5026/#8401, checkNeighbours) on each changed page, with the run's current English standing in
 *    for its neighbours;
 *  - the page BEFORE the run (stored English another run wrote) is edited only with `editBefore`; without it a repair
 *    that touches that page's tail is refused (`before-page-locked`) and a head-only repair still applies.
 * The write is not made here: claude-translate.mjs records each join in DIR/seam-pass.jsonl and the edited text in
 * DIR/seam/<page_id>.txt; cli-translate.mjs apply writes the accepted edits through seam-repair.mjs writeRepairs, after
 * the reads, under their own run id (seam-repair-6742-<ts>), so `seam-repair.mjs undo` reverts them alone.
 */
import { sourceProse, translationProse } from './block-drift.mjs';
import { sharedRun, leakNorm, checkNeighbours } from './neighbour-guard.mjs';

export const SEAM_PASS_MODEL = 'gemini-3.8-flash-low';
export const SEAM_EDGE = 1500;
export const SPAN_GROWTH = { share: 1.5, chars: 40 };
export const OUTSIDE_SLACK = 64;
export const SHARED_RUN_MAX = 40;

const tail = (t) => (t.length > SEAM_EDGE ? '…' + t.slice(-SEAM_EDGE) : t);
const head = (t) => (t.length > SEAM_EDGE ? t.slice(0, SEAM_EDGE) + '…' : t);

/**
 * The turns to pass in one run. `pages` in page order: { id, page_number, text, ocr, call_id } where the page before
 * the run has call_id null. A turn is passed when the two pages are consecutive and were not read in the same call.
 */
export function callBoundaries(pages) {
  const out = [];
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i], b = pages[i + 1];
    if (b.page_number !== a.page_number + 1 || !a.text || !b.text || !a.ocr || !b.ocr) continue;
    if (a.call_id && a.call_id === b.call_id) continue;
    out.push(i);
  }
  return out;
}

/** The single-join item opus-reference's itemPrompt reads. */
export function seamItem(id, a, b, ta = a.text, tb = b.text) {
  return { id, srcTailA: tail(sourceProse(a.ocr)), srcHeadB: head(sourceProse(b.ocr)), enTailA: tail(translationProse(ta)), enHeadB: head(translationProse(tb)) };
}

/** Is a replacement span within the growth bound? */
export const withinGrowth = (oldSpan, newSpan, g = SPAN_GROWTH) => String(newSpan ?? '').trim().length <= Math.max(g.share * String(oldSpan ?? '').trim().length, String(oldSpan ?? '').trim().length + g.chars);

/** No prose letters outside tagged elements and bare tags. */
const noProse = (s) => !/[\p{L}\p{N}]/u.test(String(s).replace(/<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, ' '));

/**
 * The mechanical check that an edit changed nothing outside its span: the read and the edited page differ in ONE
 * stretch, no longer than the old span plus OUTSIDE_SLACK, and between that stretch and the page's edge (`tail`: its
 * end; `head`: its start) the read holds no prose. Returns null or a refusal.
 */
export function outsideUnchanged(before, after, side, oldSpan) {
  if (before === after) return null;
  let p = 0; while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0; while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const span = String(oldSpan || '').trim();
  const changed = before.length - p - s;
  if (!span || changed > span.length + OUTSIDE_SLACK) return `${side}-edit-wider-than-span`;
  // Verbatim span (mapOntoRaw's exact map): the changed stretch lies inside it, and the span sits at the edge.
  const at = side === 'tail' ? before.lastIndexOf(span) : before.indexOf(span);
  if (at >= 0) {
    if (p < at || before.length - s > at + span.length) return `${side}-edit-outside-span`;
    return noProse(side === 'tail' ? before.slice(at + span.length) : before.slice(0, at)) ? null : `${side}-span-not-at-edge`;
  }
  // Projected span (it crossed a tag): between the stretch and the edge, only words of the span itself.
  const spanWords = new Set(span.match(/[\p{L}\p{N}]+/gu) || []);
  const edge = side === 'tail' ? before.slice(before.length - s) : before.slice(0, p);
  const bare = edge.replace(/<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  const words = bare.match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length > spanWords.size || words.some((w) => !spanWords.has(w))) return `${side}-edit-not-at-edge`;
  return null;
}

/**
 * Place one join's repair on the two pages' texts. `rep` is the model's {tail_old, tail_new, head_old, head_new}.
 * Returns { L, R, refused, changed }; on a refusal L and R are the inputs.
 */
export async function placeSeamRepair(it, rep, rawL, rawR, { editLeft = true, edgeRefusal, mapOntoRaw }) {
  const keep = (refused) => ({ L: rawL, R: rawR, refused, changed: false });
  if (!rep) return keep('no-repair');
  const r0 = edgeRefusal(it, rep);
  if (r0) return keep(r0);
  const touchesTail = !!String(rep.tail_old || '').trim() && String(rep.tail_old).trim() !== String(rep.tail_new ?? '').trim();
  if (!editLeft && touchesTail) return keep('before-page-locked');
  for (const [o, n, side] of [[rep.tail_old, rep.tail_new, 'tail'], [rep.head_old, rep.head_new, 'head']]) if (!withinGrowth(o, n)) return keep(`${side}-span-grows-too-much`);
  const L = rep.tail_old ? mapOntoRaw(rawL, 'tail', rep.tail_old, rep.tail_new ?? '') : { text: rawL };
  const R = rep.head_old ? mapOntoRaw(rawR, 'head', rep.head_old, rep.head_new ?? '') : { text: rawR };
  if (L.refuse || R.refuse) return keep(L.refuse || R.refuse);
  const o1 = outsideUnchanged(rawL, L.text, 'tail', rep.tail_old) || outsideUnchanged(rawR, R.text, 'head', rep.head_old);
  if (o1) return keep(o1);
  const runBefore = sharedRun(leakNorm(rawR), leakNorm(rawL), 1).len, runAfter = sharedRun(leakNorm(R.text), leakNorm(L.text), 1).len;
  if (runAfter > Math.max(runBefore, SHARED_RUN_MAX)) return keep('repair-puts-text-in-both-pages');
  return { L: L.text, R: R.text, refused: null, changed: L.text !== rawL || R.text !== rawR };
}

/**
 * Run the pass over one run. `pages` as callBoundaries (index 0 may be the page before the run: `inRun: false`), each
 * with `doc` ({ id, book_id, page_number, page_type }). `call(it)` resolves { got, cls } (got: the parsed label object;
 * cls 'quota' stops the pass). Returns { texts: Map<page_id, text>, joins: [...], stopped }.
 */
export async function runSeamPass(pages, { call, db = null, editBefore = false, edgeRefusal, mapOntoRaw, tag = 'seam' }) {
  const texts = new Map(pages.map((p) => [p.id, p.text]));
  const joins = [];
  for (const i of callBoundaries(pages)) {
    const a = pages[i], b = pages[i + 1];
    const rawL = texts.get(a.id), rawR = texts.get(b.id);
    const it = seamItem(`${tag}:${a.id}|${b.id}`, a, b, rawL, rawR);
    const res = await call(it);
    if (res.cls === 'quota') return { texts, joins, stopped: 'quota' };
    const row = { left: a.id, right: b.id, left_n: a.page_number, right_n: b.page_number, left_in_run: a.inRun !== false, ok: !!res.got, cls: res.cls || null };
    if (!res.got) { joins.push(row); continue; }
    const got = res.got;
    Object.assign(row, { label: got.label, labels: got.labels, severity: got.severity ?? null, evidence: got.evidence ?? null, repair: got.label !== 'ok' ? got.repair ?? null : null });
    if (got.label === 'ok' || !got.repair) { joins.push({ ...row, refused: got.label === 'ok' ? null : 'no-repair', changed: false }); continue; }
    const editLeft = a.inRun !== false || editBefore;
    let placed = await placeSeamRepair(it, got.repair, rawL, rawR, { editLeft, edgeRefusal, mapOntoRaw });
    // the alternative a locked page before the run would have given (#8407's caveat: report S with and without it)
    if (a.inRun === false) {
      const alt = editLeft ? await placeSeamRepair(it, got.repair, rawL, rawR, { editLeft: false, edgeRefusal, mapOntoRaw }) : placed;
      row.locked = { refused: alt.refused, changed: alt.changed, right: alt.changed ? alt.R : null };
    }
    if (placed.changed && db) {
      for (const [p, t, nb] of [[a, placed.L, { [a.page_number + 1]: placed.R, [a.page_number - 1]: pages[i - 1] ? texts.get(pages[i - 1].id) : undefined }], [b, placed.R, { [b.page_number - 1]: placed.L, [b.page_number + 1]: pages[i + 2] ? texts.get(pages[i + 2].id) : undefined }]]) {
        if (t === texts.get(p.id)) continue;
        for (const k of Object.keys(nb)) if (nb[k] == null) delete nb[k];
        const v = await checkNeighbours(db, { page: p.doc, text: t, ocr: p.ocr, bookId: p.doc?.book_id, neighbours: nb });
        if (v.refuse) { placed = { L: rawL, R: rawR, refused: `neighbour-gate:${v.reason}`, changed: false }; break; }
      }
    }
    if (placed.changed) { texts.set(a.id, placed.L); texts.set(b.id, placed.R); }
    joins.push({ ...row, refused: placed.refused, changed: placed.changed, left_changed: placed.L !== rawL, right_changed: placed.R !== rawR });
  }
  return { texts, joins, stopped: null };
}

// ── the stage over a read dir (claude-translate.mjs `seam`, and `read --seam-pass=1`) ─────────────────────────────
const SEAM_PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, translation_withheld: 1 };

/**
 * Pass every run of consecutive pages read in OUT (metas with exit 0), with the page before each run when it holds an
 * eligible machine translation (seam-repair.mjs eligible). Writes OUT/seam-pass.jsonl (one row per passed turn, and a
 * `run` row when a run is done, so a re-run resumes), OUT/seam/<page_id>.txt (the page as the pass left it) and, for the
 * turn into the run, OUT/seam-locked/<page_id>.txt (the first page as it would be with the page before locked).
 * Returns { runs, joins, changed, stopped }.
 */
export async function seamStage(db, OUT, { model = SEAM_PASS_MODEL, editBefore = false, log = console.log } = {}) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { geminiPack } = await import('../maintenance/seam-repair-6742/gemini-repair.mjs');
  const { edgeRefusal, mapOntoRaw, eligible } = await import('../maintenance/seam-repair-6742/seam-repair.mjs');
  const { agyBlocked } = await import('./model-limits.mjs');
  const { LABELS } = await import('../eval/seams-6742/opus-reference.mjs');
  const file = path.join(OUT, 'seam-pass.jsonl');
  const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const doneRuns = new Set(prior.filter((r) => r.run_done).map((r) => r.run_key));
  const metas = fs.readdirSync(OUT).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')))
    .filter((m) => m.exit === 0 && !m.error_class && !m.write_guard)
    .map((m) => ({ ...m, text: (() => { try { return fs.readFileSync(path.join(OUT, `${m.page_id}.txt`), 'utf8').trim(); } catch { return ''; } })() }))
    .filter((m) => m.text.length > 5)
    .sort((a, b) => (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : a.page_number - b.page_number));
  const runs = [];
  for (const m of metas) { const r = runs[runs.length - 1], last = r?.[r.length - 1]; if (last && last.book_id === m.book_id && last.page_number + 1 === m.page_number) r.push(m); else runs.push([m]); }
  fs.mkdirSync(path.join(OUT, 'seam'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'seam-locked'), { recursive: true });
  const call = async (it) => {
    if (agyBlocked(model)) return { cls: 'quota' };
    const { byId, r } = await geminiPack([it], model);
    if (r.cls === 'quota') return { cls: 'quota' };
    const got = byId.get(it.id);
    return { got: got && LABELS.includes(got.label) ? got : null, cls: r.cls || (got ? null : 'unparsed') };
  };
  const tally = { runs: 0, joins: 0, changed: 0, stopped: null };
  for (const run of runs) {
    const key = run.map((m) => m.page_id).join(',');
    if (doneRuns.has(key)) continue;
    const docs = new Map((await db.collection('pages').find({ book_id: run[0].book_id, page_number: { $gte: run[0].page_number - 1, $lte: run[run.length - 1].page_number } }, { projection: SEAM_PROJ }).toArray()).map((p) => [p.page_number, p]));
    const pages = run.map((m) => { const d = docs.get(m.page_number); return { id: m.page_id, page_number: m.page_number, text: m.text, ocr: d?.ocr?.data || '', call_id: m.call_id || m.page_id, doc: d, inRun: true }; });
    const before = docs.get(run[0].page_number - 1);
    if (before && eligible(before) && before.ocr?.data) pages.unshift({ id: before.id, page_number: before.page_number, text: before.translation.data, ocr: before.ocr.data, call_id: null, doc: before, inRun: false });
    const res = await runSeamPass(pages, { call, db, editBefore, edgeRefusal, mapOntoRaw, tag: 'seam-8399' });
    const at = new Date().toISOString();
    for (const j of res.joins) fs.appendFileSync(file, JSON.stringify({ ...j, run_key: key, book_id: run[0].book_id, model, edit_before: editBefore, at }) + '\n');
    for (const p of pages) { const t = res.texts.get(p.id); if (t !== p.text) fs.writeFileSync(path.join(OUT, 'seam', `${p.id}.txt`), t); }
    for (const j of res.joins) if (j.locked?.changed) fs.writeFileSync(path.join(OUT, 'seam-locked', `${j.right}.txt`), j.locked.right);
    tally.runs++; tally.joins += res.joins.length; tally.changed += res.joins.filter((j) => j.changed).length;
    if (res.stopped) { tally.stopped = res.stopped; log(`seam pass: agy quota, stopped after ${tally.runs} run(s); re-run to resume`); break; }
    fs.appendFileSync(file, JSON.stringify({ run_done: true, run_key: key, joins: res.joins.length, at }) + '\n');
    log(`  seam ${run[0].book_id} p.${run[0].page_number}-${run[run.length - 1].page_number}: ${res.joins.length} turn(s), ${res.joins.filter((j) => j.changed).length} repaired${res.joins.filter((j) => j.refused && j.refused !== 'no-repair').length ? `, refused: ${res.joins.filter((j) => j.refused && j.refused !== 'no-repair').map((j) => j.refused).join(', ')}` : ''}`);
  }
  return tally;
}

/**
 * cli-translate.mjs apply's seam step: after the reads are written, each repaired turn in OUT/seam-pass.jsonl is
 * written through seam-repair.mjs writeRepairs (the door: health, neighbour gate, revision row; manifest.jsonl for
 * `undo`), one turn at a time against the STORED texts as they now are, all under ONE run id of their own. A turn whose
 * stored edges no longer hold the spans is skipped. `apply` false: a dry run.
 */
export async function applySeamPass(db, OUT, { apply = false, log = console.log } = {}) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { writeRepairs, edgeRefusal, sha } = await import('../maintenance/seam-repair-6742/seam-repair.mjs');
  const { PROMPT } = await import('../eval/seams-6742/opus-reference.mjs');
  const { MARKERS } = await import('../maintenance/seam-repair-6742/gemini-repair.mjs');
  const file = path.join(OUT, 'seam-pass.jsonl');
  if (!fs.existsSync(file)) return null;
  const joins = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((j) => !j.run_done && j.changed && !j.refused);
  const runId = `seam-pass-8399-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const tally = { run: runId, apply, turns: joins.length, written: 0, skipped: {} };
  const skip = (why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; };
  for (const j of joins) {
    const [A, B] = await Promise.all([j.left, j.right].map((id) => db.collection('pages').findOne({ id }, { projection: SEAM_PROJ })));
    if (!A?.translation?.data || !B?.translation?.data) { skip('page-not-written'); continue; }
    const it = { ...seamItem(`seam-8399:${A.id}|${B.id}`, { ocr: A.ocr?.data || '' }, { ocr: B.ocr?.data || '' }, A.translation.data, B.translation.data), book: A.book_id, idA: A.id, idB: B.id, hashA: sha(A.translation.data), hashB: sha(B.translation.data) };
    if (edgeRefusal(it, j.repair)) { skip('stored-edges-differ-from-the-read'); continue; }
    try {
      const t = await writeRepairs(db, [{ id: it.id, it, x: { repair: j.repair, model: j.model, label: j.label, severity: j.severity }, arm: 'seam-pass', verdict: null }], {
        out: OUT, doApply: apply, cli: 'agy', model: j.model, promptName: 'seam pass #8399: opus-reference single-join label + minimal edge repair (gemini-repair geminiPack)',
        sentHash: sha(PROMPT + MARKERS), accepted: 'placed by the seam pass guards at read time (#8399; span, growth, outside-unchanged, both-pages, neighbour gate)',
        allowHidden: true, throwOnStop: true, callSite: 'scripts/lib/seam-pass.mjs', runId });
      tally.written += t.written;
      for (const [k, v] of Object.entries(t.refused)) tally.skipped[k] = (tally.skipped[k] || 0) + v;
    } catch (e) { skip(`stopped: ${String(e.message || e).slice(0, 80)}`); break; }
  }
  log(`seam pass: ${apply ? 'wrote' : 'would write'} ${tally.written} of ${tally.turns} repaired turn(s)${apply ? ` (run ${runId}; undo: seam-repair.mjs undo --out=${OUT})` : ''}; skipped ${JSON.stringify(tally.skipped)}`);
  return tally;
}
