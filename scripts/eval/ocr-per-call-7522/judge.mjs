#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/judge.mjs (PR #7518) — the same sealed `claude -p` Opus judge, one page per
// call, versions under letters, the arm key never in the prompt; its prompt judges English against Chinese OCR, and
// this one judges transcriptions against the page IMAGE, with the neighbouring pages' images to tell bleed from invention.
/**
 * #7522 blind judge: Opus via `claude -p`, one page per call. The call's folder holds this.jpg (the page) and
 * prev.jpg / next.jpg (its neighbours), nothing else; Read is the only tool. Writes DIR/judge/out/<page_id>.json.
 *
 *   node scripts/eval/ocr-per-call-7522/judge.mjs --scratch=DIR [--jobs=3] [--only=id,id]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const FAULTS = ['omissions', 'additions', 'cross_page_bleed', 'order_errors', 'misreads'];

export function judgePrompt(p) {
  const labels = p.versions.map((v) => v.label);
  return `You are checking ${p.versions.length} transcriptions (OCR) of one printed page against the page image. The book: ${p.book_title} (${p.published ?? 'date unknown'}; catalogued as ${p.language}). Page ${p.page_number} of the scan.

Open the page image with the Read tool: this.jpg (in the current directory). Read it closely; zoom in your attention on any line you need to check.
For context only: ${p.prev_image ? 'prev.jpg is the PREVIOUS page' : 'there is no previous page image'} and ${p.next_image ? 'next.jpg is the NEXT page' : 'there is no next page image'} of the same book. They are NOT part of this page. Open them when you need to decide whether text in a version belongs to a neighbouring page.

Each transcription starts with metadata tags (<scan-quality>, <language>, <script>, <page-type>, <page-num>, …) and may end with tags such as <vocab>; markup tags (<header>, <footnote>, <margin>, <unclear>, <image>, …) are allowed. Judge the transcribed TEXT, not the tags. Long s written as s, u/v and i/j as printed or normalised, æ/ae, and expanded or kept abbreviations are all acceptable and are not faults.

${p.versions.map((v) => `=== VERSION ${v.label} ===\n${v.text}\n=== END ${v.label} ===`).join('\n\n')}

Judge EACH version independently against this.jpg. Report only real faults, each as a short phrase quoting or naming the place:
- omissions: a line or more of text printed on this page (body, heading, footnote, marginal note, table row) that is missing from the version. A running head, page number, signature mark or catchword left out does not count.
- additions: text in the version that is printed neither on this page nor on either neighbouring page: invented, completed from memory, or repeated.
- cross_page_bleed: text in the version that is printed on the PREVIOUS or NEXT page and not on this one (a word or sentence carried over the page break, a line from the facing page). The catchword printed at the foot of this page is part of this page, not bleed.
- order_errors: lines, paragraphs, columns or notes of this page put in an order that makes the text read wrongly.
- misreads: words read wrongly (a different word, a wrong number, a garbled name). List only the ones you can see; ignore the acceptable variants above.
- usable: true if a reader of this page would be served correctly: no omission, no addition, no bleed, no order error, and misreads few and minor enough that the text still says what the page says.

Reply with ONE JSON object and nothing else, no code fence:
{"versions":{${labels.map((l) => `"${l}":{"omissions":[],"additions":[],"cross_page_bleed":[],"order_errors":[],"misreads":[],"usable":true,"comment":"one line"}`).join(',')}}}`;
}

export function parseVerdict(text) {
  const s = String(text).replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// `claude -p` prefers an API key over the subscription login, and node --env-file loads one: strip it (#6553).
function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }
function call(prompt, cwd) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('/usr/bin/claude', ['-p', '--model', 'opus', '--restricted', '--tools', 'Read', '--allowedTools', 'Read', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv() });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.stdin.end(prompt);
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = {};
      try { j = JSON.parse(out); } catch { /* not JSON */ }
      resolve({ code, text: String(j.result ?? ''), is_error: !!j.is_error, usage: j.usage ?? null, cost: j.total_cost_usd ?? null, model: Object.keys(j.modelUsage || {}), turns: j.num_turns ?? null, err: (err || out).slice(-400), secs: (Date.now() - t0) / 1000 });
    });
  });
}

async function main() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const J = path.join(arg('scratch'), 'judge');
  const JOBS = Number(arg('jobs') || 3);
  const ONLY = arg('only')?.split(',');
  fs.mkdirSync(path.join(J, 'out'), { recursive: true });
  const ids = fs.readdirSync(path.join(J, 'packets')).map((f) => f.replace(/\.json$/, '')).filter((id) => !ONLY || ONLY.includes(id));
  const queue = ids.filter((id) => { const f = path.join(J, 'out', `${id}.json`); if (!fs.existsSync(f)) return true; try { return !JSON.parse(fs.readFileSync(f, 'utf8')).verdict; } catch { return true; } });
  console.log(`${ids.length} packets, ${queue.length} to judge, ${JOBS} at a time`);
  let stop = null;
  const worker = async () => {
    while (queue.length && !stop) {
      const id = queue.shift();
      const p = JSON.parse(fs.readFileSync(path.join(J, 'packets', `${id}.json`), 'utf8'));
      const cwd = path.join(J, 'cwd', id);
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.mkdirSync(cwd, { recursive: true });
      fs.copyFileSync(p.image, path.join(cwd, 'this.jpg'));
      if (p.prev_image) fs.copyFileSync(p.prev_image, path.join(cwd, 'prev.jpg'));
      if (p.next_image) fs.copyFileSync(p.next_image, path.join(cwd, 'next.jpg'));
      let r, verdict = null;
      for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
        r = await call(judgePrompt(p), cwd);
        if (/usage limit|limit reached|hit your limit|out of extra usage/i.test(r.text + r.err)) { stop = `usage limit: ${(r.text || r.err).slice(0, 200)}`; break; }
        verdict = r.is_error ? null : parseVerdict(r.text);
        if (verdict && !p.versions.every((v) => verdict.versions?.[v.label])) verdict = null;
      }
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.writeFileSync(path.join(J, 'out', `${id}.json`), JSON.stringify({ page_id: id, verdict, raw: r.text, usage: r.usage, cost_list_usd: r.cost, model: r.model, turns: r.turns, secs: r.secs, code: r.code, err: r.err }, null, 1));
      console.log(`  ${id}: ${verdict ? 'ok' : 'NO VERDICT'} (${Math.round(r.secs)}s) ${verdict ? Object.entries(verdict.versions).map(([l, v]) => `${l}:${v.usable ? 'U' : 'x'}`).join(' ') : r.err.slice(-160)}`);
    }
  };
  await Promise.all(Array.from({ length: JOBS }, worker));
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
