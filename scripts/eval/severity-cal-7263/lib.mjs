// PRIOR ART: scripts/eval/sa-gr-served-7991/lib.mjs (OUT/arg/seed conventions) and judge.mjs there (imageFor: fetch
// once, resize over 4 MB — restated, because that file runs its stage on import). This file holds #7263 severity-cal's
// own constants and the Opus-call ledger that keeps the whole study under its 500-call cap.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const RESULTS = path.join(HERE, 'results');
export const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
export const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'severity-cal-7263'));
export const SEED = 72630;
export const N_BOOKS = 30;
export const OPUS_CAP = 500;
export const FRESH_MODEL = 'gemini-3.8-flash-low';
export const LANGS = { sa: 'Sanskrit', zh: 'Chinese' };
export const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
export const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
export const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));

/** Every Opus call of the study, any stage, is one row here: the cap is checked against it before each call. */
const LEDGER = () => path.join(OUT, 'opus-calls.jsonl');
export const opusUsed = () => jsonl(LEDGER()).length;
export function noteOpus(stage, id, r) {
  fs.appendFileSync(LEDGER(), JSON.stringify({ stage, id, cls: r.cls, model: r.model, usage: r.usage, list_usd: r.cost, at: new Date().toISOString() }) + '\n');
}

/** The page image, fetched once into OUT/img; over 4 MB it is resized to 3000 px on the long side (as #7991). */
export async function imageFor(pageId, url) {
  const f = path.join(OUT, 'img', `${pageId}.jpg`);
  if (fs.existsSync(f)) return f;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image HTTP ${res.status} for ${pageId}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 4e6) {
    const { default: sharp } = await import('sharp');
    buf = await sharp(buf).resize({ width: 3000, height: 3000, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
  }
  fs.writeFileSync(f, buf);
  return f;
}

/** Seeded shuffle (Fisher–Yates on makeRng). */
export function shuffle(xs, rng) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
