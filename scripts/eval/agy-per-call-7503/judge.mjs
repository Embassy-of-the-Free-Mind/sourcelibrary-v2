#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-translate.mjs claudeCall — the sealed `claude -p` call and the subscription env strip
// are copied from it; it runs with no tools, and a judge must open the page image, so this one allows Read only.
/**
 * #7503 blind judge: Opus via `claude -p`, one page per call, given the page image, its OCR (and the neighbouring
 * pages' OCR, to see cross-page bleed) and the versions of prep.mjs's packet under letters. The arm key is not in
 * the prompt. Writes DIR/judge/out/<page_id>.json (the parsed verdict, the raw reply and the call's usage).
 *
 *   node scripts/eval/agy-per-call-7503/judge.mjs --scratch=DIR [--jobs=4] [--only=id,id]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const J = path.join(S, 'judge');
const JOBS = Number(arg('jobs') || 4);
const ONLY = arg('only')?.split(',');
fs.mkdirSync(path.join(J, 'out'), { recursive: true });

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

export function judgePrompt(p) {
  const labels = p.versions.map((v) => v.label);
  return `You are checking English translations of one page of a classical Chinese book (Siku Quanshu, ${p.book_title}, page ${p.page_number}) against the source.

First open the page image with the Read tool: ${path.basename(p.image)} (in the current directory). The OCR below is the source text the translators were given; use the image only to settle what the page really says where the OCR is doubtful. A version is not at fault for text the OCR itself lacks.

OCR OF THIS PAGE (the source):
<<<
${p.ocr}
>>>

OCR OF THE PREVIOUS PAGE (context only; NOT part of this page):
<<<
${p.prev_ocr ?? '(none)'}
>>>

OCR OF THE NEXT PAGE (context only; NOT part of this page):
<<<
${p.next_ocr ?? '(none)'}
>>>

${p.versions.length} TRANSLATIONS of this page, labelled ${labels.join(', ')}, in no particular order. Translator notes in <note> tags and markup tags (<header>, <meta>, <term>, <unclear>) are allowed and are not additions.

${p.versions.map((v) => `=== VERSION ${v.label} ===\n${v.text}\n=== END ${v.label} ===`).join('\n\n')}

Judge EACH version independently against the source. Report only real faults, each as a short phrase quoting or naming the place:
- omissions: a sentence or more of this page's source text (or a whole clause carrying content) with no rendering. Running heads (欽定四庫全書, 卷 numbers), folio marks and the like do not count.
- additions: content in the translation body that is not in this page's source (not a <note>), i.e. invented text.
- sense_errors: a clause whose meaning is wrong (mistranslated, reversed, wrong subject), not a style or word-choice preference.
- cross_page_bleed: text that renders the PREVIOUS or NEXT page's source, i.e. a clause or more that belongs to a neighbouring page. Completing one broken word or phrase at the page edge is not bleed.
- names_garbled: a person, place, book or technical term rendered wrongly (wrong name, wrong person, a term mangled).
- usable: true if a reader of this page would be served correctly: no omission, no addition, no bleed, and no sense error that changes what a passage says. Minor word choice does not make it unusable.

Reply with ONE JSON object and nothing else, no code fence:
{"versions":{${labels.map((l) => `"${l}":{"omissions":[],"additions":[],"sense_errors":[],"cross_page_bleed":[],"names_garbled":[],"usable":true,"comment":"one line"}`).join(',')}}}`;
}

function call(prompt, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('claude', ['-p', '--model', 'opus', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON */ }
      resolve({ code, text: String(j.result ?? ''), is_error: !!j.is_error, usage: j.usage ?? null, cost: j.total_cost_usd ?? null, model: Object.keys(j.modelUsage || {}), err: err.slice(-400), secs: (Date.now() - t0) / 1000 });
    });
  });
}

export function parseVerdict(text) {
  const s = String(text).replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const ids = fs.readdirSync(path.join(J, 'packets')).map((f) => f.replace(/\.json$/, '')).filter((id) => !ONLY || ONLY.includes(id));
const queue = ids.filter((id) => { const f = path.join(J, 'out', `${id}.json`); if (!fs.existsSync(f)) return true; try { return !JSON.parse(fs.readFileSync(f, 'utf8')).verdict; } catch { return true; } });
console.log(`${ids.length} packets, ${queue.length} to judge, ${JOBS} at a time`);
let stop = null;
async function worker() {
  while (queue.length && !stop) {
    const id = queue.shift();
    const p = JSON.parse(fs.readFileSync(path.join(J, 'packets', `${id}.json`), 'utf8'));
    const cwd = path.join(J, 'cwd', id);
    fs.mkdirSync(cwd, { recursive: true });
    fs.copyFileSync(p.image, path.join(cwd, path.basename(p.image)));
    let r, verdict = null;
    for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
      r = await call(judgePrompt(p), cwd);
      if (/usage limit|limit reached|hit your limit|out of extra usage/i.test(r.text + r.err)) { stop = `usage limit: ${r.text.slice(0, 200)}`; break; }
      verdict = r.is_error ? null : parseVerdict(r.text);
      const labels = p.versions.map((v) => v.label);
      if (verdict && !labels.every((l) => verdict.versions?.[l])) verdict = null;
    }
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.writeFileSync(path.join(J, 'out', `${id}.json`), JSON.stringify({ page_id: id, verdict, raw: r.text, usage: r.usage, cost_list_usd: r.cost, model: r.model, secs: r.secs, code: r.code, err: r.err }, null, 1));
    console.log(`  ${id}: ${verdict ? 'ok' : 'NO VERDICT'} (${Math.round(r.secs)}s) ${verdict ? Object.entries(verdict.versions).map(([l, v]) => `${l}:${v.usable ? 'U' : 'x'}`).join(' ') : r.err.slice(-120)}`);
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
