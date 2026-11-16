#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (judgePrompt translation form, parseVerdict's shape, the sealed
// opusCall, key.json / verdicts-opus.jsonl that paired-arm.mjs scores) and scripts/eval/ocr-doubt-image-8358/
// t2-judge-prompt.md + judge.py (known spots classed carried / repaired / dropped; every statement about the leaf, true
// or false). Neither fits alone: judge.mjs has no spots or leaf claims, and 8358's prompt has no taxonomy or severity
// for the defect rate #106 decides on. This joins them; judgePrompt is imported unchanged. Read-only on production.
/**
 * #106 judge. One sealed Opus `claude -p` a call (Read only, lean flags, through the box's pace guard), the page image as
 * ./page.jpg in the call's own workspace; the stream-json transcript must show the image opened.
 *
 *   node judge.mjs inventory --run=DIR [--conc=4]   misreads in the stored OCR, once a page (DIR/inventory/<page>.json)
 *   node judge.mjs packet    --run=DIR              DIR/judge/{packet.json,key.json} from the arms' outputs
 *   node judge.mjs judge     --run=DIR [--conc=4] [--limit=N]   DIR/judge/verdicts-opus.jsonl (resumable)
 *
 * DIR holds sample.json, pages.json (fetch.mjs), plants.json, out-{T,T2,I,PT,PI}/ (translate.mjs).
 */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { judgePrompt } from '../route-judge-6740/judge.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const RUN = path.resolve(arg('run', '.'));
const CONC = Number(arg('conc', 4));
const J = (f) => JSON.parse(fs.readFileSync(path.join(RUN, f), 'utf8'));
const h = (s) => createHash('sha256').update(`image-translate-106:${s}`).digest('hex');
export const ROUTES = { T: 'agy-text', T2: 'agy-text-again', I: 'agy-image', S: 'stored' };
const QUOTA = /usage limit|limit reached|hit your (?:usage )?limit|rate.?limit|out of extra usage/i;
const LEAN = ['--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--setting-sources', 'local', '--disable-slash-commands', '--no-session-persistence'];

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
/** One sealed Opus call; resolves { text, opened, cls, usage, cost, model }. */
export function opusCall(prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn('claude', ['-p', '--model', 'opus', ...LEAN, '--output-format', 'stream-json', '--verbose'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 1200e3);
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      let res = null, opened = false, model = null;
      for (const l of out.split('\n')) {
        let e; try { e = JSON.parse(l); } catch { continue; }
        if (e.type === 'assistant') for (const c of e.message?.content || []) {
          if (c.type === 'tool_use' && c.name === 'Read' && /page\.jpg$/.test(String(c.input?.file_path || ''))) opened = true;
          model ??= e.message?.model ?? null;
        }
        if (e.type === 'result') res = e;
      }
      const text = String(res?.result ?? '');
      const cls = (res?.is_error || code !== 0) && QUOTA.test(text + out.slice(-2000) + err) ? 'quota' : code !== 0 ? `exit_${code}` : !res ? 'no_result' : null;
      resolve({ text, opened, cls, model, usage: res?.usage ?? null, cost: res?.total_cost_usd ?? null, err: err.slice(-300) });
    });
  });
}
const parseJson = (t) => { const m = String(t).match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };

async function pool(items, fn) {
  const q = items.slice(); let stop = false;
  await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !stop) { const r = await fn(q.shift()); if (r === 'STOP') stop = true; } }));
  return stop;
}
function workspace(imageFile) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'it106-'));
  fs.copyFileSync(imageFile, path.join(ws, 'page.jpg'));
  return ws;
}

// ---- stage 1: misread inventory --------------------------------------------------------------------------------
export const inventoryPrompt = (lang, transcription) => `You are checking an OCR transcription of one page of a historical ${lang} book against the page image. The image is the only authority.

Open the page image with the Read tool: ./page.jpg (in your working directory). Read the page yourself, closely, and compare it with the transcription below.

List the places where the transcription differs from the page in a way that would change what a TRANSLATION says: a different word (not a spelling variant of the same word), a wrong name, number or date, a dropped or added negation, a phrase or line left out or added. Do NOT list: spelling conventions (u/v, i/j, long s, ligatures, accents, abbreviations expanded correctly), punctuation, capitals, line breaks, hyphenation, the library's markup tags, or errors in page furniture (running heads, signatures, catchwords) unless the words are wrong. At most 12, the most consequential first. If the transcription is right everywhere that matters, give an empty list.

For each: "transcription" = the transcription's wrong reading, VERBATIM (at most 10 words, copied exactly so it can be found; "" for something left out), "page" = what the page has (at most 10 words, in the original language), "context" = at most 12 words of the transcription around the spot, copied exactly, "kind" = word | name | number | negation | omission | addition.

Also "page_matches": false only if the transcription is plainly the text of some other page.

Reply with ONLY a JSON object: {"page_matches": true, "misreads": [{"transcription": "...", "page": "...", "context": "...", "kind": "word"}]}

TRANSCRIPTION:
"""
${transcription}
"""`;

async function inventory() {
  const S = J('sample.json'), P = J('pages.json');
  const dir = path.join(RUN, 'inventory'); fs.mkdirSync(dir, { recursive: true });
  const todo = S.filter((s) => !fs.existsSync(path.join(dir, `${s.page_id}.json`)));
  console.log(`inventory: ${todo.length} of ${S.length} to do`);
  await pool(todo, async (s) => {
    const p = P[s.page_id];
    for (let attempt = 0; attempt < 2; attempt++) {
      const ws = workspace(p.image_file);
      const r = await opusCall(inventoryPrompt(s.lang, p.stored_ocr), ws); fs.rmSync(ws, { recursive: true, force: true });
      if (r.cls === 'quota') { console.error('QUOTA', r.text.slice(0, 200)); return 'STOP'; }
      const v = parseJson(r.text);
      if (v && Array.isArray(v.misreads) && r.opened) {
        fs.writeFileSync(path.join(dir, `${s.page_id}.json`), JSON.stringify({ page_id: s.page_id, lang: s.lang, result: v, opened: r.opened, model: r.model, usage: r.usage, cost: r.cost }));
        console.log(s.page_id, 'misreads', v.misreads.length); return null;
      }
      console.log(s.page_id, 'retry', r.cls, r.opened, r.text.slice(0, 120));
    }
    return null;
  });
}

// ---- stage 2: packet ------------------------------------------------------------------------------------------
const spotLine = (n, m) => `${n}. The page has «${m.page}» where the transcription has «${m.transcription || '(nothing: left out)'}»${m.context ? ` (transcription context: «${m.context}»)` : ''}.`;
/** A planted English error the judge must find (control): a number changed, else a negation added. */
export function plantEnglish(text) {
  const num = [...text.matchAll(/(?<![\w.,])(\d{1,4})(?![\w.,]?\d)/g)].filter((m) => !/^0/.test(m[1]));
  if (num.length) {
    const m = num[Math.floor(num.length / 2)], to = String(Number(m[1]) + 7);
    return { text: text.slice(0, m.index) + to + text.slice(m.index + m[1].length), before: m[1], after: to, span: text.slice(Math.max(0, m.index - 30), m.index) + to, kind: 'number' };
  }
  const v = [...text.matchAll(/\b(is|was|are|were|can|will|should|must) (?!not\b)/g)];
  if (v.length) {
    const m = v[Math.floor(v.length / 2)], ins = `${m[1]} not `;
    return { text: text.slice(0, m.index) + ins + text.slice(m.index + m[0].length), before: m[0].trim(), after: ins.trim(), span: ins + text.slice(m.index + m[0].length, m.index + m[0].length + 25), kind: 'negation' };
  }
  return null;
}

function packet() {
  const S = J('sample.json'), P = J('pages.json'), plants = J('plants.json');
  const inv = (pid) => { const f = path.join(RUN, 'inventory', `${pid}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).result.misreads || [] : null; };
  const out = (arm, key) => { const f = path.join(RUN, `out-${arm}`, `${key}.json`); if (!fs.existsSync(f)) return null; const o = JSON.parse(fs.readFileSync(f, 'utf8')); return o.english && !o.problem && !o.cls ? o : null; };
  const items = [], key = [], missing = [];
  const add = (row, it) => { const id = `j${h(`${row.kind}:${row.route}:${row.page_id}:${row.extra || ''}`).slice(0, 12)}`; items.push({ task: 'translation', ...it, id }); key.push({ id, judged_as: id, ...row }); return id; };
  for (const s of S) {
    const p = P[s.page_id], sp = inv(s.page_id);
    if (!sp) { missing.push(`inventory ${s.page_id}`); continue; }
    const spots = sp.map((m, i) => spotLine(i + 1, m));
    for (const arm of ['T', 'T2', 'I', 'S']) {
      const english = arm === 'S' ? p.stored_english : out(arm, s.page_id)?.english;
      if (!english) { if (arm !== 'S') missing.push(`${arm} ${s.page_id}`); continue; }
      add({ cell: s.lang, route: ROUTES[arm], kind: 'item', page_id: s.page_id, book_id: s.book_id }, { lang: s.lang, image_file: p.image_file, source: p.stored_ocr, text: english, spots, n_spots: spots.length });
    }
  }
  // Planted OCR misreads: T and I translated the planted transcription; the planted spot is listed first.
  for (const pl of plants) {
    const s = S.find((x) => x.page_id === pl.page_id), p = P[pl.page_id], sp = inv(pl.page_id) || [];
    const planted = p.stored_ocr.replace(pl.true, pl.planted);
    const spots = [spotLine(1, { page: pl.true, transcription: pl.planted, context: '' }), ...sp.map((m, i) => spotLine(i + 2, m))];
    for (const arm of ['T', 'I']) {
      const o = out(`P${arm}`, `pl-${pl.page_id}`);
      if (!o) { missing.push(`P${arm} ${pl.page_id}`); continue; }
      add({ cell: s.lang, route: ROUTES[arm], kind: 'planted_ocr', page_id: pl.page_id, book_id: s.book_id, plant: pl }, { lang: s.lang, image_file: p.image_file, source: planted, text: o.english, spots, n_spots: spots.length });
    }
  }
  // Wrong-page controls: one per arm per language; the English of page k shown with the image and OCR of page k+1.
  for (const lang of ['Latin', 'German', 'French']) {
    const L = S.filter((s) => s.lang === lang).sort((a, b) => h(`wp:${a.page_id}`).localeCompare(h(`wp:${b.page_id}`)));
    let i = 0;
    for (const arm of ['T', 'T2', 'I', 'S']) {
      for (; i < L.length - 1; i++) {
        const a = L[i], b = L[i + 1];
        const english = arm === 'S' ? P[a.page_id].stored_english : out(arm, a.page_id)?.english;
        if (!english) continue;
        add({ cell: lang, route: ROUTES[arm], kind: 'wrong_page', page_id: b.page_id, book_id: b.book_id, text_of: a.page_id }, { lang, image_file: P[b.page_id].image_file, source: P[b.page_id].stored_ocr, text: english, spots: [], n_spots: 0 });
        i += 2; break;
      }
    }
  }
  // Judge plants: 3 T outputs a language (not plant pages) with one planted wrong number or negation.
  const plantPages = new Set(plants.map((p) => p.page_id));
  for (const lang of ['Latin', 'German', 'French']) {
    const L = S.filter((s) => s.lang === lang && !plantPages.has(s.page_id)).sort((a, b) => h(`jp:${a.page_id}`).localeCompare(h(`jp:${b.page_id}`)));
    let n = 0;
    for (const s of L) {
      if (n >= 3) break;
      const o = out('T', s.page_id); const sp = inv(s.page_id); if (!o || !sp) continue;
      const pe = plantEnglish(o.english); if (!pe) continue;
      add({ cell: lang, route: ROUTES.T, kind: 'planted', page_id: s.page_id, book_id: s.book_id, plant: { kind: pe.kind, before: pe.before, after: pe.after, span: pe.span } },
        { lang, image_file: P[s.page_id].image_file, source: P[s.page_id].stored_ocr, text: pe.text, spots: sp.map((m, i) => spotLine(i + 1, m)), n_spots: sp.length });
      n++;
    }
  }
  // Repeats: 5 T and 5 I items judged again under another id.
  for (const arm of ['T', 'I']) {
    const its = key.filter((k) => k.kind === 'item' && k.route === ROUTES[arm]).sort((a, b) => h(`rp:${a.page_id}`).localeCompare(h(`rp:${b.page_id}`))).slice(0, 5);
    for (const k of its) { const it = items.find((x) => x.id === k.id); add({ cell: k.cell, route: k.route, kind: 'repeat', page_id: k.page_id, book_id: k.book_id, extra: 'repeat' }, { ...it, id: undefined }); }
  }
  const dir = path.join(RUN, 'judge'); fs.mkdirSync(dir, { recursive: true });
  const order = items.map((it) => it.id).sort((a, b) => h(`order:${a}`).localeCompare(h(`order:${b}`)));
  const byId = new Map(items.map((it) => [it.id, it]));
  fs.writeFileSync(path.join(dir, 'packet.json'), JSON.stringify({ items: order.map((id) => { const { id: _drop, ...rest } = byId.get(id); return { id, ...rest }; }) }));
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 0));
  const tally = {}; for (const k of key) tally[`${k.kind}/${k.route}`] = (tally[`${k.kind}/${k.route}`] ?? 0) + 1;
  console.log(`packet: ${items.length} items`, tally, 'missing', missing.length, missing.slice(0, 10));
}

// ---- stage 3: verdicts ----------------------------------------------------------------------------------------
export function armPrompt(it) {
  const base = judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)');
  const head = base.slice(0, base.lastIndexOf('Answer with one JSON object only'));
  return `${head}SPOTS: places where the transcription is known to differ from the page (possibly none). For each, find the passage of the candidate that renders it, quote it (english_quote, at most 25 words, "" if none) and choose one outcome: "carried" (the candidate follows the transcription's wrong reading, even if a note flags it), "repaired" (the candidate renders what the page has), "dropped" (the passage is left out), or "other" (one-line reason). A carried spot that misleads a reader is ALSO listed under defects.
${it.spots.length ? it.spots.join('\n') : '(none)'}

LEAF CLAIMS: list every statement in the candidate, including notes and brackets, about what the page or the original physically shows or reads (e.g. "the original reads X", "illegible", "the scan shows", "[damaged]", "a misprint for", "corrected from the image", a description of a picture). For each: english_quote and true_of_page (true or false, checked against the image) with a one-line why. Empty list if none.

Answer with one JSON object only: {"accept": bool, "fidelity": n, "defects": [{"class": "O6", "quote": "...", "severity": "misleads", "what": "a few words"}], "reader_note": "...", "spots": [{"n": 1, "english_quote": "...", "outcome": "carried", "reason": ""}], "leaf_claims": [{"english_quote": "...", "true_of_page": false, "why": "..."}]}`;
}
const validArm = (v, it) => v && typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 && Array.isArray(v.defects ?? [])
  && Array.isArray(v.spots ?? []) && (v.spots ?? []).length === it.n_spots && Array.isArray(v.leaf_claims ?? []);

async function judge() {
  const dir = path.join(RUN, 'judge');
  const items = J('judge/packet.json').items;
  const file = path.join(dir, 'verdicts-opus.jsonl');
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => r.id) : []);
  const todo = items.filter((it) => !done.has(it.id)).slice(0, Number(arg('limit', Infinity)));
  console.log(`judge: ${todo.length} of ${items.length} to do`);
  const stopped = await pool(todo, async (it) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ws = workspace(it.image_file); const t0 = Date.now();
      const r = await opusCall(armPrompt(it), ws); fs.rmSync(ws, { recursive: true, force: true });
      if (r.cls === 'quota') { console.error('QUOTA', r.text.slice(0, 200)); return 'STOP'; }
      const v = parseJson(r.text);
      if (validArm(v, it) && r.opened) {
        fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: v, opened: r.opened, model: r.model, usage: r.usage, cost: r.cost, secs: Math.round((Date.now() - t0) / 1000) }) + '\n');
        console.log(it.id, 'accept', v.accept, 'fid', v.fidelity, 'defects', v.defects.length); return null;
      }
      console.log(it.id, 'retry', r.cls, 'opened', r.opened, (r.text || r.err).slice(0, 160));
    }
    fs.appendFileSync(file, JSON.stringify({ id: it.id, verdict: null }) + '\n');
    return null;
  });
  if (stopped) process.exit(3);
}

const MAIN = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (!MAIN) { /* imported for its exports */ } else if (STAGE === 'inventory') await inventory();
else if (STAGE === 'packet') packet();
else if (STAGE === 'judge') await judge();
else if (STAGE) { console.error('usage: judge.mjs inventory|packet|judge --run=DIR'); process.exit(2); }
