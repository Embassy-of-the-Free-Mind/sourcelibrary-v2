// PRIOR ART: none for this step — searched scripts/eval/INDEX.md ("verify span", "image confirms") and the #8140 /
// #8134 judges, which rate whole pages, not short spans. Uses calls.mjs claudeCall (Opus, Read tool, the page image).
/**
 * #8171 group C: edits go only into spans the page image confirms. For each C passage (draw order), up to 6 candidate
 * sites are taken in a seeded order (lib.chooseEdits, 10 characters apart); each site's window — 4 characters either
 * side of the span that would change — is shown to Opus with the page image, which says whether the page has exactly
 * those characters in that order. One decoy per call (the first site's window WITH its edit) must come back "no".
 * Writes <priv>/verify-C.jsonl. A site whose window is not confirmed is never edited.
 *   node scripts/eval/zh-planted-8171/verify.mjs --priv=DIR [--n=52] [--conc=4]
 */
import fs from 'fs'; import path from 'path';
import { sitesToCheck, windowOf, decoyIndex } from './lib.mjs';
import { claudeCall, setLedger } from './calls.mjs';
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = argOf('priv'); setLedger(path.join(PRIV, 'calls.jsonl'));
const N = +argOf('n', 52), CONC = +argOf('conc', 4);
const OUT = path.join(PRIV, 'verify-C.jsonl');
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.answers).map((r) => r.slug) : []);
const rows = JSON.parse(fs.readFileSync(path.join(PRIV, 'draw-C.json'), 'utf8')).filter((r) => r.slug).slice(0, N);

function prompt(snips) {
  return `The file page.jpg in the current directory is a scanned page of a Chinese book. Open it with the Read tool and read it closely, column by column.

Below are short character strings that a transcription of this page contains. For each one, say whether the page image shows EXACTLY these characters, consecutively and in this order, somewhere on the page (running across a column break is fine). Differences that are only between variant forms of the same character (為/爲, 説/說, 徳/德) count as the same character. Any other difference — a wrong, missing or extra character — is "no". If you cannot find the place or cannot read it, say "unsure".

${snips.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Answer with one JSON object only, no other text: {"1": "yes"|"no"|"unsure", "2": ..., ...}`;
}

async function one(r) {
  if (done.has(r.slug)) return;
  const p = JSON.parse(fs.readFileSync(path.join(PRIV, 'passages', `${r.slug}.json`), 'utf8'));
  const sites = sitesToCheck(p.text, r.slug);
  const snips = sites.map((e) => windowOf(p.text, e));
  // decoy: the first site's window WITH its planted edit — the image must not show it. Placed at a seeded index.
  const d = sites[0]; const c = [...p.text];
  const decoy = c.slice(Math.max(0, d.at - 4), d.at).join('') + d.after + c.slice(d.at + [...d.before].length, d.at + [...d.before].length + 4).join('');
  const di = decoyIndex(r.slug, snips.length); snips.splice(di, 0, decoy);
  const res = await claudeCall(prompt(snips), { what: `verify:${r.slug}`, files: { 'page.jpg': path.join(PRIV, 'passages', `${r.slug}.jpg`) } });
  let answers = null; try { answers = JSON.parse((res.text.match(/\{[\s\S]*\}/) || [])[0]); } catch { /* unparsed */ }
  fs.appendFileSync(OUT, JSON.stringify({ slug: r.slug, sites: sites.map((e, i) => ({ type: e.type, at: e.at, len: [...e.before].length, answer: answers?.[String((i >= di ? i + 1 : i) + 1)] ?? null })), decoy_answer: answers?.[String(di + 1)] ?? null, answers, cls: res.cls, seconds: res.seconds, model: res.model, raw: answers ? undefined : res.text.slice(0, 500) }) + '\n');
  console.log(`${r.slug} ${answers ? Object.values(answers).join(',') : 'UNPARSED ' + res.cls} ${res.seconds.toFixed(0)}s`);
}
const q = [...rows];
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) await one(q.shift()); }));
console.log('verify done');
