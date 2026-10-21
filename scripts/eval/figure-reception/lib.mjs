// Shared config lookup for the figure-reception scripts (#7073).
// PRIOR ART: none — looked in scripts/eval/lib and scripts/lib; nothing reads a per-figure config.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../../..');
const FIGURES = JSON.parse(fs.readFileSync(path.join(HERE, 'figures.json'), 'utf8'));

export function figure(key) {
  const f = FIGURES[key];
  if (!f || key.startsWith('_')) throw new Error(`unknown figure "${key}"; known: ${Object.keys(FIGURES).filter((k) => !k.startsWith('_')).join(', ')}`);
  return f;
}

// Intermediate files (hits, embeddings, cluster samples) stay outside the repo: they are large and rebuildable.
export function workDir(key) {
  const d = path.join(process.env.FIGURE_WORK || path.join(process.env.HOME, 'sl-work/figure-reception'), key);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export const outDir = (key) => {
  const d = path.join(REPO, figure(key).out);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
