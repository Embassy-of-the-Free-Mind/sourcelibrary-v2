// PRIOR ART: zh-punct-8140/arm.mjs on PR #8146 (one page per call, G / G2 / O, the punctuation prompt copied here as
// prompt-punct.txt) and zh-ocr-gap-translation-5274/run.mjs on PR #8134 (translate-core's buildTranslationPrompt +
// TRANSLATE_SUFFIX through agy). Neither takes a planted text, hides the book's title, or keeps the #8171 call caps.
/**
 * #8171 arms. One passage per call, never two passages in one call.
 *   T (translate): production's DB prompt via buildTranslationPrompt with a stub book { language: 'Classical Chinese' }:
 *     no title, author or date reaches the model; no previous-page English.
 *   P (repeat with punctuation): #8140's prompt, verbatim.
 * Arms: G = gemini-3.8-flash-low on agy (pool --home), G2 = G again (noise floor), O = Opus on `claude -p`, text only.
 *   node --env-file=… scripts/eval/zh-planted-8171/arm.mjs --priv=DIR --arm=G|G2|O --task=T|P --variant=edited|orig
 *        --set=all|subset|baseline [--home=/root/.agy-milo] [--conc=3]
 * Writes <priv>/out/<arm>-<task>-<variant>/<slug>.json { slug, arm, task, variant, answer, raw, cls, seconds }.
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { agyCall, claudeCall, setLedger, poolOk, used } from './calls.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = argOf('priv'); setLedger(path.join(PRIV, 'calls.jsonl'));
const ARM = argOf('arm'), TASK = argOf('task'), VARIANT = argOf('variant', 'edited'), SET = argOf('set', 'all'), CONC = +argOf('conc', 3);
const HOME = argOf('home', '/root/.agy-milo');
if (ARM !== 'O') { process.env.AGY_HOME = HOME; process.env.AGY_POOL_SHARED = '1'; }
const OUT = path.join(PRIV, 'out', `${ARM}-${TASK}-${VARIANT}`); fs.mkdirSync(OUT, { recursive: true });
const sample = JSON.parse(fs.readFileSync(path.join(here, 'sample.json'), 'utf8'));
const slugs = sample.passages.filter((p) => SET === 'all' || p[SET]).map((p) => p.slug);
const PUNCT = fs.readFileSync(path.join(here, 'prompt-punct.txt'), 'utf8');

let prompts = null, build = null, SUFFIX = '';
if (TASK === 'T') {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  ({ loadTranslationPrompts: build } = await import('../../lib/translate-core.mjs'));
  prompts = await build(c.db('bookstore')); await c.close();
  ({ TRANSLATE_SUFFIX: SUFFIX } = await import('../../lib/agy-cli.mjs'));
}
const { buildTranslationPrompt } = await import('../../lib/translate-core.mjs');
const { unwrapSentinels } = await import('../../lib/cli-chatter.mjs');
export const BOOK = { language: 'Classical Chinese' };
export function promptFor(text, task) {
  if (task === 'P') return PUNCT.replace('{{TEXT}}', text);
  return buildTranslationPrompt({ prompts, book: BOOK, ocrText: text, previousTranslation: null }).prompt + SUFFIX;
}

let stop = null, n = 0;
async function one(slug) {
  const f = path.join(OUT, `${slug}.json`);
  if (fs.existsSync(f) || stop) return;
  if (ARM !== 'O' && n++ % 10 === 0) { const p = await poolOk(HOME); fs.appendFileSync(path.join(PRIV, 'quota.jsonl'), JSON.stringify({ at: new Date().toISOString(), arm: ARM, task: TASK, home: HOME, ...p }) + '\n'); if (!p.ok) { stop = `pool under its floor ${JSON.stringify(p.reading)} line ${p.line}`; return; } }
  const rec = JSON.parse(fs.readFileSync(path.join(PRIV, 'plant', `${slug}.json`), 'utf8'));
  const text = VARIANT === 'orig' ? rec.text : rec.edited;
  const prompt = promptFor(text, TASK);
  let row;
  try {
    if (ARM === 'O') {
      const r = await claudeCall(prompt, { what: `${ARM}-${TASK}-${VARIANT}:${slug}` });
      const u = unwrapSentinels(r.text);
      row = { answer: u.inside ?? null, raw: r.text, cls: r.cls ?? (u.inside ? null : 'no-markers'), seconds: r.seconds, model: r.model };
    } else {
      const r = await agyCall(prompt, { what: `${ARM}-${TASK}-${VARIANT}:${slug}` });
      row = { answer: r.answer, raw: r.raw, cls: r.cls ?? (r.answer ? null : r.problem || 'empty'), seconds: r.seconds };
    }
  } catch (e) { stop = e.message; return; }
  if (row.cls === 'quota') { stop = `quota at ${slug}`; return; }
  fs.writeFileSync(f, JSON.stringify({ slug, arm: ARM, task: TASK, variant: VARIANT, ...row }));
  console.log(`${slug} ${row.answer ? 'ok' : 'EMPTY ' + row.cls} ${row.seconds.toFixed(0)}s`);
}
const q = [...slugs];
await Promise.all(Array.from({ length: CONC }, async () => { while (q.length && !stop) await one(q.shift()); }));
console.log(stop ? `STOPPED: ${stop}` : `done ${ARM}-${TASK}-${VARIANT} (${slugs.length}); calls used ${JSON.stringify(used())}`);
