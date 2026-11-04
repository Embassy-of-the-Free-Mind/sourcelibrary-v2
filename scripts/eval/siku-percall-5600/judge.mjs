#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs — judgePrompt (accept / fidelity / taxonomy defects, one output
// per call against the image) and clusterCI are IMPORTED, so the accept rate here is the router's. It does not fit as
// is: it asks nothing of the Siku lane's spot-check rubric (siku-translate-lane.mjs JUDGE: wrong_leaf, invented,
// sense_errors, verdict) nor of margin furniture / next-leaf bleed, and its opusCall keeps no transcript, so a verdict
// cannot be checked for an opened image. scripts/eval/agy-per-call-7503/judge.mjs judges four versions in ONE call;
// the router reads one output per call.
/**
 * #5600 blind judge for the Siku per-call / prompt-line test.
 *
 *   node --env-file=... scripts/eval/siku-percall-5600/judge.mjs packet --scratch=DIR [--arms=A,B,C]
 *   node scripts/eval/siku-percall-5600/judge.mjs judge --scratch=DIR [--jobs=4] [--reuse=OTHER_JDIR]
 *   --jdir=NAME (default judge) and packet --pages=all: every page of the 30 blocks, no controls (the supplement that
 *   puts the margin/bleed flags on n=120 per arm); judge --reuse copies a verdict made for the same id (page|arm|text).
 *   node scripts/eval/siku-percall-5600/judge.mjs score --scratch=DIR
 *
 * packet: one item per (drawn page, arm), plus controls (seed 56001): 2 next-leaf bleed (arm A's English of the drawn
 * page + the first sentence of arm A's English of the NEXT page) and 2 wrong-leaf (another book's arm-A English under
 * this page's image). Items are shuffled; ids are hashes; the arm key goes to DIR/judge/key.json, never into a prompt.
 * judge: Opus via `claude -p` (this box's subscription), Read only, --restricted to a folder holding page.jpg, stream-json
 * transcript kept; a verdict counts only if the transcript shows a Read of page.jpg (one retry otherwise).
 * score: per arm, the router's shape (accept, accept_ci by book, wrong_text_pages, fidelity_mean) plus the lane bar
 * (wrong_leaf, invented, sense-error pages) and the two flags; paired differences against A. Writes DIR/judge/score.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { judgePrompt, clusterCI } from '../route-judge-6740/judge.mjs';
import { makeRng } from '../lib/paired-stats.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = path.resolve(arg('scratch') || '.');
const J = path.join(S, arg('jdir') || 'judge');
// A read `cli-translate.mjs apply` refuses (Gemini's filter notice cuts the reply before <<<END>>>) is never written:
// it is scored as no read (not accepted), never as an invented page.
const FILTER_NOTICE = /blocked by Gemini's filters/i;
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const body = (t) => String(t || '').replace(/<summary>[\s\S]*?<\/summary>/g, '').replace(/<keywords>[\s\S]*?<\/keywords>/g, '').trim();
const firstSentence = (t) => (body(t).replace(/<[^>]+>/g, '').match(/[^.!?]{40,}[.!?]/) || [])[0]?.trim() || null;
const readOf = (arm, id) => { const f = path.join(S, arm, `${id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };
const metaOf = (arm, id) => { const f = path.join(S, arm, `${id}.meta.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };

/** The router prompt, with the Siku spot-check rubric and the two flags added before the answer line. */
export function sikuPrompt(it, imageRef) {
  const base = judgePrompt({ task: 'translation', lang: 'Classical Chinese', source: it.source, text: it.text }, imageRef);
  const cut = base.lastIndexOf('Answer with one JSON object only:');
  return `${base.slice(0, cut)}NEIGHBOURING PAGES' TRANSCRIPTIONS (context only; NOT part of this page):
PREVIOUS PAGE:
"""
${it.prev_ocr ?? '(none)'}
"""
NEXT PAGE:
"""
${it.next_ocr ?? '(none)'}
"""

Also answer, for the library's spot check of this lane:
- wrong_leaf: true if the candidate is the text of a different page than the image (not merely misread characters).
- invented: true if the candidate contains a passage (a sentence or more) that is not on this leaf at all and is not marked as a note or gloss. Quote it in invented_quote.
- sense_errors: the number of clauses whose meaning changes (who did what, what a term or dose is). Nuance, a clumsy phrase or a romanisation slip is not a sense error. from_ocr: true if a sense error comes from the transcription, not the translation.
- verdict: one of fine | minor | sense-error | omission | invented | wrong-leaf.
- margin_furniture_in_english: true if the leaf's margin furniture (the 欽定四庫全書 running head, the book title, juan number or folio number in the fold) is rendered as English in the translation body as though it were text (e.g. "Chapter 34, sheet 23"). Furniture left out, or kept inside a markup tag such as <header>, <margin>, <page-num>, <folio> or <meta>, is false. Quote it in margin_quote.
- next_leaf_bleed: true if the candidate carries words that are on the NEXT page and not on this one, a clause or more (for example it completes this leaf's broken-off last sentence with the next page's words). Finishing one broken word at the very edge is not bleed. Quote it in bleed_quote. prev_leaf_bleed: the same for the PREVIOUS page.

Answer with one JSON object only: {"accept": bool, "fidelity": n, "defects": [{"class": "O6", "quote": "...", "severity": "misleads", "what": "a few words"}], "reader_note": "...", "wrong_leaf": bool, "invented": bool, "invented_quote": "", "sense_errors": n, "from_ocr": bool, "verdict": "fine", "margin_furniture_in_english": bool, "margin_quote": "", "next_leaf_bleed": bool, "prev_leaf_bleed": bool, "bleed_quote": "", "note": "one line of evidence"}`;
}
const parseVerdict = (t) => {
  const s = String(t || ''); const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { const v = JSON.parse(s.slice(a, b + 1)); return typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && typeof v.wrong_leaf === 'boolean' && typeof v.next_leaf_bleed === 'boolean' ? v : null; } catch { return null; }
};

async function packet() {
  const arms = (arg('arms') || 'A,B,C').split(',');
  fs.mkdirSync(path.join(J, 'img'), { recursive: true });
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const pages = client.db('bookstore').collection('pages');
  const items = [], key = {};
  const rng = makeRng(56001);
  const add = (it, k) => { const id = createHash('sha256').update(`${it.page_id}|${k.arm}|${it.text}`).digest('hex').slice(0, 16); items.push({ id, ...it }); key[id] = { ...k, page_id: it.page_id, book_id: it.book_id }; };
  const ctx = {};
  const allPages = arg('pages') === 'all';
  for (const b of draw.books) for (const pg of (allPages ? b.block : b.block.filter((p) => p.page_id === b.drawn_page_id))) {
    const n = pg.page_number;
    const near = await pages.find({ book_id: b.book_id, page_number: { $in: [n - 1, n, n + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
    const ocrOf = (k) => near.find((p) => p.page_number === k)?.ocr?.data ?? null;
    const img = path.join(J, 'img', `${pg.page_id}.jpg`);
    if (!fs.existsSync(img)) { const r = await fetch(pg.image); if (!r.ok) throw new Error(`${pg.page_id}: image ${r.status}`); fs.writeFileSync(img, Buffer.from(await r.arrayBuffer())); }
    const c0 = { source: ocrOf(n), prev_ocr: ocrOf(n - 1), next_ocr: ocrOf(n + 1), image: img };
    if (pg.page_id === b.drawn_page_id) ctx[b.book_id] = c0;
    const common = { page_id: pg.page_id, book_id: b.book_id, page_number: n, book_title: b.title, ...c0 };
    for (const arm of arms) {
      const m = metaOf(arm, pg.page_id), t = body(readOf(arm, pg.page_id));
      if (!t || m?.exit !== 0 || FILTER_NOTICE.test(t)) { key[`none-${arm}-${pg.page_id}`] = { arm, page_id: pg.page_id, book_id: b.book_id, no_read: true, error_class: FILTER_NOTICE.test(t) ? 'gemini-filter-notice (apply refuses: reply cut before <<<END>>>)' : m?.error_class ?? 'missing' }; continue; }
      add({ ...common, text: t }, { arm });
    }
  }
  await client.close();
  if (allPages) { writePacket(items, key, rng); return; }
  // Controls: seeded, from books whose drawn page has a next page inside the block (bleed) / any (wrong leaf).
  const shuffled = [...draw.books]; for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const bleedBooks = shuffled.filter((b) => b.position < 4).slice(0, 2);
  for (const b of bleedBooks) {
    const nextId = b.block[b.position].page_id;
    const moved = firstSentence(readOf('A', nextId));
    if (!moved) continue;
    add({ page_id: b.drawn_page_id, book_id: b.book_id, page_number: b.drawn_page_number, book_title: b.title, ...ctx[b.book_id], text: `${body(readOf('A', b.drawn_page_id))}\n${moved}` }, { arm: 'CTL-bleed', planted: moved });
  }
  const wl = shuffled.filter((b) => !bleedBooks.includes(b)).slice(0, 2);
  wl.forEach((b, i) => {
    const other = shuffled[shuffled.length - 1 - i];
    add({ page_id: b.drawn_page_id, book_id: b.book_id, page_number: b.drawn_page_number, book_title: b.title, ...ctx[b.book_id], text: body(readOf('A', other.drawn_page_id)) }, { arm: 'CTL-wrongleaf', planted_from: other.drawn_page_id });
  });
  writePacket(items, key, rng);
}
function writePacket(items, key, rng) {
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  fs.writeFileSync(path.join(J, 'items.json'), JSON.stringify(items, null, 1));
  fs.writeFileSync(path.join(J, 'key.json'), JSON.stringify(key, null, 1));
  console.log(`${items.length} items (${Object.values(key).filter((k) => k.no_read).length} arm pages with no read); key in ${J}/key.json`);
}

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
const CLAUDE = fs.existsSync('/usr/bin/claude') ? '/usr/bin/claude' : path.join(process.env.HOME || '/root', '.local/bin/claude');
function call(prompt, cwd, transcript) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = fs.openSync(transcript, 'w');
    const child = spawn(CLAUDE, ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd, stdio: ['pipe', out, out], env: claudeEnv() });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60e3);
    child.on('close', (code) => {
      clearTimeout(timer); fs.closeSync(out);
      const lines = fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const res = lines.findLast((l) => l.type === 'result') || {};
      const readImage = lines.some((l) => l.type === 'assistant' && (l.message?.content || []).some((c) => c.type === 'tool_use' && c.name === 'Read' && /page\.jpg$/.test(c.input?.file_path || '')));
      resolve({ code, text: String(res.result ?? ''), is_error: !!res.is_error, usage: res.usage ?? null, cost: res.total_cost_usd ?? null, model: Object.keys(res.modelUsage || {})[0] ?? null, read_image: readImage, secs: (Date.now() - t0) / 1000 });
    });
  });
}

async function judge() {
  const items = JSON.parse(fs.readFileSync(path.join(J, 'items.json'), 'utf8'));
  const file = path.join(J, 'verdicts.jsonl');
  if (arg('reuse')) {
    const have = new Set(jsonl(file).filter((r) => r.verdict && r.read_image).map((r) => r.id));
    const want = new Set(items.map((i) => i.id));
    const got = jsonl(path.join(S, arg('reuse'), 'verdicts.jsonl')).filter((r) => r.verdict && r.read_image && want.has(r.id) && !have.has(r.id));
    for (const r of got) fs.appendFileSync(file, JSON.stringify({ ...r, reused_from: arg('reuse') }) + '\n');
    console.log(`reused ${got.length} verdicts from ${arg('reuse')}`);
  }
  const done = new Set(jsonl(file).filter((r) => r.verdict && r.read_image).map((r) => r.id));
  const queue = items.filter((it) => !done.has(it.id));
  fs.mkdirSync(path.join(J, 'transcripts'), { recursive: true });
  console.log(`${items.length} items, ${queue.length} to judge`);
  let stop = null;
  const worker = async () => {
    while (queue.length && !stop) {
      const it = queue.shift();
      const cwd = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'siku-judge-'));
      fs.copyFileSync(it.image, path.join(cwd, 'page.jpg'));
      let r, v = null;
      for (let attempt = 0; attempt < 2 && !(v && r.read_image); attempt++) {
        r = await call(sikuPrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), cwd, path.join(J, 'transcripts', `${it.id}.jsonl`));
        if (/usage limit|limit reached|hit your (?:usage )?limit|out of extra usage/i.test(r.text) && r.is_error) { stop = r.text.slice(0, 200); break; }
        v = r.is_error ? null : parseVerdict(r.text);
      }
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: v, read_image: !!r.read_image, raw: v ? undefined : r.text.slice(0, 500), model: r.model, usage: r.usage, list_usd: r.cost, secs: Math.round(r.secs), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.id}: ${v ? `accept=${v.accept} f${v.fidelity} ${v.verdict}${v.margin_furniture_in_english ? ' MARGIN' : ''}${v.next_leaf_bleed ? ' BLEED' : ''}` : 'NO VERDICT'} read=${r.read_image} (${Math.round(r.secs)}s)`);
    }
  };
  await Promise.all(Array.from({ length: Number(arg('jobs') || 4) }, worker));
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}

function score() {
  const items = new Map(JSON.parse(fs.readFileSync(path.join(J, 'items.json'), 'utf8')).map((i) => [i.id, i]));
  const key = JSON.parse(fs.readFileSync(path.join(J, 'key.json'), 'utf8'));
  const V = new Map(jsonl(path.join(J, 'verdicts.jsonl')).filter((r) => r.verdict && r.read_image).map((r) => [r.id, r.verdict]));
  const all = jsonl(path.join(J, 'verdicts.jsonl'));
  const wrongText = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');
  const arms = [...new Set(Object.values(key).map((k) => k.arm))].filter((a) => !a.startsWith('CTL')).sort();
  const out = { generated_at: new Date().toISOString(), judge: 'claude-opus-5-5 (claude -p, --restricted, Read only), route-judge-6740 judgePrompt + the Siku lane spot-check rubric + margin/bleed flags, one output per call against the page image, blind; a verdict counts only if its transcript shows page.jpg opened', draw: { seed: draw.seed, frame_books: draw.frame_books, books: draw.books.length }, calls: all.length, judge_list_usd_equiv: +all.reduce((s, r) => s + (r.list_usd || 0), 0).toFixed(2), unread_image_rows: all.filter((r) => r.verdict && !r.read_image).length, arms: {}, controls: {}, paired: {} };
  const byArm = {};
  const PAGES = [...new Map(Object.values(key).filter((k) => !k.arm.startsWith('CTL')).map((k) => [k.page_id, k.book_id])).entries()];
  out.pages = PAGES.length;
  for (const arm of arms) {
    // A drawn page whose read failed counts as not accepted (the #7517 convention); it is reported apart.
    const rows = PAGES.map(([pid, bid]) => {
      const k = Object.entries(key).find(([, x]) => x.arm === arm && x.page_id === pid);
      if (!k) return { book: bid, page: pid, missing: true };
      if (k[1].no_read) return { book: bid, page: pid, no_read: true, error_class: k[1].error_class };
      const v = V.get(k[0]);
      return v ? { book: bid, page: pid, v } : { book: bid, page: pid, unjudged: true };
    });
    byArm[arm] = new Map(rows.map((r) => [r.page, r]));
    const got = rows.filter((r) => r.v || r.no_read);
    const flag = (f) => got.filter((r) => r.v && f(r.v)).length;
    const acc = got.filter((r) => r.v?.accept).length;
    out.arms[arm] = {
      n: got.length, books: new Set(got.map((r) => r.book)).size, no_read: rows.filter((r) => r.no_read).map((r) => ({ book: r.book, page: r.page, error_class: r.error_class })), unjudged: rows.filter((r) => r.unjudged).length,
      accept: `${acc}/${got.length}`, accept_rate: got.length ? +(acc / got.length).toFixed(3) : null, accept_ci: clusterCI(got.map((r) => ({ book: r.book, v: r.v?.accept ? 1 : 0 })), 5600),
      wrong_text_pages: `${flag(wrongText)}/${got.length}`, fidelity_mean: +(got.filter((r) => r.v).reduce((s, r) => s + Number(r.v.fidelity), 0) / Math.max(1, got.filter((r) => r.v).length)).toFixed(2),
      wrong_leaf: flag((v) => v.wrong_leaf), invented: flag((v) => v.invented), sense_error_pages: flag((v) => Number(v.sense_errors) > 0), sense_errors_total: got.reduce((s, r) => s + Number(r.v?.sense_errors || 0), 0),
      margin_furniture_in_english: flag((v) => v.margin_furniture_in_english), next_leaf_bleed: flag((v) => v.next_leaf_bleed), prev_leaf_bleed: flag((v) => v.prev_leaf_bleed),
      verdicts: Object.fromEntries(['fine', 'minor', 'sense-error', 'omission', 'invented', 'wrong-leaf'].map((x) => [x, flag((v) => v.verdict === x)])),
      lane_bar: (() => { const n = got.filter((r) => r.v).length, wl = flag((v) => v.wrong_leaf), inv = flag((v) => v.invented), se = flag((v) => Number(v.sense_errors) > 0); return { n, wrong_leaf: wl, invented: inv, sense: se, pass: n > 0 && wl === 0 && inv === 0 && se * 3 <= n }; })(),
      flagged_pages: got.filter((r) => r.v && (r.v.margin_furniture_in_english || r.v.next_leaf_bleed || r.v.prev_leaf_bleed || r.v.invented || r.v.wrong_leaf)).map((r) => ({ book: r.book, page: r.page, margin: r.v.margin_quote || null, bleed: r.v.bleed_quote || null, invented: r.v.invented_quote || null, wrong_leaf: r.v.wrong_leaf, note: r.v.note })),
    };
  }
  for (const [id, k] of Object.entries(key)) if (k.arm?.startsWith('CTL')) {
    const v = V.get(id);
    const caught = !v ? null : k.arm === 'CTL-bleed' ? (v.next_leaf_bleed || !v.accept) : (v.wrong_leaf || !v.accept);
    (out.controls[k.arm] ||= []).push({ page_id: k.page_id, judged: !!v, caught, flag: v ? (k.arm === 'CTL-bleed' ? v.next_leaf_bleed : v.wrong_leaf) : null, accept: v?.accept ?? null });
  }
  // Paired against A, by book: the difference in accept rate, with a by-book bootstrap.
  const rnd = makeRng(56002);
  for (const arm of arms.filter((a) => a !== 'A')) {
    const pairs = PAGES.map(([pid]) => [byArm.A.get(pid), byArm[arm].get(pid)]).filter(([a, x]) => a && x && (a.v || a.no_read) && (x.v || x.no_read));
    const m = (xs) => xs.reduce((s, y) => s + y, 0) / xs.length;
    // By-book cluster bootstrap of the paired difference (a page's book is its unit).
    const diffOf = (f) => {
      const units = [...new Set(pairs.map(([a]) => a.book))].map((b) => pairs.filter(([a]) => a.book === b).map(([a, x]) => f(x) - f(a)));
      const d = units.flat();
      const boots = Array.from({ length: 4000 }, () => { const s = []; for (let i = 0; i < units.length; i++) s.push(...units[Math.floor(rnd() * units.length)]); return m(s); }).sort((a, b) => a - b);
      return { diff: +m(d).toFixed(3), ci95: [+boots[100].toFixed(3), +boots[3899].toFixed(3)], worse: d.filter((x) => x < 0).length, better: d.filter((x) => x > 0).length };
    };
    const acc = diffOf((r) => (r.v?.accept ? 1 : 0));
    const margin = diffOf((r) => (r.v?.margin_furniture_in_english ? 1 : 0));
    const bleed = diffOf((r) => (r.v?.next_leaf_bleed ? 1 : 0));
    out.paired[`${arm}-A`] = { n: pairs.length, accept_diff: acc.diff, ci95: acc.ci95, lost: acc.worse, gained: acc.better, margin_flag_diff: margin, next_leaf_bleed_diff: bleed };
  }
  fs.writeFileSync(path.join(J, 'score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, (k, v) => (k === 'flagged_pages' ? undefined : v), 1));
}

const STAGE = process.argv[2];
if (STAGE === 'packet') await packet();
else if (STAGE === 'judge') await judge();
else if (STAGE === 'score') score();
else { console.error('usage: judge.mjs packet|judge|score --scratch=DIR'); process.exit(2); }
