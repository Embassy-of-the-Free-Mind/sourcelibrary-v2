/**
 * Librarian citation fixer (#6946, stage 1) — run the fixer over replay items and apply what code validates.
 *
 * One `claude -p` call per answer (subscription; ANTHROPIC_API_KEY removed so it can never bill the API),
 * a few at a time, each reply cached in <dir>/out/<key>.json so a rerun only calls for what is missing.
 * Then validateVerdicts (span string-matched on the page) and fixerEdits (grounding edits), and the text the
 * reader would see after applyGroundingEdits. Writes <dir>/fixed.jsonl: per answer the outcomes per link,
 * the edits and the fixed text.
 *
 * PRIOR ART: scripts/audit/librarian-citation-gauge.ts judge() (the claude -p call, subscription only, retry,
 * usage-limit stop) and scripts/eval/librarian-citations-6946/judge-driver.sh (cached per packet, P at a time).
 * This calls the FIXER contract (src/lib/embassy/citation-fixer.ts), not the judge.
 *
 * Usage:
 *   npx tsx scripts/eval/librarian-fixer-6946/run-fixer.ts --items=<items.jsonl.gz> --dir=<out dir> \
 *     [--model=sonnet|opus] [--only=<regex on key>] [--p=4] [--max-calls=N] [--dry]   (dry: packets only)
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { FIXER_PROMPT, fixerEdits, fixerPacket, parseFixerReply, readablePages, validateVerdicts, changesLink } from '@/lib/embassy/citation-fixer';
import { applyGroundingEdits } from '@/lib/embassy/citation-fixes';
import type { Item } from './build-items';

const arg = (name: string, def?: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const readMaybeGz = (f: string) => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString('utf8');
const MODEL = arg('model', 'sonnet')!;
const DIR = arg('dir')!;
const ONLY = arg('only') ? new RegExp(arg('only')!) : null;
const P = Number(arg('p', '4'));
const MAX_CALLS = Number(arg('max-calls', '1000'));
const DRY = process.argv.includes('--dry');
const CLAUDE = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local/bin/claude');

const safe = (k: string) => k.replace(/[^a-zA-Z0-9_-]+/g, '_');
let calls = 0;
let limitHit = false;

function callModel(prompt: string, logFile: string): Promise<{ reply: string; ms: number } | null> {
  return new Promise(resolve => {
    const attempt = (left: number) => {
      if (limitHit || calls >= MAX_CALLS) return resolve(null);
      calls++;
      const t0 = Date.now();
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY; // the subscription, never the API
      const child = execFile(CLAUDE, ['-p', '--model', MODEL, '--allowedTools', ''], { cwd: os.tmpdir(), env, timeout: 20 * 60e3, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
        const out = String(stdout ?? '');
        fs.writeFileSync(logFile, `${out}\n--- stderr ---\n${String(stderr ?? '')}\n${err ? String(err) : ''}`);
        if (parseFixerReply(out)) return resolve({ reply: out, ms: Date.now() - t0 });
        if (/usage limit|hit your limit|limit reached|quota/i.test(out + String(stderr ?? ''))) { limitHit = true; return resolve(null); }
        if (left > 0) return setTimeout(() => attempt(left - 1), 20e3);
        resolve(null);
      });
      child.stdin?.end(prompt);
    };
    attempt(2);
  });
}

async function main() {
  const items: Item[] = readMaybeGz(arg('items')!).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter((i: Item) => !ONLY || ONLY.test(i.key));
  fs.mkdirSync(path.join(DIR, 'out'), { recursive: true });
  fs.mkdirSync(path.join(DIR, 'packets'), { recursive: true });
  const prepared = items.map(it => {
    const pages = readablePages(it.pages);
    const packet = fixerPacket(it.q, it.text, pages);
    fs.writeFileSync(path.join(DIR, 'packets', `${safe(it.key)}.md`), packet.md);
    return { it, packet };
  });
  console.log(`${prepared.length} answers, ${prepared.reduce((s, x) => s + x.packet.links.length, 0)} links; model ${MODEL}`);
  if (DRY) return;

  const queue = [...prepared];
  let done = 0;
  await Promise.all(Array.from({ length: P }, async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      const f = path.join(DIR, 'out', `${safe(x.it.key)}.json`);
      if (fs.existsSync(f)) continue;
      const r = await callModel(`${FIXER_PROMPT}\n---\n\n${x.packet.md}`, path.join(DIR, 'out', `.log-${safe(x.it.key)}`));
      if (r) fs.writeFileSync(f, JSON.stringify({ model: MODEL, ms: r.ms, links: parseFixerReply(r.reply) }));
      if (++done % 10 === 0) console.log(`${done}/${prepared.length} (calls ${calls})`);
    }
  }));

  const rows: string[] = [];
  const tally: Record<string, number> = {};
  let missing = 0;
  for (const { it, packet } of prepared) {
    const f = path.join(DIR, 'out', `${safe(it.key)}.json`);
    if (!fs.existsSync(f)) { missing++; continue; }
    const got = JSON.parse(fs.readFileSync(f, 'utf8'));
    const outcomes = validateVerdicts(it.text, packet, got.links);
    const edits = fixerEdits(it.text, outcomes, it.lang);
    const fixed = applyGroundingEdits(it.text, edits);
    for (const o of outcomes) tally[o.outcome] = (tally[o.outcome] ?? 0) + 1;
    rows.push(JSON.stringify({
      key: it.key, model: got.model, ms: got.ms, changed: outcomes.some(changesLink),
      outcomes: outcomes.map(o => ({ id: o.id, slug: o.link.slug, page: o.link.page, action: o.action, outcome: o.outcome, asked: o.asked, to: o.to ? { slug: o.to.bookSlug, page: o.to.page } : undefined, span: o.span, claim: o.claim })),
      edits: edits.map(e => ({ find: e.find, replace: e.replace, at: e.at })), fixed,
    }));
  }
  fs.writeFileSync(path.join(DIR, 'fixed.jsonl'), rows.join('\n') + '\n');
  console.log(JSON.stringify({ answers: rows.length, missing, calls, limitHit, outcomes: tally }));
  process.exit(limitHit ? 3 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
