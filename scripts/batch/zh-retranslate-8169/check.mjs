#!/usr/bin/env node
// PRIOR ART: scripts/batch/zh-print-correct-7263/check.mjs (PR #8077) — the shape (draw written pages from the ledger, read
// what each serves NOW, judge blind, write result.json only when complete). Its judge is router-confirm/confirm.mjs, which
// judges TRANSCRIPTIONS (plan arms of kind correct/read) and cannot judge an English; so this uses the instrument #8134
// measured this frame with: scripts/eval/route-judge-6740/judge.mjs judgePrompt / opusCall / parseVerdict, plus #8134's
// two questions (scripts/eval/zh-translation-paired-5274/run.mjs prompt), restated. The meter: lane-judge-sampler.mjs
// claudeMeter / paceBlock (fail closed: this box's climits reading can be missing, and claudeBlocked then says "go").
/**
 * #8169: the lane's stop check (scripts/eval/methods/lane-paired-retranslation-check.md).
 *   node --env-file=... check.mjs --dir=RUN_DIR --out=CHECK_DIR [--n=30] [--seed=8169] [--since=LEDGER_SEQ] [--record]
 * Exit 0 with CHECK_DIR/result.json (pass true|false). Exit 3: no check ran (meter unreadable, quota, or verdicts
 * missing after retries); the runner treats that as a stop, never as a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { judgePrompt, opusCall, parseVerdict } from '../../eval/route-judge-6740/judge.mjs';
import { claudeMeter, paceBlock } from '../../eval/lane-judge-sampler.mjs';
import * as limits from '../../lib/model-limits.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
export const METHOD = 'lane-paired-retranslation-check';
export const NEW_MODEL = 'gemini-3.8-flash-low';
export const OLD_MODEL = 'gemini-3-flash-preview';
export const RULE = { min_accept: 10, max_worse: 3 };
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, w = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [+(c - w).toFixed(3), +(c + w).toFixed(3)]; };
export const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
const major = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text' || d.severity === 'misleads');
/** Is the new English worse than the old on this page (the lane's rule)? */
export const worse = (n, s) => (s.accept && !n.accept) || Number(n.fidelity) <= Number(s.fidelity) - 2 || (wt(n) && !wt(s));

/** judge.mjs's translation prompt with #8134's two added questions (run.mjs prompt, restated). */
export function prompt(it, imageRef) {
  const base = judgePrompt(it, imageRef);
  const add = `- source_misread: does the TRANSCRIPTION itself misread the image somewhere in a way that changes the sense (a wrong character that changes a word, a dropped or added line, another leaf's text)? true or false; "misread_quote": a short span of the transcription where it does, else "".
- for each defect also give "origin": "translation" when the translator made it, or "transcription" when the English faithfully renders a transcription error.

Tags such as`;
  return base.replace('\n\nTags such as', `\n${add}`)
    .replace(/Answer with one JSON object only: .*$/s, 'Answer with one JSON object only: {"accept": bool, "fidelity": n, "defects": [{"class": "T8", "quote": "...", "severity": "misleads", "origin": "translation", "what": "a few words"}], "source_misread": bool, "misread_quote": "...", "reader_note": "..."}');
}

async function plan(db, { DIR, OUT, N, SEED, SINCE }) {
  const last = new Map(); for (const r of jsonl(path.join(DIR, 'ledger.jsonl'))) last.set(r.page_id, r);
  const written = [...last.values()].filter((r) => r.state === 'written').sort((a, b) => a.page_id.localeCompare(b.page_id));
  const rnd = makeRng(SEED);
  const shuffled = written.map((r) => ({ r, k: rnd() })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const order = [...shuffled.filter((r) => (r.seq ?? 0) >= SINCE), ...shuffled.filter((r) => (r.seq ?? 0) < SINCE)];
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(written.map((r) => r.book_id))] } }, { projection: { id: 1, title: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));
  const seen = new Set(), sel = [], skipped = {};
  const bump = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  for (const r of order) {
    if (sel.length >= N) break;
    if (seen.has(r.book_id)) continue;
    const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } });
    if (!p?.translation?.data || p.translation.model !== NEW_MODEL || (r.new_hash && contentHash(p.translation.data) !== r.new_hash)) { bump('rewritten since'); continue; }
    const old = await db.collection('page_revisions').find({ page_id: p.id, field: 'translation', model: OLD_MODEL }).sort({ created_at: -1 }).limit(1).next();
    if (!old?.data) { bump('no old English in page_revisions'); continue; }
    const image = getPageSource(p)?.replace(/\s+/g, '');
    if (!image) { bump('no image'); continue; }
    const b = books.get(p.book_id);
    seen.add(p.book_id);
    sel.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, kind: r.kind, title: b?.title ?? '', lang: b?.language || 'Chinese', image_url: image, ocr: p.ocr.data, new_text: p.translation.data, old_text: old.data, old_revision: old.id ?? String(old._id) });
  }
  // Items: N (new) and S (old) per page; 2 wrong-page controls (a page's new English against another book's page).
  const items = [];
  for (const s of sel) for (const arm of ['N', 'S']) items.push({ id: `j${h(`${SEED}:${arm}:${s.page_id}`).slice(0, 12)}`, arm, kind: 'item', page_id: s.page_id, task: 'translation', lang: s.lang, source: s.ocr, text: arm === 'N' ? s.new_text : s.old_text, image_url: s.image_url });
  const ctl = sel.slice(0, 4);
  if (ctl.length >= 4) for (const [a, b] of [[ctl[0], ctl[1]], [ctl[2], ctl[3]]]) items.push({ id: `j${h(`${SEED}:W:${a.page_id}:${b.page_id}`).slice(0, 12)}`, arm: 'W', kind: 'wrong_page', page_id: b.page_id, text_of: a.page_id, task: 'translation', lang: b.lang, source: b.ocr, text: a.new_text, image_url: b.image_url });
  items.sort((x, y) => h(`order:${x.id}`).localeCompare(h(`order:${y.id}`)));
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify({ at: new Date().toISOString(), seed: SEED, since: SINCE, written: written.length, skipped, selected: sel.map(({ ocr, new_text, old_text, ...x }) => ({ ...x, ocr_hash: contentHash(ocr), new_hash: contentHash(new_text), old_hash: contentHash(old_text) })) }, null, 1));
  fs.writeFileSync(path.join(OUT, 'packet.json'), JSON.stringify({ items }, null, 1));
  return sel.length;
}

async function judge(OUT) {
  const file = path.join(OUT, 'verdicts.jsonl');
  const prev = jsonl(file), done = new Set(prev.filter((r) => r.verdict).map((r) => r.id));
  const tries = new Map(); for (const r of prev) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = JSON.parse(fs.readFileSync(path.join(OUT, 'packet.json'), 'utf8')).items.filter((it) => !done.has(it.id) && (tries.get(it.id) ?? 0) < 3);
  console.log(`check: ${todo.length} texts to judge`);
  let stop = null, i = 0;
  const one = async (it) => {
    const m = await claudeMeter(limits);
    fs.appendFileSync(path.join(OUT, 'meter.jsonl'), JSON.stringify(m ?? { unreadable: true, at: new Date().toISOString() }) + '\n');
    const b = paceBlock(m, { weeklyMax: 85, sessionMax: 95 }) || (limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 })?.reason ?? null);
    if (b) { stop = b; return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zhrt-check-'));
    try {
      const res = await fetch(it.image_url);
      if (!res.ok) { fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
      const t0 = Date.now();
      const r = await opusCall(prompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = 'quota reply'; return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity}` : `unparsed ${r.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  await Promise.all(Array.from({ length: 2 }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  return stop;
}

export function score(OUT, N) {
  const P = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(OUT, 'packet.json'), 'utf8')).items;
  const vs = new Map(jsonl(path.join(OUT, 'verdicts.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const by = (pid, arm) => vs.get(items.find((it) => it.page_id === pid && it.arm === arm && it.kind === 'item')?.id);
  const rows = P.selected.map((s) => ({ ...s, n: by(s.page_id, 'N'), s: by(s.page_id, 'S') }));
  const ctl = items.filter((it) => it.kind === 'wrong_page').map((it) => ({ ...it, v: vs.get(it.id) }));
  if (rows.length < N || rows.some((r) => !r.n || !r.s) || ctl.length < 2 || ctl.some((c) => !c.v)) return null;
  const acc = rows.filter((r) => r.n.accept).length, accOld = rows.filter((r) => r.s.accept).length;
  const wrs = rows.filter((r) => worse(r.n, r.s)), bet = rows.filter((r) => worse(r.s, r.n));
  const ctlFail = ctl.filter((c) => c.v.accept || Number(c.v.fidelity) >= 4);
  const kinds = {}; for (const r of rows) { const k = (kinds[r.kind] ??= { n: 0, new_accepted: 0, old_accepted: 0 }); k.n++; if (r.n.accept) k.new_accepted++; if (r.s.accept) k.old_accepted++; }
  const why = [acc < RULE.min_accept && `new accepted ${acc}/${rows.length} < ${RULE.min_accept}`, wrs.length > RULE.max_worse && `new worse than old on ${wrs.length}/${rows.length} > ${RULE.max_worse}`, ctlFail.length && `${ctlFail.length} wrong-page control(s) accepted or fidelity >= 4`].filter(Boolean);
  const res = { at: new Date().toISOString(), n: rows.length, books: new Set(rows.map((r) => r.book_id)).size, new_accepted: acc, new_wilson: wilson(acc, rows.length), old_accepted: accOld, old_wilson: wilson(accOld, rows.length),
    new_wrong_text: rows.filter((r) => wt(r.n)).length, old_wrong_text: rows.filter((r) => wt(r.s)).length, worse: wrs.length, better: bet.length, by_kind: kinds,
    controls: { n: ctl.length, failed: ctlFail.length }, rule: RULE, pass: why.length === 0, stop_reasons: why, written_at_check: P.written,
    rows: rows.map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, kind: r.kind, title: r.title, new: { accept: r.n.accept, fidelity: r.n.fidelity, wrong: wt(r.n), note: r.n.reader_note }, old: { accept: r.s.accept, fidelity: r.s.fidelity, wrong: wt(r.s) }, worse: worse(r.n, r.s) })) };
  res.summary = `${acc}/${rows.length} new accepted (Wilson ${res.new_wilson?.join('–')}) vs old ${accOld}/${rows.length}; worse ${wrs.length}, better ${bet.length}; new wrong-text ${res.new_wrong_text} vs old ${res.old_wrong_text}; controls ${ctl.length - ctlFail.length}/${ctl.length} rejected; ${res.pass ? 'PASS' : `STOP: ${why.join('; ')}`}`;
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(res, null, 1));
  return res;
}

/** One check's NEW-English verdicts → book_checks rows (lane-paired-retranslation-check v1). */
export async function record(db, OUT, { apply = true } = {}) {
  const { recordPageVerdicts, readMethod } = await import('../../lib/book-checks.mjs');
  const P = JSON.parse(fs.readFileSync(path.join(OUT, 'plan.json'), 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(OUT, 'packet.json'), 'utf8')).items;
  const vs = new Map(jsonl(path.join(OUT, 'verdicts.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r]));
  const verdicts = [];
  for (const s of P.selected) {
    const it = items.find((x) => x.page_id === s.page_id && x.arm === 'N' && x.kind === 'item');
    const v = vs.get(it?.id)?.verdict; if (!v) continue;
    const bad = (v.defects || []).filter((d) => d.severity === 'wrong_text' || d.severity === 'misleads');
    verdicts.push({ page_id: s.page_id, note: String(v.reader_note || ''), outcome: bad.length ? 'serious' : (v.defects || []).length ? 'minor' : 'clean',
      page_verdict: wt(v) ? 'fix' : bad.length ? 'caveat' : 'show', verdict: v.accept ? 'accepted' : 'not accepted',
      errors: bad.map((d) => ({ stage: d.origin === 'transcription' ? 'ocr' : 'translation', ...(d.class ? { class: d.class } : {}), problem: `${d.severity}: ${d.what ?? ''} «${String(d.quote ?? '').slice(0, 200)}»`.slice(0, 600) })),
      defects: v.defects || [], judged: { ocr: it.source, translation: it.text } });
  }
  return recordPageVerdicts(db, { method_id: METHOD, method_version: readMethod(METHOD).version, run_id: `zh-retranslate-8169-${path.basename(OUT)}`, checked_at: new Date(),
    selection: 'random', stages: ['translation'], reader: { kind: 'model', model: 'claude -p --model opus', image_opened: true },
    evidence_path: `box:${os.hostname()}:${path.join(OUT, 'verdicts.jsonl')}`, reader_warning: false, exposure: 'live',
    note: 'One page per book drawn from the pages the #8169 lane had just re-translated; the new English judged blind against the page image.',
    frame: { lane: 'zh-retranslate-8169', seed: P.seed, since_seq: P.since, written_at_check: P.written, pages_drawn: P.selected.length },
    verdicts }, { apply });
}

async function main() {
  const DIR = path.resolve(arg('dir')), OUT = path.resolve(arg('out'));
  const N = Number(arg('n', 30)), SEED = Number(arg('seed', 8169)), SINCE = Number(arg('since', 0));
  fs.mkdirSync(OUT, { recursive: true });
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  try {
    if (!fs.existsSync(path.join(OUT, 'plan.json'))) { const n = await plan(db, { DIR, OUT, N, SEED, SINCE }); if (n < N) { console.error(`only ${n} of ${N} pages drawn: no check ran`); process.exit(3); } }
    const stop = await judge(OUT);
    if (stop) { console.error(`NO CHECK RAN: ${stop}`); process.exit(3); }
    let res = score(OUT, N);
    if (!res) { const again = await judge(OUT); res = !again && score(OUT, N); }
    if (!res) { console.error('verdicts missing after retries: no check ran'); process.exit(3); }
    if (process.argv.includes('--record')) { const r = await record(db, OUT); fs.writeFileSync(path.join(OUT, 'recorded.json'), JSON.stringify({ inserted: r.inserted, already: r.already, failed: r.failed }, null, 1)); console.log(`book_checks: ${r.inserted} rows, ${r.failed.length} failed`); }
    console.log(res.summary);
  } finally { await c.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
