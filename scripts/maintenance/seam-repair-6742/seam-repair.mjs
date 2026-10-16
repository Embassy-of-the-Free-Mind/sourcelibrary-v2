#!/usr/bin/env node
// PRIOR ART: scripts/eval/seams-6742/ (#6742, PR #6746) — joinSignals (census.mjs), the Opus label+repair PROMPT and
// validRepair (opus-reference.mjs), the blind both-orders JUDGE and applyRepair (judge-repairs.mjs) and the sealed
// claudeCall/pool (lib.mjs) are imported unchanged. That code measured seams on excerpts and never wrote; this draws the
// high-precision tranche, packs joins ~10 per call (lesson #6388), maps an excerpt repair back onto the stored page,
// and writes through translate-core's writePageTranslation, like scripts/batch/cli-translate.mjs `apply` does.
/**
 * seam-repair — the $0 seam repair pilot (#6742). Opus via the Claude CLI on the subscription only.
 *
 *   N=node --env-file=/root/sourcelibrary/.env.production.local; S=scripts/maintenance/seam-repair-6742/seam-repair.mjs
 *   $N $S candidates --frame=F.jsonl.gz --out=DIR [--n=500]     one tranche join per live book, Mongo reads only
 *   $N $S repair     --out=DIR --model=opus|sonnet [--limit=100] [--pack=10] [--conc=4]
 *   $N $S verify     --out=DIR --arm=opus|sonnet [--pack=10] [--conc=4]   blind Opus, both orders
 *   $N $S imagecheck --out=DIR [--n=30]                           the same verifier, with the two page images
 *   $N $S apply      --out=DIR [--apply]                          dry run unless --apply; writes manifest.jsonl
 *   $N $S report     --out=DIR
 *   $N $S undo       --out=DIR [--apply]                          restore every written page from its revision row
 *
 * Tranche (#6742 write-up §3, 29/30 precise vs Opus): catchword echo, dup8, carried, ocrNext, bracketed bridge, on a
 * prose join whose two pages are machine-translated (not human, placeholder, withheld or same-language) in a live,
 * unheld book. A repair is written only if (1) its old spans are verbatim at the excerpt edges (validRepair), (2) each
 * changed side touches at most 3 edge sentences, (3) the span maps onto the STORED text exactly once and the stored
 * text's prose afterwards equals the excerpt edit, (4) the blind verifier prefers it in BOTH orders, and (5) the stored
 * translation has not changed since the read. Undo: page_revisions rows with reason `seam-repair-6742` (manifest.jsonl).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';
import { joinSignals } from '../../eval/seams-6742/census.mjs';
import { PROMPT, LABELS, validRepair } from '../../eval/seams-6742/opus-reference.mjs';
import { JUDGE, applyRepair } from '../../eval/seams-6742/judge-repairs.mjs';
import { claudeCall, extractJson, pool, shuffle, sentences } from '../../eval/seams-6742/lib.mjs';
import { PLACEHOLDER, HUMAN, SAME_LANGUAGE } from '../../eval/seams-6742/break-frame.mjs';
import { sourceProse, translationProse, TR_WRAPPERS } from '../../lib/block-drift.mjs';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { spawn } from 'node:child_process';
import os from 'os';
import { writePageTranslation, syncBookTranslationCounters, assessTranslationHealth, hidesPageInMeta } from '../../lib/translate-core.mjs';
import { refusableReasoningLeak } from '../../lib/page-integrity.mjs';
import { geminiEngine, engineNameForCli, translationInput, notRecorded, codeVersion, host } from '../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../lib/sweep-log.mjs';
import { CLI } from '../../eval/seams-6742/lib.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');
export const TAG = 'seam-repair-6742';
export const TRANCHE = ['catchwordEcho', 'dup8', 'carried', 'ocrNext', 'bracketBridge'];
const EDGE = 1500;
const tail = (t) => t.length > EDGE ? '…' + t.slice(-EDGE) : t;
const head = (t) => t.length > EDGE ? t.slice(0, EDGE) + '…' : t;
export const sha = (t) => crypto.createHash('sha256').update(t || '').digest('hex').slice(0, 16);

async function mongo() { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return { client: c, db: c.db('bookstore') }; }

const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1,
  'translation.edited_by': 1, 'translation.edited_at': 1, translation_withheld: 1, 'translation.health_blocked': 1 };
/** A page this job may touch: machine translation, not human / placeholder / withheld / same-language (break-frame.mjs). */
export function eligible(r) {
  const t = r?.translation;
  if (!t || typeof t.data !== 'string' || !t.data.trim()) return false;
  if (r.translation_withheld) return false;
  const src = Array.isArray(t.source) ? t.source : t.source == null ? [] : [t.source];
  if (src.some(s => PLACEHOLDER.has(s) || HUMAN.has(s) || s === SAME_LANGUAGE)) return false;
  return !(t.edited_by || t.edited_at);
}
const asPage = (r) => ({ id: r.id, p: r.page_number, type: r.page_type, ocr: r.ocr?.data || '', tr: r.translation.data });
export const bookLive = (b) => !!b && b.visible === true && b.pages_count > 0 && !b.pipeline_auto?.hold;

// ── candidates ───────────────────────────────────────────────────────────────
async function candidates(framePath, out, n, seed) {
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'candidates.jsonl');
  const prior = readJsonl(file);
  const seen = new Set(prior.map(r => r.book));
  let got = prior.filter(r => r.join).length;
  const frame = zlib.gunzipSync(fs.readFileSync(framePath)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)).filter(b => b.breaks > 0);
  const order = shuffle(frame, makeRng(seed));
  const rand = makeRng(seed + 1);
  const { client, db } = await mongo();
  let scanned = 0;
  for (const b of order) {
    if (got >= n) break;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const book = await db.collection('books').findOne({ id: b.id }, { projection: { _id: 0, id: 1, visible: 1, pages_count: 1, pipeline_auto: 1, title: 1 } });
    if (!bookLive(book)) { append(file, { book: b.id, join: null, why: 'not-live-or-held' }); continue; }
    // A window of up to 24 eligible pages from a random start; scan its joins in order, keep the first tranche hit.
    const nums = b.pages.map(x => x[0]).sort((x, y) => x - y);
    const s = Math.floor(rand() * Math.max(1, nums.length - 24));
    const win = nums.slice(s, s + 24);
    const want = [...new Set(win.flatMap(p => [p - 1, p, p + 1]))];
    const rows = await db.collection('pages').find({ book_id: b.id, page_number: { $in: want } }, { projection: PROJ }).toArray();
    const by = new Map(rows.map(r => [r.page_number, r]));
    scanned++;
    let hit = null, joinsSeen = 0;
    for (const p of win) {
      const ra = by.get(p), rb = by.get(p + 1);
      if (!eligible(ra) || !eligible(rb)) continue;
      joinsSeen++;
      const A = asPage(ra), B = asPage(rb);
      const r0 = by.get(p - 1), r1 = by.get(p + 2);
      const sig = joinSignals({ A0: eligible(r0) ? asPage(r0) : null, A, B, B1: eligible(r1) ? asPage(r1) : null });
      if (sig.skipped || sig.nonProse) continue;
      const fired = TRANCHE.filter(k => sig[k]);
      if (!fired.length) continue;
      hit = { book: b.id, title: book.title, p, idA: A.id, idB: B.id, pB: p + 1, fired, script: sig.script, lang: b.lang, modelA: ra.translation.model, modelB: rb.translation.model,
        hashA: sha(A.tr), hashB: sha(B.tr), srcTailA: tail(sourceProse(A.ocr)), srcHeadB: head(sourceProse(B.ocr)), enTailA: tail(translationProse(A.tr)), enHeadB: head(translationProse(B.tr)) };
      hit.id = sha(`${hit.book}:${hit.p}`).slice(0, 12);
      break;
    }
    append(file, hit ? { join: true, joinsSeen, ...hit } : { book: b.id, join: null, why: 'no-tranche-join', joinsSeen });
    if (hit) got++;
    if (scanned % 50 === 0) process.stderr.write(`${scanned} books scanned, ${got} joins\n`);
  }
  await client.close();
  console.log(JSON.stringify({ scanned, joins: got }));
}

// ── repair (packed) ──────────────────────────────────────────────────────────
export const PACK_HEAD = `Below are several page turns, each headed "##### JOIN <id>". Apply the instructions below to EACH join
independently (the joins come from different books). Instead of one JSON object, reply with ONE JSON array holding one
object per join, in order, each with an added "id" field equal to the join id, and nothing else.

`;
export const joinText = (it) => `##### JOIN ${it.id}\n=== SOURCE N (end) ===\n${it.srcTailA}\n\n=== SOURCE N+1 (start) ===\n${it.srcHeadB}\n\n=== ENGLISH N (end) ===\n${it.enTailA}\n\n=== ENGLISH N+1 (start) ===\n${it.enHeadB}\n`;
export const packs = (xs, k) => { const o = []; for (let i = 0; i < xs.length; i += k) o.push(xs.slice(i, i + k)); return o; };
export const usageOf = (r) => r.usage ? { in: r.usage.input, out: r.usage.output, cache: r.usage.cache_read, list_usd: r.usage.list_cost_usd } : null;

async function repair(out, model, limit, pack, conc) {
  const items = readJsonl(path.join(out, 'candidates.jsonl')).filter(r => r.join).slice(0, limit);
  const file = path.join(out, `repair-${model}.jsonl`), calls = path.join(out, `calls.jsonl`);
  const done = new Set(readJsonl(file).map(x => x.id));
  const todo = items.filter(x => !done.has(x.id));
  console.log(`${items.length} joins, ${todo.length} to repair with ${model}, ${Math.ceil(todo.length / pack)} calls`);
  const res = await pool(packs(todo, pack), conc, async (pk) => {
    const r = await claudeCall(`${PACK_HEAD}${PROMPT}\n\n${pk.map(joinText).join('\n')}`, model);
    if (r.cls === 'usage_limit') return { cls: r.cls };
    append(calls, { stage: 'repair', arm: model, n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r), at: new Date().toISOString() });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const byId = new Map((Array.isArray(arr) ? arr : []).map(x => [x?.id, x]));
    let ok = 0;
    for (const it of pk) {
      const j = byId.get(it.id);
      const parsed = j && LABELS.includes(j.label) ? j : null;
      if (parsed) ok++;
      // an unparsed reply is recorded as such and not retried (one try per join; the report counts it)
      append(file, { id: it.id, parsed: !!parsed, ...(parsed || {}), repairCheck: parsed ? validRepair(it, parsed.repair) : null, model: r.model, cls: r.cls || undefined });
    }
    return { ok: ok > 0, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}

// ── placement: an excerpt repair, checked and mapped onto the stored page ──
const words = (t) => String(t).trim().split(/\s+/).filter(Boolean);
/** Why a repair may not be written, or null. Checks the edge-sentence bound on the excerpt. */
export function edgeRefusal(it, rep) {
  if (!rep) return 'no-repair';
  const vc = validRepair(it, rep);
  if (!vc.ok) return vc.tailOk ? 'head-old-not-at-edge' : 'tail-old-not-at-edge';
  const tOld = (rep.tail_old || '').trim(), hOld = (rep.head_old || '').trim();
  if (!tOld && !hOld) return 'empty-repair';
  for (const [o, nw] of [[tOld, rep.tail_new || ''], [hOld, rep.head_new || '']]) {
    if (!o) { if (String(nw).trim()) return 'new-text-without-old-span'; continue; }
    if (sentences(o).length > 3) return 'touches-more-than-3-sentences';
    if (words(o).length > 120 || words(nw).length > words(o).length + 60) return 'edit-too-large';
  }
  return applyRepair(it, rep) ? null : 'repair-changes-nothing';
}

/** Map an excerpt-side replacement onto the stored raw translation. Returns the new raw text, or {refuse}. A span that
 *  is not verbatim in the stored text (it crosses a <term>, a heading mark, a centring arrow, a <meta> block) falls back
 *  to mapProjected. */
export function mapOntoRaw(raw, side, oldSpan, newSpan) {
  const exact = mapExact(raw, side, oldSpan, newSpan);
  if (!exact.refuse || !/not-in-stored-text/.test(exact.refuse)) return exact;
  const p = mapProjected(raw, side, oldSpan, newSpan);
  return p.refuse ? { refuse: `${exact.refuse}+${p.refuse}` } : p;
}

function mapExact(raw, side, oldSpan, newSpan) {
  let o = oldSpan.trim(), n = String(newSpan ?? ''), kept = [];
  if (!o) return { text: raw };
  // The excerpt is prose with the tags stripped but their contents kept ("Latin", a running head), and the model copies
  // that residue unchanged into both spans. Lines the edit leaves identical on the far side are dropped before the
  // stored text is searched; the edit itself is unchanged.
  if (raw.indexOf(o) < 0) {
    const ol = o.split('\n'), nl = n.trim().split('\n');
    if (side === 'head') while (ol.length > 1 && nl.length > 1 && ol[0].trim() === nl[0].trim()) { kept.push(ol.shift()); nl.shift(); }
    else while (ol.length > 1 && nl.length > 1 && ol[ol.length - 1].trim() === nl[nl.length - 1].trim()) { kept.unshift(ol.pop()); nl.pop(); }
    o = ol.join('\n').trim(); n = nl.join('\n');
  }
  const first = raw.indexOf(o), last = raw.lastIndexOf(o);
  if (first < 0) return { refuse: `${side}-span-not-in-stored-text` };
  if (first !== last) return { refuse: `${side}-span-not-unique-in-stored-text` };
  const text = raw.slice(0, first) + (side === 'tail' ? n.trimEnd() : n.trimStart()) + raw.slice(first + o.length);
  // The span must sit at the stored page's edge: between it and the end (tail) or start (head) of the stored text there
  // may be only tagged elements (<header>, <page-num>, <note>…), bare tags, whitespace, and the residue lines kept above.
  const outside = side === 'tail' ? raw.slice(first + o.length) : raw.slice(0, first);
  const bare = outside.replace(/<([a-zA-Z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<\/?[a-zA-Z][^>]*>|->|<-/g, ' ');
  const sq = (t) => t.replace(/[\s*_#>`~|-]+/g, '');
  if (sq(bare) !== sq(kept.join(''))) return { refuse: `${side}-span-not-at-stored-edge` };
  return { text };
}

// The excerpt is translationProse(raw): editorial blocks gone, tags gone, markdown marks gone, whitespace collapsed.
// project() applies the same removals to any string and keeps, for every surviving character, its index in that string;
// the marks are dropped outright (not turned into spaces) on BOTH sides, so "->allow.<-" and "- allow." both read "allow.".
const WRAPPER_BLOCK = new RegExp(`<(${TR_WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
const MARKS = /[-*_#>`~|<]/;
export function project(str) {
  const s = String(str), skip = new Uint8Array(s.length);
  for (const m of s.matchAll(WRAPPER_BLOCK)) skip.fill(1, m.index, m.index + m[0].length);
  for (const m of s.matchAll(/<\/?[a-zA-Z][^>]*>/g)) skip.fill(1, m.index, m.index + m[0].length);
  let text = '', idx = [], ws = false;
  for (let i = 0; i < s.length; i++) {
    if (skip[i] || MARKS.test(s[i])) { if (skip[i]) ws = true; continue; }
    if (/\s/.test(s[i])) { ws = true; continue; }
    if (ws && text) { text += ' '; idx.push(i - 1); }
    ws = false; text += s[i]; idx.push(i);
  }
  return { text, idx };
}
/**
 * Replace oldSpan by newSpan in the stored text through the projection: find the projected old span (exactly once,
 * at the projected edge), then rewrite only the stretch where old and new differ. That stretch must hold no tag and
 * no markdown mark, so a <term>, a <gloss> or an emphasis around words the edit does not touch is kept as stored.
 */
export function mapProjected(raw, side, oldSpan, newSpan) {
  const R = project(raw), O = project(String(oldSpan).trim()), N = project(String(newSpan ?? '').trim());
  if (!O.text) return { refuse: `${side}-projected-span-empty` };
  const at = R.text.indexOf(O.text);
  if (at < 0) return { refuse: `${side}-projected-span-not-found` };
  if (R.text.indexOf(O.text, at + 1) >= 0) return { refuse: `${side}-projected-span-not-unique` };
  if (side === 'tail' ? R.text.slice(at + O.text.length).trim() : R.text.slice(0, at).trim()) return { refuse: `${side}-projected-span-not-at-edge` };
  let cp = 0; while (cp < O.text.length && cp < N.text.length && O.text[cp] === N.text[cp]) cp++;
  let cs = 0; while (cs < O.text.length - cp && cs < N.text.length - cp && O.text[O.text.length - 1 - cs] === N.text[N.text.length - 1 - cs]) cs++;
  // the differing stretch, in the stored text and in the new span's own characters
  const oA = at + cp, oB = at + O.text.length - cs;                 // [oA, oB) in R.text
  const rawA = oA < at + O.text.length ? R.idx[oA] : R.idx[oB - 1] + 1;
  const rawB = oB > oA ? R.idx[oB - 1] + 1 : rawA;
  const nA = cp, nB = N.text.length - cs;
  const ins = nB > nA ? String(newSpan).trim().slice(N.idx[nA], N.idx[nB - 1] + 1) : '';
  let a = rawA, b = rawB;
  if (oB === oA) { a = b = oA > at ? R.idx[oA - 1] + 1 : R.idx[oA]; }  // a pure insertion goes after the last kept character
  const cut = raw.slice(a, b);
  if (/[<>*_#`~|]/.test(cut) || /<\/?[a-zA-Z]|[*_#`]/.test(ins)) return { refuse: `${side}-projected-edit-touches-markup` };
  const text = raw.slice(0, a) + ins + raw.slice(b);
  // the projected result must equal the projected excerpt edit
  const want = R.text.slice(0, at) + N.text + R.text.slice(at + O.text.length);
  if (project(text).text.replace(/\s+/g, ' ').trim() !== want.replace(/\s+/g, ' ').trim()) return { refuse: `${side}-projected-result-mismatch` };
  return { text, projected: true };
}

// ── verify (blind Opus, both orders, packed) ─────────────────────────────────
const vblock = (label, v) => `--- VERSION ${label}: English, end of page N ---\n${v.enTailA}\n--- VERSION ${label}: English, start of page N+1 ---\n${v.enHeadB}`;
export const pairText = (p) => `##### PAIR ${p.pair}\n--- SOURCE, end of page N ---\n${p.srcTailA}\n--- SOURCE, start of page N+1 ---\n${p.srcHeadB}\n${vblock('P', p.P)}\n${vblock('Q', p.Q)}`;
/** Joins of one arm that pass every placement check on the excerpt, with their repaired excerpts. */
export function placed(out, arm) {
  const cands = new Map(readJsonl(path.join(out, 'candidates.jsonl')).filter(r => r.join).map(r => [r.id, r]));
  return readJsonl(path.join(out, `repair-${arm}.jsonl`)).map(x => {
    const it = cands.get(x.id);
    if (!x.parsed) return { id: x.id, it, x, refuse: 'reply-not-parsed' };
    if (x.label === 'ok') return { id: x.id, it, x, refuse: 'labelled-ok' };
    const why = edgeRefusal(it, x.repair);
    return { id: x.id, it, x, refuse: why, fixed: why ? null : applyRepair(it, x.repair) };
  });
}
export async function verify(out, arm, pack, conc) {
  const file = path.join(out, `verify-${arm}.jsonl`), calls = path.join(out, 'calls.jsonl');
  const done = new Set(readJsonl(file).map(v => v.pair));
  const ok = placed(out, arm).filter(r => !r.refuse);
  const rand = makeRng(arm.length * 977);
  const mk = (r, order) => { const cur = { enTailA: r.it.enTailA, enHeadB: r.it.enHeadB };
    return { pair: `${arm}-${r.id}-${order}`, id: r.id, order, srcTailA: r.it.srcTailA, srcHeadB: r.it.srcHeadB, P: order === 'cur-first' ? cur : r.fixed, Q: order === 'cur-first' ? r.fixed : cur }; };
  // The two orders of a join go to different calls: all cur-first pairs are packed first, then all rep-first pairs.
  const aa = shuffle(ok, rand).slice(0, Math.min(10, ok.length)).flatMap(r => ['aa-1', 'aa-2'].map(o => ({ pair: `${arm}-${r.id}-${o}`, id: r.id, order: o, srcTailA: r.it.srcTailA, srcHeadB: r.it.srcHeadB, P: { enTailA: r.it.enTailA, enHeadB: r.it.enHeadB }, Q: { enTailA: r.it.enTailA, enHeadB: r.it.enHeadB } })));
  const first = shuffle([...ok.map(r => mk(r, 'cur-first')), ...aa.filter(p => p.order === 'aa-1')], rand);
  const second = shuffle([...ok.map(r => mk(r, 'rep-first')), ...aa.filter(p => p.order === 'aa-2')], rand);
  const todo = [...packs(first.filter(p => !done.has(p.pair)), pack), ...packs(second.filter(p => !done.has(p.pair)), pack)];
  console.log(`${arm}: ${ok.length} placed repairs, ${todo.length} verifier calls to make`);
  const res = await pool(todo, conc, async (pk) => {
    const r = await claudeCall(`${JUDGE}\n\n${pk.map(pairText).join('\n\n')}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    append(calls, { stage: 'verify', arm, n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r), at: new Date().toISOString() });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const byPair = new Map((Array.isArray(arr) ? arr : []).map(v => [v?.pair, v]));
    let n = 0;
    for (const p of pk) { const v = byPair.get(p.pair); if (v && ['P', 'Q', 'tie'].includes(v.better)) n++;
      append(file, { pair: p.pair, id: p.id, order: p.order, better: v?.better ?? null, P_defect: v?.P_defect, Q_defect: v?.Q_defect, note: v?.note, model: r.model }); }
    return { ok: n > 0, cls: r.cls };
  });
  console.log(JSON.stringify(res));
}
/** Per join: did the verifier prefer the repair in both orders? */
export function verdicts(out, arm) {
  const by = {};
  for (const v of readJsonl(path.join(out, `verify-${arm}.jsonl`))) (by[v.id] ||= {})[v.order] = v;
  const res = {};
  for (const [id, o] of Object.entries(by)) {
    const a = o['cur-first'], b = o['rep-first'];
    if (!a || !b) continue;
    const prefers = a.better === 'Q' && b.better === 'P';
    const worse = a.better === 'P' && b.better === 'Q';
    res[id] = { prefers, worse, a: a.better, b: b.better, notes: [a.note, b.note], repairedStillDefect: [a.Q_defect, b.P_defect], aa: o['aa-1'] && o['aa-2'] ? [o['aa-1'].better, o['aa-2'].better] : null };
  }
  return res;
}

// ── image check: the same blind verifier with both page images to read ───────
function claudeWithImages(prompt, dir) {
  return new Promise((resolve) => {
    const env = { ...process.env }; for (const k of Object.keys(env)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete env[k];
    const t0 = Date.now();
    const child = spawn(CLI, ['-p', '--model', 'opus', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], env });
    let o = '', e = '';
    child.stdout.on('data', d => { o += d; }); child.stderr.on('data', d => { e += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60e3);
    child.on('close', (code) => { clearTimeout(timer); let j = {}; try { j = JSON.parse(o); } catch {}
      resolve({ text: String(j.result ?? ''), model: Object.keys(j.modelUsage || {})[0] || null, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens, cache_read: j.usage.cache_read_input_tokens, list_cost_usd: j.total_cost_usd } : null, cls: j.is_error || code !== 0 ? `exit_${code}` : null, err: e.slice(-300), secs: (Date.now() - t0) / 1000 }); });
  });
}
const IMG_NOTE = `The two page images are in the current directory: page-N.jpg (page N) and page-N1.jpg (page N+1). Read BOTH images
with the Read tool first and use them as the source of truth for what the source says at the turn (the OCR text below may
contain errors). Then judge as instructed.\n\n`;
async function imagecheck(out, arm, n) {
  const file = path.join(out, 'imagecheck.jsonl'), calls = path.join(out, 'calls.jsonl');
  const done = new Set(readJsonl(file).map(v => v.pair));
  const v = verdicts(out, arm);
  const acc = placed(out, arm).filter(r => !r.refuse && v[r.id]?.prefers);
  const pick = shuffle(acc, makeRng(30)).slice(0, n);
  const { client, db } = await mongo();
  const tasks = pick.flatMap(r => ['cur-first', 'rep-first'].map(order => ({ r, order, pair: `img-${r.id}-${order}` }))).filter(t => !done.has(t.pair));
  await pool(tasks, 4, async ({ r, order, pair }) => {
      const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'seam-img-'));
      for (const [pid, name] of [[r.it.idA, 'page-N.jpg'], [r.it.idB, 'page-N1.jpg']]) {
        const pg = await db.collection('pages').findOne({ id: pid }, { projection: { display_photo: 1, archived_photo: 1, photo: 1 } });
        for (const u of [pg?.display_photo, pg?.archived_photo, pg?.photo].filter(Boolean)) {
          const resp = await fetch(u).catch(() => null);
          if (resp?.ok) { fs.writeFileSync(path.join(dir, name), Buffer.from(await resp.arrayBuffer())); break; }
        }
      }
      const haveImgs = ['page-N.jpg', 'page-N1.jpg'].every(f => fs.existsSync(path.join(dir, f)));
      const cur = { enTailA: r.it.enTailA, enHeadB: r.it.enHeadB };
      const p = { pair, srcTailA: r.it.srcTailA, srcHeadB: r.it.srcHeadB, P: order === 'cur-first' ? cur : r.fixed, Q: order === 'cur-first' ? r.fixed : cur };
      const res = haveImgs ? await claudeWithImages(`${IMG_NOTE}${JUDGE}\n\n${pairText(p)}\n`, dir) : { cls: 'no-images', text: '' };
      fs.rmSync(dir, { recursive: true, force: true });
      if (haveImgs) append(calls, { stage: 'imagecheck', arm, n: 1, model: res.model, cls: res.cls, secs: Math.round(res.secs), usage: usageOf(res), at: new Date().toISOString() });
      const arr = res.cls ? null : extractJson(res.text, '[') || [extractJson(res.text)];
      const vv = (arr || []).find(x => x?.better);
      append(file, { pair, id: r.id, order, better: vv?.better ?? null, note: vv?.note, cls: res.cls, model: res.model });
      process.stderr.write(`${pair} ${vv?.better ?? res.cls}\n`);
      return { ok: !!vv, cls: /limit/i.test(res.text || '') ? 'usage_limit' : res.cls };
  });
  await client.close();
}

// ── apply: through writePageTranslation, one write per changed page ──────────
async function applyStage(out, arms, doApply) {
  const written = new Set(readJsonl(path.join(out, 'manifest.jsonl')).filter(m => m.written).map(m => m.join));
  const accepted = [];
  for (const arm of arms) { const v = verdicts(out, arm); for (const r of placed(out, arm)) if (!r.refuse && v[r.id]?.prefers && !accepted.some(a => a.id === r.id)) accepted.push({ ...r, arm, verdict: v[r.id] }); }
  console.log(`${accepted.length} accepted repairs (${arms.join('+')}), ${written.size} already written`);
  const { client, db } = await mongo();
  const tally = await writeRepairs(db, accepted.filter(r => !written.has(r.id)), { out, doApply });
  await client.close();
  console.log(JSON.stringify(tally));
}

/**
 * Write accepted repairs ({ id, it, x, arm, verdict }) through writePageTranslation, one write per changed page, with
 * the manifest / refusal / sweep-log rows `undo` reads. `cli`/`model` name the repairer in the engine block; `reason`
 * says how the repair was accepted. Exits the process on a door refusal or a failed read-back (as the pilot did).
 */
export async function writeRepairs(db, accepted, { out, doApply, cli = 'claude', model = 'claude-opus-5-5', promptName = 'seam-repair-6742 label+minimal edge repair (opus-reference PROMPT, packed)',
  sentHash = sha(PACK_HEAD + PROMPT), accepted: how = 'verified by a blind Opus pairwise judge in both orders' } = {}) {
  const manifest = path.join(out, 'manifest.jsonl'), refusals = path.join(out, 'apply-refusals.jsonl');
  const runId = `${TAG}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const bin = cli === 'claude' ? CLI : cli;
  const cliVersion = String(cli !== 'claude' || fs.existsSync(CLI) ? (await new Promise(res => { const c = spawn(bin, ['--version']); let o = ''; c.stdout.on('data', d => { o += d; }); c.on('error', () => res('unknown')); c.on('close', () => res(o.trim().split(' ')[0] || 'unknown')); })) : 'unknown');
  const cv = await codeVersion();
  const tally = { run: runId, apply: doApply, written: 0, pagesWritten: 0, refused: {} };
  const refuse = (r, why, extra = {}) => { tally.refused[why] = (tally.refused[why] || 0) + 1; append(refusals, { join: r.id, book: r.it.book, why, ...extra, at: new Date().toISOString() }); };
  const books = {};
  for (const r of accepted) {
    const { it, x } = r;
    const book = await db.collection('books').findOne({ id: it.book }, { projection: { _id: 0, id: 1, visible: 1, pages_count: 1, pipeline_auto: 1, language: 1 } });
    if (!bookLive(book)) { refuse(r, 'book-not-live-or-held-now'); continue; }
    const pages = await db.collection('pages').find({ id: { $in: [it.idA, it.idB] } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, translation_withheld: 1 } }).toArray();
    const A = pages.find(p => p.id === it.idA), B = pages.find(p => p.id === it.idB);
    if (!eligible(A) || !eligible(B)) { refuse(r, 'page-no-longer-eligible'); continue; }
    if (sha(A.translation.data) !== it.hashA || sha(B.translation.data) !== it.hashB) { refuse(r, 'translation-changed-since-read'); continue; }
    const mA = mapOntoRaw(A.translation.data, 'tail', x.repair.tail_old || '', x.repair.tail_new || '');
    const mB = mapOntoRaw(B.translation.data, 'head', x.repair.head_old || '', x.repair.head_new || '');
    if (mA.refuse || mB.refuse) { refuse(r, mA.refuse || mB.refuse); continue; }
    const plan = [[A, mA.text, 'tail', x.repair.tail_old, x.repair.tail_new], [B, mB.text, 'head', x.repair.head_old, x.repair.head_new]].filter(([pg, t]) => t !== pg.translation.data);
    // Pre-check the door's refusals on both pages so a join is never half-written.
    const pre = plan.map(([pg, t]) => { const h = assessTranslationHealth(pg.ocr?.data, t, { lang: book.language });
      return !h.healthy ? `health:${h.reason}` : hidesPageInMeta(t) ? 'hidden-meta' : refusableReasoningLeak(t) ? 'reasoning-leak' : null; }).find(Boolean);
    if (pre) { refuse(r, `door-precheck-${pre}`); continue; }
    if (!doApply) { tally.written++; tally.pagesWritten += plan.length; continue; }
    for (const [pg, text, side, oldSpan, newSpan] of plan) {
      const t = pg.translation;
      const engine = geminiEngine({
        name: engineNameForCli(cli), call_site: TAG, api: 'cli', cli: { name: cli, version: cliVersion }, model: x.model || model,
        prompt: { id: TAG, name: promptName, version: '1', hash: sha(PROMPT), sent_hash: sentHash },
        generationConfig: notRecorded(`${cli} -p exposes no temperature, output cap or thinking setting; the model id names the tier`),
        run: { job_id: runId, code_version: cv, host: host(), at: new Date(), reason: `${TAG}: minimal ${side}-edge seam repair of the ${t.model} translation, ${how}`, edited_from: { model: t.model, content_hash: t.content_hash ?? null, prompt_version: t.prompt_version ?? null } },
        input: translationInput({ ocrText: pg.ocr?.data ?? '', ocrUpdatedAt: pg.ocr?.updated_at }),
      });
      // The page keeps its translation's prompt identity and model: the body is that model's text, edited at one edge.
      const promptRef = { id: t.prompt_id, name: t.prompt_name, version: t.prompt_version, content_hash: t.prompt_hash };
      const res = await writePageTranslation(db, { page: pg, book, text, promptRef, model: t.model, jobId: runId, note: TAG, refuseUnhealthy: true, engine });
      if (!res.written) { refuse(r, res.protected ? 'door-human-edited' : `door-refused-${res.reason}`, { page: pg.id }); append(manifest, { join: r.id, page: pg.id, written: false, why: res.reason || 'protected' }); console.error(`STOP: the door refused ${pg.id}: ${res.reason || 'protected'}`); process.exit(3); }
      const after = await db.collection('pages').findOne({ id: pg.id }, { projection: { 'translation.content_hash': 1, 'translation.data': 1 } });
      const rev = await db.collection('page_revisions').findOne({ page_id: pg.id, field: 'translation', reason: TAG, data: t.data }, { projection: { id: 1, created_at: 1 } });
      const hashChanged = after?.translation?.content_hash && after.translation.content_hash !== t.content_hash && after.translation.data !== t.data;
      append(manifest, { join: r.id, arm: r.arm, book: it.book, page: pg.id, page_number: pg.page_number, side, written: true, revision_id: rev?.id ?? null, old_hash: t.content_hash ?? null, new_hash: after?.translation?.content_hash,
        old_span: oldSpan, new_span: newSpan, label: x.label, severity: x.severity, verdict: r.verdict, url: `https://sourcelibrary.org/book/${it.book}/page/${pg.id}`, run: runId, at: new Date().toISOString() });
      if (!rev || !hashChanged) { console.error(`STOP: after writing ${pg.id}: revision ${rev ? 'ok' : 'MISSING'}, hash ${hashChanged ? 'changed' : 'NOT changed'}`); process.exit(4); }
      await recordSweepAction(db, { sweep: TAG, book_id: it.book, action: 'seam-edge-repaired', detail: { page_id: pg.id, page_number: pg.page_number, side, join: r.id, revision_id: rev.id, run: runId } });
      (books[it.book] ||= []).push(pg.page_number);
      tally.pagesWritten++;
    }
    tally.written++;
  }
  for (const [bookId, nums] of Object.entries(books)) {
    await syncBookTranslationCounters(db, bookId);
    await db.collection('book_events').insertOne({ book_id: bookId, type: 'translation_seam_repaired', at: new Date(), source: TAG, details: { run: runId, api: 'cli', pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: TAG } });
  }
  return tally;
}

// ── report: every number in the #6742 comment, from the files ───────────────
function report(out) {
  const cands = readJsonl(path.join(out, 'candidates.jsonl'));
  const joins = cands.filter(r => r.join);
  const count = (xs, f) => xs.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o; }, {});
  const arms = {};
  const first100 = new Set(joins.slice(0, 100).map(j => j.id));
  for (const arm of ['opus', 'sonnet']) {
    if (!fs.existsSync(path.join(out, `repair-${arm}.jsonl`))) continue;
    const pl = placed(out, arm), v = verdicts(out, arm);
    const on100 = pl.filter(r => first100.has(r.id));
    const ok = (r) => !r.refuse && v[r.id]?.prefers;
    arms[arm] = { tried: pl.length, labels: count(pl, r => r.x.label || 'unparsed'), placement: count(pl, r => r.refuse || 'placed'),
      verified: pl.filter(ok).length, verifierSplit: pl.filter(r => !r.refuse && v[r.id] && !v[r.id].prefers && !v[r.id].worse).length, verifierWorse: pl.filter(r => !r.refuse && v[r.id]?.worse).length,
      first100: { placed: on100.filter(r => !r.refuse).length, verified: on100.filter(ok).length },
      aaPairs: Object.values(v).filter(x => x.aa).map(x => x.aa.join('/')) };
  }
  const calls = readJsonl(path.join(out, 'calls.jsonl'));
  const byStage = {};
  for (const c of calls) { const k = `${c.stage}:${c.arm}`; const b = (byStage[k] ||= { calls: 0, items: 0, failed: 0, outTokens: 0, listUsd: 0, secs: 0, first: c.at, last: c.at });
    b.calls++; b.items += c.n; if (c.cls) b.failed++; b.outTokens += c.usage?.out || 0; b.listUsd += c.usage?.list_usd || 0; b.secs += c.secs || 0; if (c.at < b.first) b.first = c.at; if (c.at > b.last) b.last = c.at; }
  for (const b of Object.values(byStage)) b.listUsd = +b.listUsd.toFixed(2);
  const img = readJsonl(path.join(out, 'imagecheck.jsonl'));
  const ib = {}; for (const x of img) (ib[x.id] ||= {})[x.order] = x.better;
  const imgJoins = Object.entries(ib).filter(([, o]) => o['cur-first'] && o['rep-first']);
  const manifest = readJsonl(path.join(out, 'manifest.jsonl'));
  const refusals = readJsonl(path.join(out, 'apply-refusals.jsonl'));
  const rep = {
    candidates: { booksScanned: cands.length, joins: joins.length, noTrancheJoin: cands.filter(r => r.why === 'no-tranche-join').length, notLive: cands.filter(r => r.why === 'not-live-or-held').length, fired: count(joins.flatMap(j => j.fired), x => x) },
    arms, calls: byStage,
    imagecheck: { joins: imgJoins.length, prefersRepairBothOrders: imgJoins.filter(([, o]) => o['cur-first'] === 'Q' && o['rep-first'] === 'P').length, worseBothOrders: imgJoins.filter(([, o]) => o['cur-first'] === 'P' && o['rep-first'] === 'Q').length, detail: Object.fromEntries(imgJoins) },
    write: { joinsWritten: new Set(manifest.filter(m => m.written).map(m => m.join)).size, pagesWritten: manifest.filter(m => m.written).length, revisionRows: manifest.filter(m => m.written && m.revision_id).length, refused: count(refusals, r => r.why) },
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1).slice(0, 6000));
}

// ── undo: put every written page back to its page_revisions pre-image (dry run unless --apply) ────────────────
async function undo(out, doApply) {
  const man = readJsonl(path.join(out, 'manifest.jsonl')).filter(m => m.written && m.revision_id);
  const { client, db } = await mongo();
  const tally = { restored: 0, skipped: {} };
  for (const m of man) {
    const rev = await db.collection('page_revisions').findOne({ id: m.revision_id, page_id: m.page });
    const pg = await db.collection('pages').findOne({ id: m.page }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 } });
    const why = !rev ? 'revision-missing' : !pg ? 'page-missing' : pg.translation?.content_hash !== m.new_hash ? 'changed-since-repair' : null;
    if (why) { tally.skipped[why] = (tally.skipped[why] || 0) + 1; continue; }
    if (doApply) {
      const t = pg.translation, book = await db.collection('books').findOne({ id: pg.book_id });
      const res = await writePageTranslation(db, { page: pg, book, text: rev.data, promptRef: { id: t.prompt_id, name: t.prompt_name, version: t.prompt_version, content_hash: t.prompt_hash }, model: rev.model || t.model,
        jobId: `${TAG}-undo`, note: `${TAG}-undo`, engine: notRecorded(`restore of the pre-${TAG} text from page_revisions ${rev.id}`) });
      if (!res.written) { tally.skipped[res.reason || 'protected'] = (tally.skipped[res.reason || 'protected'] || 0) + 1; continue; }
    }
    tally.restored++;
  }
  await client.close();
  console.log(JSON.stringify({ apply: doApply, ...tally }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const run = {
    candidates: () => candidates(arg('frame'), out, Number(arg('n', 500)), Number(arg('seed', 67420))),
    repair: () => repair(out, arg('model', 'opus'), Number(arg('limit', 1e9)), Number(arg('pack', 10)), Number(arg('conc', 4))),
    verify: () => verify(out, arg('arm', 'opus'), Number(arg('pack', 10)), Number(arg('conc', 4))),
    imagecheck: () => imagecheck(out, arg('arm', 'opus'), Number(arg('n', 30))),
    report: async () => report(out),
    undo: () => undo(out, process.argv.includes('--apply')),
    apply: () => applyStage(out, arg('arms', 'opus').split(','), process.argv.includes('--apply')),
  }[cmd];
  if (!run) { console.error('usage: see the header'); process.exit(2); }
  run().catch(e => { console.error(e); process.exit(1); });
}
