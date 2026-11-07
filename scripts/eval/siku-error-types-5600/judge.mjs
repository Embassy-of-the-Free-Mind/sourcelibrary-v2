#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/judge.mjs — the sealed `claude -p --model opus` call with Read only (to open
// the image), the subscription env strip, the limit stop and the JSON parse are copied from it. Its prompt counts
// faults per arm in four buckets; this one asks for every error as a span with a kind, a risk and its evidence.
/**
 * #5600 error-type judge. One page per call, blind to arm (packets are P01…P52). Opus opens the page image, reads the
 * OCR and the served English with the previous page's tail, and lists every error as
 * {source_span, english_span, kind, risk, evidence} plus a page verdict (show / caveat / dont).
 * Writes DIR/out-pass<N>/<name>.json. Pass 2 is the independent second read on a subset (--only).
 *
 *   node scripts/eval/siku-error-types-5600/judge.mjs --scratch=DIR [--pass=1] [--jobs=4] [--only=P01,P02]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = path.resolve(arg('scratch'));
const PASS = Number(arg('pass') || 1);
const JOBS = Number(arg('jobs') || 4);
const ONLY = arg('only')?.split(',');
const OUT = path.join(S, `out-pass${PASS}`);
fs.mkdirSync(OUT, { recursive: true });

export const KINDS = ['INVENTED', 'WRONG-SENSE', 'OCR-CARRIED', 'OMITTED', 'SEAM', 'JUNK', 'STYLE'];
export const RISKS = ['HIGH', 'MEDIUM', 'LOW'];

function claudeEnv() { const e = { ...process.env }; for (const k of Object.keys(e)) if (/^ANTHROPIC_|^CLAUDE_CODE_USE_|^OPENROUTER/.test(k)) delete e[k]; return e; }

export function judgePrompt(p) {
  return `You are checking the English translation that readers are served for one page of a classical Chinese book (Siku Quanshu manuscript copy, ${p.book_title}, page ${p.page_number}) against the page itself.

First open the page image with the Read tool: ${path.basename(p.image)} (in the current directory). The OCR below is the source text the translator was given. Use the image to check the OCR wherever it matters: an OCR misread can be translated faithfully and still mislead the reader.

OCR OF THIS PAGE (the translator's source):
<<<
${p.ocr}
>>>

LAST LINES OF THE PREVIOUS PAGE (context, for the seam; not part of this page)
source: ${p.prev_ocr_tail ?? '(none)'}
english: ${p.prev_english_tail ?? '(none)'}

FIRST LINES OF THE NEXT PAGE'S SOURCE (context only): ${p.next_ocr_head ?? '(none)'}

THE ENGLISH SERVED FOR THIS PAGE (<meta> and <note> tags are the translator's notes; markup such as <header>, <term> is allowed):
<<<
${p.english}
>>>

List EVERY error in the English of this page, one entry per error. Kinds (pick the one that best names the cause):
- INVENTED: a name, gloss, fact, date or number in the English (body or note) that is not in the source.
- WRONG-SENSE: a real phrase of a correct source mistranslated so the meaning changes.
- OCR-CARRIED: the OCR misreads the page (check the image) and the English renders the misread faithfully. Use this only when the image shows a different character from the OCR and the difference matters.
- OMITTED: source text (a clause or more carrying content) with no English. Running heads (欽定四庫全書, 卷 numbers) and folio marks do not count.
- SEAM: at the break with the previous or next page: a clause on the wrong page, a phrase split across the break misread, or a word doubled across the break.
- JUNK: OCR furniture, margin or chat text carried into the English as if it were content.
- STYLE: wording only; the meaning is intact.
Risk:
- HIGH: a reader is misled and cannot tell: INVENTED content, or a WRONG-SENSE/OCR-CARRIED/SEAM error that changes who, what, when, or how many.
- MEDIUM: misleading but noticeable, a lost clause a reader would miss, or a citation off by a page.
- LOW: cosmetic.
Evidence: "image" if you settled it from the image, "ocr" if from the OCR text alone, "both" if both.

Then a page verdict: "show" (a reader is served correctly), "caveat" (usable with a warning), or "dont" (a reader would be misled; do not show this English).

Be exact and do not pad: report only real errors, quote the source span in Chinese and the English span verbatim (short). An error-free page has an empty list.

Reply with ONE JSON object and nothing else, no code fence:
{"errors":[{"source_span":"…","english_span":"…","kind":"WRONG-SENSE","risk":"MEDIUM","evidence":"ocr","why":"one line"}],"ocr_matches_image":"yes|mostly|no","verdict":"show|caveat|dont","comment":"one line"}`;
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
const valid = (v) => v && Array.isArray(v.errors) && ['show', 'caveat', 'dont'].includes(v.verdict) && v.errors.every((e) => KINDS.includes(e.kind) && RISKS.includes(e.risk));

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = fs.readdirSync(path.join(S, 'packets')).map((f) => f.replace(/\.json$/, '')).filter((id) => !ONLY || ONLY.includes(id)).sort();
  const queue = ids.filter((id) => { const f = path.join(OUT, `${id}.json`); if (!fs.existsSync(f)) return true; try { return !JSON.parse(fs.readFileSync(f, 'utf8')).verdict; } catch { return true; } });
  console.log(`pass ${PASS}: ${ids.length} packets, ${queue.length} to judge, ${JOBS} at a time`);
  let stop = null;
  async function worker() {
    while (queue.length && !stop) {
      const id = queue.shift();
      const p = JSON.parse(fs.readFileSync(path.join(S, 'packets', `${id}.json`), 'utf8'));
      const cwd = path.join(S, `cwd-pass${PASS}`, id);
      fs.mkdirSync(cwd, { recursive: true });
      fs.copyFileSync(p.image, path.join(cwd, path.basename(p.image)));
      let r, verdict = null;
      for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
        r = await call(judgePrompt(p), cwd);
        if (/usage limit|limit reached|hit your limit|out of extra usage/i.test(r.text + r.err)) { stop = `usage limit: ${r.text.slice(0, 200)}`; break; }
        verdict = r.is_error ? null : parseVerdict(r.text);
        if (!valid(verdict)) verdict = null;
      }
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ name: id, pass: PASS, verdict, raw: r.text, usage: r.usage, cost_list_usd: r.cost, model: r.model, secs: r.secs, code: r.code, err: r.err }, null, 1));
      console.log(`  ${id}: ${verdict ? `${verdict.verdict} ${verdict.errors.length} err (${verdict.errors.filter((e) => e.risk === 'HIGH').length} HIGH)` : 'NO VERDICT ' + r.err.slice(-120)} ${Math.round(r.secs)}s`);
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker));
  if (stop) { console.error(`STOPPED: ${stop}`); process.exit(3); }
}
