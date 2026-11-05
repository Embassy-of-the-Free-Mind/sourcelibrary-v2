#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-translate.mjs --cli=agy — THE 4-a-call reader with the #5021 anchor guard; this
// script only builds its page-ids file (blocks of real neighbours around each judged page) and runs it. run.mjs
// (this folder) judges F4 with the other arms. scripts/eval/route-judge-6740/judge.mjs opusCall: the sealed claude -p
// call, used here with --model sonnet for the slip screen and opus for its confirmations. No wrong-leaf screen with
// neighbour scans existed for translation blocks (the #5021 measurement used the anchor guard alone).
/**
 * Arm F4 of the #5274 paired test (PREREGISTRATION.md, amendment 1).
 *
 *   node --env-file=... f4.mjs blocks  --out=DIR
 *   node --env-file=... f4.mjs arm     --out=DIR --home=/root/.agy-james
 *   node                f4.mjs screen  --out=DIR [--concurrency=3]      (Sonnet, every page of every block)
 *   node                f4.mjs confirm --out=DIR                        (Opus, every Sonnet flag)
 *   node                f4.mjs score   --out=DIR                        (f4-score.json; the judged F4 vs F is in run.mjs score)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../lib/paired-stats.mjs';
import { opusCall } from '../route-judge-6740/judge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
const SEED = 20261104;
const JOB = 'zh-translation-paired-5274';
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const DIR = () => path.join(OUT, 'arm-F4');
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, w = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [+(c - w).toFixed(3), +(c + w).toFixed(3)]; };

async function blocks() {
  const { MongoClient } = await import('mongodb');
  const { isTranslatablePage } = await import('../../lib/translate-core.mjs');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const s = J('sample.json');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const all = await c.db('bookstore').collection('pages').find({ book_id: { $in: s.pages.map((p) => p.book_id) } },
    { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, cropped_photo: 1, photo: 1, split_from_spread: 1, archived_photo: 1, enhanced_photo: 1 } }).toArray();
  await c.close();
  const byNum = new Map(all.map((p) => [`${p.book_id}:${p.page_number}`, p]));
  const ok = (p) => p && isTranslatablePage(p).ok && (p.ocr?.data || '').length >= 200;
  const rng = makeRng(SEED);
  const out = [], ids = [];
  for (const sp of s.pages) {
    const mid = rng() < 0.5 ? [2, 3] : [3, 2];
    const tries = [...mid.map((pos) => [4, pos]), [4, 1], [4, 4], [3, 2], [3, 1], [3, 3], [2, 1], [2, 2]];
    let pick = null;
    for (const [size, pos] of tries) {
      const nums = Array.from({ length: size }, (_, i) => sp.page_number - pos + 1 + i);
      const ps = nums.map((n) => byNum.get(`${sp.book_id}:${n}`));
      if (ps.every(ok) && ps.reduce((t, p) => t + p.ocr.data.length, 0) <= 20000) { pick = { size, pos, ps }; break; }
    }
    if (!pick) { out.push({ page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, kind: sp.kind, block: null, why: 'no block of 2+ the book allows' }); continue; }
    const img = (n) => { const p = byNum.get(`${sp.book_id}:${n}`); return p ? getPageSource(p) : null; };
    out.push({ page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, kind: sp.kind, size: pick.size, position: pick.pos,
      block: pick.ps.map((p) => ({ page_id: p.id, page_number: p.page_number, image: img(p.page_number), prev_image: img(p.page_number - 1), next_image: img(p.page_number + 1) })) });
    ids.push(...pick.ps.map((p) => p.id));
  }
  fs.mkdirSync(DIR(), { recursive: true });
  W('f4-blocks.json', out); fs.writeFileSync(path.join(DIR(), 'page-ids.json'), JSON.stringify(ids));
  const tally = out.reduce((o, b) => ((o[b.block ? `${b.size}@${b.position}` : 'none'] = (o[b.block ? `${b.size}@${b.position}` : 'none'] || 0) + 1), o), {});
  console.log(`${out.length} judged pages; ${ids.length} pages in blocks; size@position ${JSON.stringify(tally)}`);
}

async function arm() {
  const { readPool, agyEnv, weeklyReserve } = await import('../../lib/agy-pools.mjs');
  const home = arg('home') || null;
  const ids = JSON.parse(fs.readFileSync(path.join(DIR(), 'page-ids.json'), 'utf8'));
  const meter = path.join(OUT, 'quota.jsonl');
  // Chunks of 10 blocks (the block boundaries are kept: a chunk is whole books), the pool's floors before each.
  const bl = J('f4-blocks.json').filter((b) => b.block);
  for (let i = 0; i < bl.length; i += 10) {
    const chunk = bl.slice(i, i + 10).flatMap((b) => b.block.map((x) => x.page_id)).filter((id) => ids.includes(id));
    const r = readPool(home);
    fs.appendFileSync(meter, JSON.stringify({ at: new Date().toISOString(), arm: 'F4', home, before_chunk: i, reading: r }) + '\n');
    const line = Math.max(0.35, weeklyReserve({ resetTime: r?.weeklyReset, lane: null }));
    if (!r || r.weekly < line || (r.fiveHour ?? 0) < 0.25) { console.error(`pool ${home} under its floor (${JSON.stringify(r)}): stopping`); process.exit(3); }
    const f = path.join(DIR(), `chunk-${i}.json`); fs.writeFileSync(f, JSON.stringify(chunk));
    const res = spawnSync('node', [path.join(ROOT, 'scripts/batch/claude-translate.mjs'), 'read', '--cli=agy', '--per-call=4', `--page-ids-file=${f}`, `--out=${DIR()}`, '--model=gemini-3.8-flash-low', '--fresh', `--job=${JOB}-F4`],
      { cwd: ROOT, stdio: 'inherit', env: agyEnv(home, process.env, { CANDIDATE_READS: 'off', CLI_JOB_NAME: JOB, AGY_JOB: JOB }) });
    if (res.status !== 0) { console.error(`claude-translate exit ${res.status}: stopping`); process.exit(res.status === 3 ? 3 : 1); }
  }
  fs.appendFileSync(meter, JSON.stringify({ at: new Date().toISOString(), arm: 'F4', home, after: true, reading: readPool(home) }) + '\n');
}

// ── the slip screen ──
const screenPrompt = (n, files) => `You are checking one page of a machine translation of a Chinese book for WRONG-LEAF text: English that belongs to a neighbouring leaf, not to this one. The translator was given four consecutive pages at once, so text can slip across a page break.

Scans in your working folder (open each with Read before you answer): ${files.map(([role, f]) => `${role}: ./${f}`).join('; ')}.
The page checked is page ${n} (THIS). Its English:
<english>
${'%EN%'}
</english>

Questions:
1. wrong_leaf: does this English contain any passage whose source is printed on the PREVIOUS or NEXT leaf, not on THIS leaf (text carried over, duplicated or absorbed from a neighbour)? Ignore the summary and keywords lines. A sentence THIS leaf begins and the next leaf finishes may be completed in the English only if it is plainly short; a whole clause or more from a neighbour counts.
2. wrong_side_sentences: how many sentences are finished on the wrong side of a page break (THIS leaf's English completes a sentence with words that are printed on the next leaf, or begins with words printed on the previous leaf)? A number, 0 if none.
3. missing: is a substantial part of THIS leaf's text missing from the English (moved to a neighbour's English, or dropped)?

Answer with one JSON object only: {"wrong_leaf": bool, "which": "prev"|"next"|"", "quote": "the English passage, short", "wrong_side_sentences": n, "missing": bool, "note": "a few words"}`;

const parse = (t) => { try { const m = String(t).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } };

async function looks(model, items, file, conc) {
  const limits = await import('../../lib/model-limits.mjs');
  const prev = jsonl(file), done = new Set(prev.filter((r) => r.verdict).map((r) => r.id));
  const todo = items.filter((it) => !done.has(it.id));
  console.log(`${model}: ${todo.length} to look at`);
  let stop = null, i = 0;
  const one = async (it) => {
    const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 });
    if (b) { stop = b; return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zhp-f4-'));
    try {
      const files = [];
      for (const [role, url] of [['PREVIOUS leaf', it.prev_image], ['THIS leaf', it.image], ['NEXT leaf', it.next_image]]) {
        if (!url) continue;
        const res = await fetch(url); if (!res.ok) continue;
        const f = `${role.split(' ')[0].toLowerCase()}.jpg`; fs.writeFileSync(path.join(ws, f), Buffer.from(await res.arrayBuffer())); files.push([role, f]);
      }
      const t0 = Date.now();
      const r = await opusCall(screenPrompt(it.page_number, files).replace('%EN%', it.text), ws, model);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = { reason: 'quota reply' }; return; }
      const v = parse(r.text);
      fs.appendFileSync(file, JSON.stringify({ id: it.id, model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 300), images: files.map(([x]) => x), usage: r.usage, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `wrong_leaf=${v.wrong_leaf} side=${v.wrong_side_sentences} missing=${v.missing}` : 'unparsed'}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`BLOCKED ${JSON.stringify(stop)}`); process.exit(3); }
}

const screenItems = () => J('f4-blocks.json').filter((b) => b.block).flatMap((b) => b.block.map((x) => {
  const t = path.join(DIR(), `${x.page_id}.txt`);
  const text = fs.existsSync(t) ? fs.readFileSync(t, 'utf8').trim() : '';
  return { id: x.page_id, block_of: b.page_id, judged: x.page_id === b.page_id, page_number: x.page_number, image: x.image, prev_image: x.prev_image, next_image: x.next_image, text };
})).filter((x) => x.text.length > 5);

async function screen() { await looks('sonnet', screenItems(), path.join(OUT, 'f4-screen-sonnet.jsonl'), Math.max(1, Math.min(4, Number(arg('concurrency', 3))))); }
async function confirm() {
  const flagged = new Set(jsonl(path.join(OUT, 'f4-screen-sonnet.jsonl')).filter((r) => r.verdict && (r.verdict.wrong_leaf || r.verdict.missing || Number(r.verdict.wrong_side_sentences) > 0)).map((r) => r.id));
  await looks('opus', screenItems().filter((x) => flagged.has(x.id)), path.join(OUT, 'f4-screen-opus.jsonl'), 2);
}

function score() {
  const bl = J('f4-blocks.json');
  const metas = bl.filter((b) => b.block).flatMap((b) => b.block.map((x) => { const f = path.join(DIR(), `${x.page_id}.meta.json`); return fs.existsSync(f) ? { ...JSON.parse(fs.readFileSync(f, 'utf8')), judged: x.page_id === b.page_id, block_of: b.page_id } : null; })).filter(Boolean);
  const calls = jsonl(path.join(DIR(), 'calls.jsonl'));
  const callRows = calls.filter((c) => c.pages);
  const guards = calls.filter((c) => c.guard).flatMap((c) => c.guard.map((g) => g.kind));
  const sumU = (f) => callRows.reduce((s, c) => s + (Number(c.usage?.[f]) || 0), 0);
  const pagesRead = metas.filter((m) => m.exit === 0).length;
  const S = new Map(jsonl(path.join(OUT, 'f4-screen-sonnet.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const O = new Map(jsonl(path.join(OUT, 'f4-screen-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const confirmed = [...O.entries()].filter(([, v]) => v.wrong_leaf).map(([id]) => id);
  const blocksWith = new Set(metas.filter((m) => confirmed.includes(m.page_id)).map((m) => m.block_of));
  const nBlocks = bl.filter((b) => b.block).length, nScreened = S.size;
  const out = {
    at: new Date().toISOString(),
    blocks: { judged_pages: bl.length, with_block: nBlocks, size_position: bl.reduce((o, b) => ((o[b.block ? `${b.size}@${b.position}` : 'none'] = (o[b.block ? `${b.size}@${b.position}` : 'none'] || 0) + 1), o), {}) },
    reads: { pages: metas.length, ok: pagesRead, failed: metas.filter((m) => m.exit !== 0).length, read_alone: metas.filter((m) => m.exit === 0 && m.call_pages === 1).length, judged_read_alone: metas.filter((m) => m.judged && m.exit === 0 && m.call_pages === 1).map((m) => m.page_id), truncated: metas.filter((m) => m.write_guard).length },
    calls: { total: callRows.length, refused: callRows.filter((c) => c.cls).length, refused_by_class: callRows.filter((c) => c.cls).reduce((o, c) => ((o[c.cls] = (o[c.cls] || 0) + 1), o), {}), guard_refusals_by_kind: guards.reduce((o, k) => ((o[k] = (o[k] || 0) + 1), o), {}), calls_per_page: pagesRead ? +(callRows.length / pagesRead).toFixed(3) : null },
    tokens: { input: sumU('input'), output: sumU('output'), thinking: sumU('thinking'), cache_read: sumU('cache_read'), total: sumU('total'), per_page: pagesRead ? Math.round(sumU('total') / pagesRead) : null },
    context: metas.reduce((o, m) => { const k = `${m.call_pages}p prev=${m.context?.previous_from ?? 'none'} prevOcr=${!!m.context?.prev_ocr} nextOcr=${!!m.context?.next_ocr}`; o[k] = (o[k] || 0) + 1; return o; }, {}),
    screen: {
      screened: nScreened, sonnet_flags: [...S.values()].filter((v) => v.wrong_leaf || v.missing || Number(v.wrong_side_sentences) > 0).length, sonnet_wrong_leaf: [...S.values()].filter((v) => v.wrong_leaf).length,
      opus_looked: O.size, confirmed_wrong_leaf_pages: confirmed.length, confirmed_pages: confirmed, page_rate_ci95: wilson(confirmed.length, nScreened),
      blocks_with_confirmed_slip: blocksWith.size, blocks: nBlocks, block_rate_ci95: wilson(blocksWith.size, nBlocks),
      wrong_side_sentences_opus: [...O.values()].reduce((s, v) => s + (Number(v.wrong_side_sentences) || 0), 0),
      wrong_side_sentences_sonnet: [...S.values()].reduce((s, v) => s + (Number(v.wrong_side_sentences) || 0), 0),
      missing_confirmed: [...O.values()].filter((v) => v.missing).length,
      would_still_miss_rate_rule_of_three: nScreened ? +(3 / nScreened).toFixed(4) : null,
    },
  };
  W('f4-score.json', out);
  console.log(JSON.stringify(out, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
  await ({ blocks, arm, screen, confirm, score }[STAGE] ?? (() => { console.error('stages: blocks | arm | screen | confirm | score'); process.exit(2); }))();
}
