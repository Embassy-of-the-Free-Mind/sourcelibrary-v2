#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-correct-6560/pass/diffqa.mjs (spans / merge / write for a Tibetan correction already
// written, judged by a sealed Opus leaf check) and leafcheck.mjs audit-req (the per-span A/B image question, copied
// here as the judge prompt). Neither tokenises Latin, neither has an independent third read to vote with, and both
// judge with Claude, which is scarce this week (#7591). This is the Latin twin: words, a fresh agy read as the vote,
// and an agy Flash judge only where draft, correction and fresh read all disagree.
/**
 * Latin word-level diff-QA of agy OCR corrections, with a three-way vote (#7591).
 *
 *   list      --corr=D1,D2 --fresh=F1,F2 [--skip=S1,S2] --out=L.jsonl                      (needs --env-file)
 *             One row per correction read (cli-ocr.mjs read --correct-prompt) whose page still stores the draft it
 *             corrected: {page_id, book_id, page_number, draft, next, fresh, image, corr_dir}. --skip takes cli-ocr.mjs
 *             apply DRY-RUN summaries of the same correction dirs: every page its guards refuse (chatter, UNCHANGED,
 *             CONTAIN, >25% of words changed, a human edit, a rewritten draft…) is left out, so this tool adds a check
 *             and removes none. `fresh` is an independent plain read (cli-ocr.mjs read, no draft in the prompt).
 *   spans     --list=L.jsonl --out=S.jsonl
 *             One row per changed span (lib/latin-diffqa.mjs): class LOW / RISKY and why; for a RISKY span the vote of the
 *             fresh read: correction (kept), draft (put back), split or no-anchor (to the judge).
 *   judge-req --list=L.jsonl --spans=S.jsonl --req=R.jsonl --key=K.json
 *             One request per page with spans to judge: those spans as A/B items (random order) and one known-answer
 *             control (a word the draft and correction agree on, against a one-character change).
 *   judge     --req=R.jsonl --out=O.jsonl [--model=gemini-3.8-flash-high] [--concurrency=3]
 *             One agy call per request, the page image in a gated workspace (agy-cli.mjs). Resumes from O.
 *   merge     --list=L.jsonl --spans=S.jsonl [--key=K.json --replies=O.jsonl] --out=M.jsonl
 *             Per page: LOW and voted-correction spans stay; voted-draft spans go back; judged spans stay only where the
 *             judge saw the correction (draft, other, unclear go back). A page with a span to judge and no reply is
 *             HELD (M.jsonl.held.json), never written: a quota stop must not revert or keep unjudged spans.
 *   write     --merge=M.jsonl --run=diffqa-7591-<name> [--apply]                             (needs --env-file)
 *             Through writePageText, compare-and-set on the draft (a page changed since is skipped), the whole prior ocr
 *             in page_revisions under the run id (scripts/maintenance/revert-run.mjs undoes it); `ocr.diffqa` records
 *             what was put back; translation_stale (lane diffqa-7591) where English exists.
 *   control   --list=L.jsonl --out=L2.jsonl --plants=P.json [--n=20] [--per-page=2] [--drop-fresh]
 *             Positive control: plants n known swaps (shelfmark number, year, page number, name, dropped negation) into
 *             copies of corrections. Run spans / judge-req / judge / merge on L2, then `control-score`.
 *   control-score --plants=P.json --merge=M.jsonl --spans=S.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { diffWords, classifyHunk, alignToFresh, voteHunk, revertWordHunks, wordTokens } from '../../lib/latin-diffqa.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const readJsonl = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const list = (s) => String(s || '').split(',').filter(Boolean);

function rngFor(s) { // mulberry32 over a string hash, as leafcheck.mjs: a request set is rebuilt identically
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, rng) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
// Text line of an offset, header tag lines and blank lines not counted (what a reader of the image counts).
const textLine = (text, off) => String(text).slice(0, off).split('\n').filter((l) => l.trim() && !/^\s*<[^>]+>[^<]*(<\/[^>]+>)?\s*$/.test(l)).length + 1;
const ctx = (toks, from, to) => toks.slice(Math.max(0, from), Math.max(0, to)).map((x) => x.tok).join(' ');

// The read-off of leafcheck.mjs, for a printed Roman-script page.
const READOFF = 'You are checking a transcription of a printed book page against its image, the file ./page.jpg in this '
  + 'directory. Open it with read_file (or view_file): that is the only tool available here, and running commands, '
  + 'cropping or any other tool is disabled. Below are numbered items. Each gives the approximate text line (counting '
  + 'from the top of the page; on a two-column page the left column comes first), the words just before the spot, two '
  + 'candidate readings for the spot, and the words just after. Look at the image and say which candidate the page '
  + 'actually prints. Judge only by what is printed on this page, not by what the text ought to say. Long s (ſ) and s, '
  + 'u and v, i and j, and punctuation do not count as differences; numbers, letters and words do. If neither '
  + 'candidate matches, answer "other" and write what you see. If you cannot find or read the spot, answer "unclear".\n\n'
  + 'Reply with one JSON object per line, one per item, between two marker lines <<<BEGIN>>> and <<<END>>>, nothing '
  + 'outside the markers: {"item": <n>, "answer": "A"|"B"|"other"|"unclear", "seen": "<what the page prints there>"}\n\nItems:\n';
const NOTHING = '(nothing: the words before go straight on to the words after)';

function parseReply(text) {
  const m = String(text || '').match(/<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)/);
  const out = {};
  for (let l of (m ? m[1] : String(text || '')).split('\n')) {
    l = l.trim().replace(/,$/, '');
    if (!l.startsWith('{')) continue;
    try { const j = JSON.parse(l); out[Number(j.item)] = j; } catch { /* a malformed line is an unanswered item */ }
  }
  return out;
}
const sideOf = (it, ans) => {
  const a = String(ans?.answer || '').trim().toUpperCase();
  if (a === 'A' || a === 'B') return (a === 'A') === (it.A_is === 'arm') ? 'arm' : 'base';
  return a === 'OTHER' ? 'other' : a === 'UNCLEAR' ? 'unclear' : null;
};

function spansOf(r) {
  const d = diffWords(r.draft, r.next);
  const F = r.fresh ? wordTokens(r.fresh) : null;
  const bf = F ? alignToFresh(d.B, F) : null;
  return { d, rows: d.hunks.map((h, k) => {
    const a = h.a.map((i) => d.A[i].tok), b = h.b.map((j) => d.B[j].tok);
    const [cls, why] = classifyHunk(a, b);
    const vote = cls === 'RISKY' ? (F ? voteHunk(d, h, F, bf) : 'no-fresh') : null;
    const lo = h.b.length ? h.b[0] : (h.bAfter ?? d.B.length), hi = h.b.length ? h.b.at(-1) : lo - 1;
    const off = d.B[lo]?.start ?? String(r.next).length;
    return { page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, k, base: a.join(' '), arm: b.join(' '), cls, why, vote,
      line: textLine(r.next, off), before: ctx(d.B, lo - 5, lo), after: ctx(d.B, hi + 1, hi + 6) };
  }) };
}
const toJudge = (s) => s.cls === 'RISKY' && (s.vote === 'split' || s.vote === 'no-anchor' || s.vote === 'no-fresh');

if (CMD === 'list') {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const skip = new Map();
  for (const f of list(arg('skip'))) for (const [id, why] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')).skipped_pages || {})) skip.set(id, why);
  const fresh = new Map();
  for (const dir of list(arg('fresh'))) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.meta.json'))) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const t = fs.readFileSync(path.join(dir, `${m.page_id}.txt`), 'utf8').trim();
    if (m.exit === 0 && !m.error_class && !m.wrapper && !m.chatter && t.length > 5) fresh.set(m.page_id, { text: t, image: path.join(dir, `ws-${m.page_id}`, `${m.page_id}.jpg`), model: m.model, dir });
  }
  const rows = [], t = { corrections: 0, skipped_by_apply_guards: 0, draft_changed: 0, no_fresh: 0, rows: 0 };
  for (const dir of list(arg('corr'))) {
    const metas = fs.readdirSync(dir).filter((x) => x.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((m) => m.mode === 'correct');
    const pages = new Map((await db.collection('pages').find({ id: { $in: metas.map((m) => m.page_id) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()).map((p) => [p.id, p]));
    for (const m of metas) {
      t.corrections++;
      if (skip.has(m.page_id)) { t.skipped_by_apply_guards++; continue; }
      if (m.exit !== 0 || m.wrapper) { t.skipped_by_apply_guards++; continue; }
      const draft = pages.get(m.page_id)?.ocr?.data;
      if (!draft || contentHash(draft) !== m.draft?.text_hash) { t.draft_changed++; continue; }
      const f = fresh.get(m.page_id);
      if (!f) t.no_fresh++;
      rows.push({ page_id: m.page_id, book_id: m.book_id, page_number: m.page_number, draft, next: fs.readFileSync(path.join(dir, `${m.page_id}.txt`), 'utf8').trim(),
        fresh: f?.text ?? null, fresh_model: f?.model ?? null, fresh_dir: f?.dir ?? null, image: f?.image ?? path.join(dir, `ws-${m.page_id}`, `${m.page_id}.jpg`), corr_dir: dir });
    }
  }
  t.rows = rows.length;
  writeJsonl(arg('out'), rows.sort((a, b) => a.page_number - b.page_number));
  console.log(JSON.stringify(t)); await c.close();
} else if (CMD === 'spans') {
  const out = [];
  for (const r of readJsonl(arg('list'))) out.push(...spansOf(r).rows);
  writeJsonl(arg('out'), out);
  const by = {}, votes = {};
  for (const s of out) { by[`${s.cls}:${s.why}`] = (by[`${s.cls}:${s.why}`] || 0) + 1; if (s.vote) votes[s.vote] = (votes[s.vote] || 0) + 1; }
  console.log(JSON.stringify({ spans: out.length, low: out.filter((s) => s.cls === 'LOW').length, risky: out.filter((s) => s.cls === 'RISKY').length,
    pages_with_spans: new Set(out.map((s) => s.page_id)).size, pages_to_judge: new Set(out.filter(toJudge).map((s) => s.page_id)).size, votes, by }));
} else if (CMD === 'judge-req') {
  const rows = new Map(readJsonl(arg('list')).map((r) => [r.page_id, r]));
  const byPage = new Map();
  for (const s of readJsonl(arg('spans')).filter(toJudge)) (byPage.get(s.page_id) || byPage.set(s.page_id, []).get(s.page_id)).push(s);
  const reqs = [], key = {};
  for (const [pid, ss] of byPage) {
    const r = rows.get(pid); const rng = rngFor(`7591|judge|${pid}`);
    const items = ss.map((s) => ({ kind: 'span', k: s.k, base: s.base, arm: s.arm, line: s.line, before: s.before, after: s.after }));
    // One known-answer control: a word draft and correction agree on, set against a one-character change of it.
    const { d } = spansOf(r);
    const eq = d.pairs.filter(([i, j]) => i !== null && j !== null && d.A[i].tok === d.B[j].tok && /\d|^\p{Lu}\p{Ll}{3,}/u.test(d.B[j].tok));
    if (eq.length > 4) {
      const [, j] = eq[Math.floor(rng() * eq.length)];
      const w = d.B[j].tok;
      const alt = /\d/.test(w) ? w.replace(/\d/, (x) => String((Number(x) + 3) % 10)) : w.replace(/\p{Ll}/u, (x) => (x === 'e' ? 'o' : 'e'));
      items.push({ kind: 'control', base: w, arm: alt, line: textLine(r.next, d.B[j].start), before: ctx(d.B, j - 5, j), after: ctx(d.B, j + 1, j + 6) });
    }
    shuffle(items, rng);
    const lines = items.map((it, n) => {
      const flip = rng() < 0.5;
      const opts = flip ? [it.arm || NOTHING, it.base || NOTHING] : [it.base || NOTHING, it.arm || NOTHING];
      Object.assign(it, { item: n + 1, A_is: flip ? 'arm' : 'base' });
      return `${n + 1}. line ≈ ${it.line}; just before: ${it.before || '(start of page)'}; A: ${opts[0]}   B: ${opts[1]}; just after: ${it.after || '(end of page)'}`;
    });
    reqs.push({ uid: pid, image: r.image, prompt: READOFF + lines.join('\n') });
    key[pid] = { book_id: r.book_id, page_number: r.page_number, items };
  }
  writeJsonl(arg('req'), reqs);
  fs.writeFileSync(arg('key'), JSON.stringify(key));
  console.log(`judge-req: ${reqs.length} pages, ${Object.values(key).reduce((s, k) => s + k.items.filter((i) => i.kind === 'span').length, 0)} spans, ${Object.values(key).reduce((s, k) => s + k.items.filter((i) => i.kind === 'control').length, 0)} controls`);
} else if (CMD === 'judge') {
  const { agyCall, CLI_SAFE_ARGS, installToolGate, agyUsage } = await import('../../lib/agy-cli.mjs');
  const MODEL = arg('model') || 'gemini-3.8-flash-high';
  const OUT = arg('out'); const WS = `${OUT}.ws`;
  const done = new Set(readJsonl(OUT).filter((r) => r.text).map((r) => r.uid));
  const queue = readJsonl(arg('req')).filter((r) => !done.has(r.uid));
  const NUDGE = 'Running commands is not available here. Open ./page.jpg with read_file and answer now, following the instructions above exactly.';
  let stop = false, n = 0; const total = queue.length;
  console.log(`judge: ${queue.length} to call (${done.size} already answered), ${MODEL}`);
  const one = async (q) => {
    const ws = path.join(WS, q.uid); fs.mkdirSync(ws, { recursive: true });
    fs.copyFileSync(q.image, path.join(ws, 'page.jpg'));
    installToolGate(ws);
    const t0 = Date.now(); const usage = [];
    let r = await agyCall(['-p', q.prompt, '--model', MODEL, ...CLI_SAFE_ARGS], ws); usage.push(agyUsage(r.usage));
    if (r.cls === 'denied_tool' && r.conversation) { r = await agyCall(['-p', NUDGE, '--model', MODEL, ...CLI_SAFE_ARGS, '--conversation', r.conversation], ws); usage.push(agyUsage(r.usage)); }
    if (r.cls === 'quota') { stop = true; console.error(`QUOTA: stopping (${r.err})`); return; }
    const ok = !r.cls && Object.keys(parseReply(r.text)).length > 0;
    fs.appendFileSync(OUT, JSON.stringify({ uid: q.uid, model: MODEL, date: new Date().toISOString(), secs: Math.round((Date.now() - t0) / 1000), cls: r.cls, text: ok ? r.text : null, raw: ok ? undefined : r.text?.slice(0, 2000), usage }) + '\n');
    console.log(`  ${++n}/${total} ${q.uid} ${r.cls || (ok ? 'ok' : 'unparsed')} ${Math.round((Date.now() - t0) / 1000)}s`);
  };
  const C = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: C }, async () => { while (queue.length && !stop) await one(queue.shift()); }));
  process.exit(stop ? 3 : 0);
} else if (CMD === 'merge') {
  const key = arg('key') ? JSON.parse(fs.readFileSync(arg('key'), 'utf8')) : {};
  const rep = new Map(readJsonl(arg('replies')).filter((r) => r.text).map((r) => [r.uid, r]));
  const spans = readJsonl(arg('spans')).reduce((m, s) => m.set(s.page_id, [...(m.get(s.page_id) || []), s]), new Map());
  const out = [], held = [];
  const t = { pages: 0, no_change: 0, held: 0, written_rows: 0, all_reverted: 0, low: 0, risky: 0, kept_by_vote: 0, reverted_by_vote: 0, judged: 0, kept_by_judge: 0, reverted_by_judge: 0, judge_sides: {}, ctl: 0, ctl_right: 0 };
  for (const r of readJsonl(arg('list'))) {
    t.pages++;
    const ss = spans.get(r.page_id) || [];
    if (!ss.length) { t.no_change++; continue; }
    const k = key[r.page_id];
    if (ss.some(toJudge) && !(k && rep.has(r.page_id))) { t.held++; held.push(r.page_id); continue; }
    const ans = k ? parseReply(rep.get(r.page_id).text) : {};
    const judged = new Map();
    for (const it of k?.items || []) {
      const s = sideOf(it, ans[it.item]);
      if (it.kind === 'control') { t.ctl++; if (s === 'base') t.ctl_right++; continue; }
      judged.set(it.k, s);
    }
    const back = new Set(), reverted = [];
    for (const s of ss) {
      if (s.cls === 'LOW') { t.low++; continue; }
      t.risky++;
      if (s.vote === 'correction') { t.kept_by_vote++; continue; }
      if (s.vote === 'draft') { t.reverted_by_vote++; back.add(s.k); reverted.push(`${s.arm || '∅'}→${s.base || '∅'} (fresh read: draft, line ${s.line})`); continue; }
      t.judged++; const side = judged.get(s.k) ?? 'none';
      t.judge_sides[side] = (t.judge_sides[side] || 0) + 1;
      if (side === 'arm') { t.kept_by_judge++; continue; }
      t.reverted_by_judge++; back.add(s.k); reverted.push(`${s.arm || '∅'}→${s.base || '∅'} (judge: ${side}, line ${s.line})`);
    }
    const d = diffWords(r.draft, r.next);
    if (d.hunks.length !== ss.length) throw new Error(`${r.page_id}: spans file does not match the list (re-run spans)`);
    const text = revertWordHunks(r.draft, r.next, d, back);
    // A put-back span can carry a header element of the draft's along with its words (META_TAG words are not aligned):
    // a merge with more of any header tag than both inputs is not written.
    const tagN = (x, tg) => (String(x).match(new RegExp(`<${tg}>`, 'g')) || []).length;
    if (['language', 'script', 'scan-quality', 'page-type', 'columns', 'meta', 'vocab', 'image-desc', 'warning', 'header', 'page-num', 'sig'].some((tg) => tagN(text, tg) > Math.max(tagN(r.draft, tg), tagN(r.next, tg)))) { t.held++; held.push(r.page_id); t.held_tag_dup = (t.held_tag_dup || 0) + 1; continue; }
    if (!diffWords(r.draft, text).hunks.length) { t.all_reverted++; }
    out.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, corr_dir: r.corr_dir, draft_hash: contentHash(r.draft), next_hash: contentHash(r.next),
      fresh_dir: r.fresh_dir, fresh_model: r.fresh_model, text, spans: ss.length, risky: ss.filter((s) => s.cls === 'RISKY').length, reverted,
      judged: ss.filter(toJudge).length, judge_model: rep.get(r.page_id)?.model ?? null });
  }
  t.written_rows = out.length;
  writeJsonl(arg('out'), out);
  fs.writeFileSync(`${arg('out')}.held.json`, JSON.stringify(held));
  console.log(JSON.stringify(t));
} else if (CMD === 'write') {
  const { MongoClient } = await import('mongodb');
  const { writePageText, textHash } = await import('../../lib/page-text-writer.mjs');
  const { markTranslationsStale } = await import('../../lib/syriac-kraken-lane.mjs');
  const { geminiEngine, engineNameForCli, imageInput, ocrProvenance, notRecorded, codeVersion, host } = await import('../../lib/write-provenance.mjs');
  const APPLY = process.argv.includes('--apply'); const RUN = arg('run');
  if (!/^diffqa-7591-/.test(RUN || '')) { console.error('--run=diffqa-7591-<name> is required'); process.exit(2); }
  const REASON = 'reader request (Catalogi, 2026-10-28): agy correction of the Flash-Lite draft, word-level diff-QA (#7591)';
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const CODE_VERSION = await codeVersion();
  const t = { rows: 0, written: 0, unchanged_from_draft: 0, changed_since: 0, stale_marked: 0 }; const done = [], books = {};
  for (const r of readJsonl(arg('merge'))) {
    t.rows++;
    const page = await db.collection('pages').findOne({ id: r.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1 } });
    if (!page || contentHash(page.ocr?.data || '') !== r.draft_hash || page.ocr?.edited_by || page.ocr?.source === 'manual') { t.changed_since++; continue; }
    if (!diffWords(page.ocr.data, r.text).hunks.length && page.ocr.data.trim() === r.text.trim()) { t.unchanged_from_draft++; continue; }
    const m = JSON.parse(fs.readFileSync(path.join(r.corr_dir, `${r.page_id}.meta.json`), 'utf8'));
    const corr = fs.readFileSync(path.join(r.corr_dir, `${r.page_id}.txt`), 'utf8').trim();
    if (contentHash(corr) !== r.next_hash) { t.changed_since++; continue; }
    const ref = JSON.parse(fs.readFileSync(path.join(r.corr_dir, 'prompt-ref.json'), 'utf8'));
    const sent = fs.readFileSync(path.join(r.corr_dir, m.prompt_sent_file), 'utf8');
    if (contentHash(sent) !== m.prompt_sent_hash) { t.changed_since++; continue; }
    const diffqa = { run: RUN, issue: 7591, spans: r.spans, risky: r.risky, judged: r.judged, reverted_spans: r.reverted, correction_hash: r.next_hash,
      fresh_read: r.fresh_model ? { model: r.fresh_model, dir: r.fresh_dir } : null, judge_model: r.judge_model };
    const engine = geminiEngine({
      name: engineNameForCli(m.cli), call_site: 'scripts/eval/latin-diffqa-7591/diffqa.mjs', api: 'cli', cli: { name: m.cli, version: m.cli_version }, model: m.model,
      prompt: { ...ref, text: sent },
      generationConfig: notRecorded(`${m.cli} -p exposes no temperature, output cap or thinking setting; the model id names the tier`),
      run: { job_id: RUN, code_version: CODE_VERSION, host: host(), at: new Date(m.finished_at), read_started_at: m.started_at, reason: REASON },
      input: { ...imageInput({ url: m.image_url, mime: 'image/jpeg', bytes: m.image_bytes }), image_sha256: m.image_sha256, draft: m.draft, diffqa },
    });
    console.log(`  ${APPLY ? 'WRITE' : 'would write'} p.${page.page_number}: ${r.spans} spans, ${r.reverted.length} put back`);
    if (!APPLY) { t.written++; continue; }
    const w = await writePageText(db, page.id, 'ocr', {
      data: r.text, language: page.ocr?.language ?? 'auto-detect', model: m.model, updated_at: new Date(), source: 'ai', prompt_version: ref.version, prompt_id: ref.id, prompt_name: ref.name,
      ...ocrProvenance(r.text, engine), pipeline: m.lane, ...(page.ocr?.verdict && { verdict: page.ocr.verdict }), diffqa,
    }, { by: `diffqa.mjs (${m.cli} ${m.model} correction, three-way vote)`, reason: REASON, run_id: RUN, revision_source: 'diffqa_7591', expect_prior_hash: textHash(page.ocr) });
    if (w.status !== 'written') { t.changed_since++; continue; }
    t.written++; done.push({ id: page.id, text: r.text });
    (books[page.book_id] ??= []).push(page.page_number);
  }
  if (APPLY && done.length) {
    t.stale_marked = await markTranslationsStale(db, done, new Date(), 'diffqa-7591');
    for (const [bookId, nums] of Object.entries(books)) await db.collection('book_events').insertOne({ book_id: bookId, type: 'ocr_reread', at: new Date(), source: 'scripts/eval/latin-diffqa-7591/diffqa.mjs', details: { run: RUN, api: 'cli', pages: nums.length, page_numbers: nums.sort((a, b) => a - b), reason: REASON, issue: 7591 } });
  }
  console.log(JSON.stringify({ apply: APPLY, run: RUN, ...t })); await c.close();
} else if (CMD === 'control') {
  // Plants known swaps into copies of corrections, on words the draft and the correction agree on (so the draft holds
  // the truth the image shows, as far as both reads go): the swap must come back to the draft.
  const N = Number(arg('n') || 20), rng = rngFor('7591|control');
  const rows = readJsonl(arg('list')).filter((r) => r.fresh);
  // --drop-fresh: the same plants with no fresh read, so every one goes to the judge (measures the judge alone)
  if (process.argv.includes('--drop-fresh')) for (const r of rows) r.fresh = null;
  const KINDS = ['shelfmark', 'year', 'page', 'name', 'negation'];
  const NEG = /^(non|nec|neque|nisi|not|no)$/i;
  const plants = [], used = new Map(); const PER_PAGE = Number(arg('per-page') || 2);
  const order = shuffle([...rows.keys()], rng);
  for (let t = 0; plants.length < N && t < order.length * PER_PAGE * KINDS.length; t++) {
    const r = rows[order[t % order.length]]; const kind = KINDS[plants.length % KINDS.length];
    if ((used.get(r.page_id) || 0) >= PER_PAGE) continue;
    const d = diffWords(r.draft, r.next);
    // a word draft and correction agree on, at least 8 words from any change (planted or not)
    const changed = new Set(d.hunks.flatMap((h) => [...h.b, h.bBefore, h.bAfter].filter((x) => x !== null)));
    const far = (j) => [...changed].every((c) => Math.abs(c - j) >= 8);
    const eq = d.pairs.filter(([i, j]) => i !== null && j !== null && d.A[i].tok === d.B[j].tok).map(([, j]) => j).filter(far);
    const test = { shelfmark: (w) => /^\d{3,5}\.?$/.test(w) && !/^1[5-7]\d\d\.?$/.test(w), year: (w) => /^1[5-7]\d\d[.,;]?$/.test(w), page: (w) => /^\d{1,3}[.,;]?$/.test(w), name: (w) => /^\p{Lu}\p{Ll}{4,}[,.;]?$/u.test(w), negation: (w) => NEG.test(w) }[kind];
    const cand = eq.filter((j) => test(d.B[j].tok) && j > 3 && j < d.B.length - 3);
    if (!cand.length) continue;
    const j = cand[Math.floor(rng() * cand.length)], w = d.B[j].tok;
    let alt;
    if (kind === 'negation') alt = '';
    else if (kind === 'name') alt = w.replace(/(\p{Ll})(\p{Ll})/u, '$2$1');
    else alt = w.replace(/(\d)(\d)(?!.*\d\d)/, (s, x, y) => (x === y ? `${x}${(Number(y) + 1) % 10}` : `${y}${x}`));
    if (alt === w) continue;
    const B = d.B[j];
    r.next = kind === 'negation' ? r.next.slice(0, B.start).replace(/[ \t]+$/, '') + r.next.slice(B.end) : r.next.slice(0, B.start) + alt + r.next.slice(B.end);
    used.set(r.page_id, (used.get(r.page_id) || 0) + 1);
    plants.push({ page_id: r.page_id, page_number: r.page_number, kind, truth: w, planted: alt || '∅', before: ctx(d.B, j - 3, j) });
  }
  writeJsonl(arg('out'), rows.filter((r) => used.has(r.page_id)));
  fs.writeFileSync(arg('plants'), JSON.stringify(plants, null, 1));
  console.log(`control: ${plants.length} plants on ${used.size} pages`, JSON.stringify(plants.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] || 0) + 1 }), {})));
} else if (CMD === 'control-score') {
  const plants = JSON.parse(fs.readFileSync(arg('plants'), 'utf8'));
  const merged = new Map(readJsonl(arg('merge')).map((r) => [r.page_id, r]));
  const held = new Set(fs.existsSync(`${arg('merge')}.held.json`) ? JSON.parse(fs.readFileSync(`${arg('merge')}.held.json`, 'utf8')) : []);
  const spans = readJsonl(arg('spans'));
  const norm = (x) => ` ${wordTokens(x).map((t) => t.key).join(' ')} `; // word keys: a punctuation-only token between does not count
  const rows = plants.map((p) => {
    const s = spans.find((x) => x.page_id === p.page_id && norm(x.before).trim().endsWith(norm(p.before).trim().split(' ').at(-1)) && (p.planted === '∅' ? x.base.split(' ').includes(p.truth) : x.arm.split(' ').includes(p.planted)));
    const m = merged.get(p.page_id);
    // Caught = the page was held, or the merged text has the true word back after the plant's (unchanged) context.
    const caught = held.has(p.page_id) ? 'held' : m && norm(m.text).includes(norm(`${p.before} ${p.truth}`)) ? 'reverted' : 'missed';
    return { ...p, span: s ? `${s.cls}:${s.why}:${s.vote}` : 'no span', caught };
  });
  const n = rows.filter((r) => r.caught !== 'missed').length;
  console.log(JSON.stringify({ caught: `${n}/${rows.length}`, rows }, null, 1));
} else {
  console.error('usage: diffqa.mjs list|spans|judge-req|judge|merge|write|control|control-score (see the header)');
  process.exit(2);
}
