#!/usr/bin/env node
/**
 * build-pareto-sample-digest.mjs — the figures /quality states about the Pareto sample check (#6304),
 * written to src/data/pareto-sample-audit.json (#5918).
 *
 * PRIOR ART: scripts/eval/audit-pareto-samples.mjs writes results/pareto-sample-audit-6304/summary.json
 * (427 KB, every panel and flagged page) and needs Mongo to run; src/lib/quality-center.ts reads the
 * experiments dir at build. Neither fits: .vercelignore drops scripts/eval/results from a Vercel build,
 * so the page cannot read summary.json there, and it needs about twenty numbers, not the whole file.
 * This reads summary.json, eye.json and the write-up's per-chart verdict table (no database) and
 * writes only those numbers. audit-pareto-samples.mjs --write runs it; tests/unit/quality-center.test.ts
 * fails when the committed digest no longer matches its sources.
 *
 *   node scripts/eval/build-pareto-sample-digest.mjs           # write src/data/pareto-sample-audit.json
 *   node scripts/eval/build-pareto-sample-digest.mjs --check   # exit 1 if the committed file is stale
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ISSUE = 6304;
const RESULTS = `scripts/eval/results/pareto-sample-audit-${ISSUE}`;
const EXPERIMENTS = 'scripts/eval/experiments';
export const OUT = 'src/data/pareto-sample-audit.json';
const BLOB = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/';

/** The first reason the audit recorded for a drop, in the four kinds the write-up names. */
export function dropReason(why) {
  if (why.startsWith('ref-fit')) return 'judges';
  if (why.startsWith('by eye')) return 'by-eye';
  if (/^(script|language):/.test(why)) return 'language';
  if (why.startsWith('best-engine-cer')) return 'cer';
  throw new Error(`unknown drop reason in ${RESULTS}/summary.json: ${why}`);
}

const clean = (s) => s.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim();

/** Rows of the write-up's per-chart verdict table whose verdict says "not fit", one per chart. */
export function unfitRows(md) {
  const out = [];
  for (const line of md.split('\n')) {
    const cells = line.split('|').map(clean);
    if (cells.length < 5 || !/not fit/i.test(cells[3] ?? '')) continue;
    const base = cells[1].replace(/\s*·\s*(most-pages|most-engines)\s*$/, '');
    const chart = (/OCR/.test(base) ? base : base.replace(/^([^·]+?)(\s*·|$)/, '$1 translation$2')).replace(/\s*·\s*#(\d+)$/, ' (the #$1 chart)');
    const q = /not fit to rank (?!engines)(.+)$/i.exec(cells[3]);
    if (!out.some((o) => o.chart === chart)) out.push({ chart, qualifier: q ? q[1].replace(/\barms\b/, 'engines') : null });
  }
  return out;
}

function gapOf(p, dim, k) {
  const g = p.coverage[dim]?.top_gaps.find((x) => x.k === k);
  if (!g) throw new Error(`${RESULTS}: no ${dim}=${k} gap for ${p.family} ${p.chart}/${p.panel}`);
  return { sample: g.sample, corpus: g.corpus };
}

/** "On 109 of 121 pages the reference …" from the audit's own panel note. */
function noteCount(notes, key, re) {
  const m = (notes[key] ?? []).map((s) => re.exec(s)).find(Boolean);
  if (!m) throw new Error(`${RESULTS}: no note matching ${re} for ${key}`);
  return { n: Number(m[1]), of: Number(m[2]) };
}

export function digest(root = ROOT) {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, RESULTS, f), 'utf8'));
  const s = read('summary.json');
  const eye = read('eye.json');
  const writeup = fs.readdirSync(path.join(root, EXPERIMENTS)).find((f) => /^\d{4}-\d{2}-\d{2}-/.test(f) && f.includes(`sample-audit-${ISSUE}`));
  if (!writeup) throw new Error(`no write-up for #${ISSUE} in ${EXPERIMENTS}`);
  const md = fs.readFileSync(path.join(root, EXPERIMENTS, writeup), 'utf8');

  const panel = (family, chart, name = 'most-pages') => {
    const p = s.panels.find((x) => x.family === family && x.chart === chart && x.panel === name);
    if (!p) throw new Error(`${RESULTS}: no ${family} ${chart}/${name} panel`);
    return p;
  };

  const reasons = [];
  for (const d of s.drops) {
    const reason = dropReason(d.why[0]);
    const r = reasons.find((x) => x.family === d.family && x.reason === reason);
    if (r) r.n++;
    else reasons.push({ family: d.family, reason, n: 1 });
  }
  reasons.sort((a, b) => (a.family === b.family ? b.n - a.n : a.family === 'translation' ? -1 : 1));

  const sens = s.sensitivity.drops;
  const held = (ps) => ({ n: ps.filter((p) => !p.frontier_changed && p.top_before === p.top_after && p.swaps.length === 0).length, of: ps.length });

  const pools = Object.values(s.memorisation.translation_6182).filter((p) => p.spearman != null);
  const rhos = pools.map((p) => p.spearman);
  const shifts = pools.flatMap((p) => Object.keys(p.means.famous).map((a) => Math.round((p.means.famous[a] - p.means.obscure[a]) * 1000) / 1000));

  const chineseTr = panel('translation', 'chinese');
  const tibetan = panel('translation', 'tibetan');
  const gf = panel('ocr', 'latin-script-other');
  const family = (f) => s.panels.filter((p) => p.family === f);

  return {
    generated_by: 'scripts/eval/build-pareto-sample-digest.mjs',
    issue: ISSUE,
    date: writeup.slice(0, 10),
    writeup: `${BLOB}${EXPERIMENTS}/${writeup}`,
    files: { summary: `${RESULTS}/summary.json`, drops: `${RESULTS}/drops.json`, eye: `${RESULTS}/eye.json` },
    checked: { translation: family('translation').reduce((t, p) => t + p.n, 0), ocr: family('ocr').reduce((t, p) => t + p.n, 0) },
    dropped: { translation: s.drops.filter((d) => d.family === 'translation').length, ocr: s.drops.filter((d) => d.family === 'ocr').length, reasons },
    held: {
      translation: held(sens.translation),
      ocr: held(sens.ocr),
      swapsAllOverlap: [...sens.translation, ...sens.ocr].every((p) => p.ci_overlap_swaps === p.swaps.length),
    },
    unfit: unfitRows(md),
    edition: {
      greek: noteCount(s.notes.ocr, 'greek|most-pages', /On (\d+) of (\d+) pages the reference is a modern edition/),
      latinNormalised: noteCount(s.notes.ocr, 'latin|most-pages', /On (\d+) of (\d+) pages the reference expands abbreviations/),
      chineseOverrun: noteCount(s.notes.ocr, 'chinese-manuscript|most-pages', /On (\d+) of (\d+) pages the reference runs more than 15% longer/),
    },
    famous: family('translation')
      .filter((p) => p.panel === 'gemini-models-6182')
      .map((p) => ({ language: p.lang, famous: p.famous, n: p.n }))
      .sort((a, b) => b.famous / b.n - a.famous / a.n),
    spearman: [Math.min(...rhos), Math.max(...rhos)],
    levelShift: [Math.min(...shifts), Math.max(...shifts)],
    coverage: {
      chineseTranslationPrinted: gapOf(chineseTr, 'hand', 'printed'),
      chineseHandwritten: gapOf(chineseTr, 'hand', 'handwritten'),
      tibetan: { texts: tibetan.works, printed: gapOf(tibetan, 'hand', 'printed'), handwritten: gapOf(tibetan, 'hand', 'handwritten') },
      english17c: gapOf(panel('ocr', 'english'), 'century', '17c'),
      germanFrench: { n: gf.n, wikisource: gapOf(gf, 'provider', 'wikisource (external scan)'), c19: gapOf(gf, 'century', '19c') },
    },
    eye: {
      pages: eye.length,
      readers: new Set(eye.map((e) => e.group)).size,
      fit: eye.filter((e) => e.verdict === 'fit').length,
      limit: eye.filter((e) => e.verdict === 'fit-with-limit').length,
      unfit: eye.filter((e) => e.verdict === 'unfit').length,
      flagged: { n: eye.filter((e) => e.stratum === 'flagged' && e.verdict === 'unfit').length, of: eye.filter((e) => e.stratum === 'flagged').length },
      unflagged: { n: eye.filter((e) => e.stratum === 'unflagged' && e.verdict === 'unfit').length, of: eye.filter((e) => e.stratum === 'unflagged').length },
    },
  };
}

export const render = (d) => JSON.stringify(d, null, 1) + '\n';

export function writeDigest(root = ROOT) {
  fs.writeFileSync(path.join(root, OUT), render(digest(root)));
  return OUT;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const fresh = render(digest());
    const committed = fs.existsSync(path.join(ROOT, OUT)) ? fs.readFileSync(path.join(ROOT, OUT), 'utf8') : '';
    if (fresh !== committed) {
      console.error(`${OUT} is stale; run node scripts/eval/build-pareto-sample-digest.mjs`);
      process.exit(1);
    }
    console.log(`${OUT} is current`);
  } else {
    console.log(`wrote ${writeDigest()}`);
  }
}
