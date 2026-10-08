import fs from 'node:fs';
import path from 'node:path';

/**
 * Build-time readers for /quality (#5918). Server-only: they read committed files from
 * the repository at render time, and /quality is prerendered at build, so the page
 * reflects main as of its last deploy with no hand edits.
 *
 * PRIOR ART: scripts/eval/build-experiments.mjs parses the same directory into the
 * generated EXPERIMENTS.md (whole entries, newest first). It is an ESM build script
 * that writes a file; this needs a typed list (date, question, headline, link) inside
 * a server component, so it reuses that script's file-name rule (DATED) and heading
 * format rather than importing it.
 */

const EXPERIMENTS_DIR = path.join(process.cwd(), 'scripts', 'eval', 'experiments');
const BLOB = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/experiments/';

/** Same rule as build-experiments.mjs: `YYYY-MM-DD-<slug>.md`. */
const DATED = /^(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9-]*\.md$/;
const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})(?:\s*\([^)]*\))?\s*[·—,:-]\s*(.+)$/;
// Only the explicit answer lines. "Result" sections open with tables and captions as often as
// with a sentence, and a fragment shown as a finding would misreport the experiment.
const MARKER = /\*\*(Answer|Verdict)\b([^*]*)\*\*:?/;

export type Experiment = {
  date: string;
  file: string;
  question: string;
  /** The write-up's own first sentence after its **Answer** or **Verdict** marker, when that reads as a sentence. */
  headline: string | null;
  issues: number[];
  href: string;
};

export function cleanMarkdown(s: string): string {
  return s
    .replace(/<!--.*?-->/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)\*([^*]+)\*/g, '$1$2')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstSentence(s: string): string {
  const m = s.match(/^(.{40,}?[.!?])(?=\s+[A-Z(“"])/);
  const out = m ? m[1] : s;
  return out.length > 260 ? `${out.slice(0, 260).replace(/\s+\S*$/, '')} …` : out;
}

/** A headline must stand on its own: a sentence, not a table caption or a fragment. */
function usableHeadline(s: string | null): string | null {
  if (!s) return null;
  if (s.length < 30) return null;
  if (!/^[A-Z“"]/.test(s)) return null;
  if (/^(Controls?|Markers|Rule output|Pending|Served:)\b/.test(s)) return null;
  if (s.includes('|')) return null;
  if (!/[.!?)]$/.test(s) && !s.endsWith('…')) return null;
  return s;
}

export function parseExperiment(file: string, text: string): Experiment | null {
  const name = DATED.exec(file);
  if (!name) return null;
  const lines = text.split('\n').filter(l => !/^\s*<!--/.test(l) && !/^PRIOR ART/.test(l));
  const headingLine = lines.find(l => l.startsWith('## ')) ?? '';
  const h = HEADING.exec(headingLine);
  const rawQuestion = h ? h[2] : headingLine.replace(/^##\s+/, '') || file.replace(/\.md$/, '');
  const issues = [...rawQuestion.matchAll(/#(\d{3,5})/g)].map(m => Number(m[1]));
  const question = cleanMarkdown(rawQuestion)
    .replace(/\s*\((?:#\d+[^)]*)\)\s*/g, ' ')
    .replace(/\s+—\s+RESULT$/i, '')
    .trim();

  let headline: string | null = null;
  const i = lines.findIndex(l => MARKER.test(l));
  if (i >= 0) {
    const m = MARKER.exec(lines[i])!;
    // "**Verdict: not established.**" carries the answer inside the marker.
    const inMarker = m[2].replace(/^[\s.:]+/, '');
    let rest = cleanMarkdown(/[a-z]/i.test(inMarker) ? inMarker + lines[i].slice(m.index + m[0].length) : lines[i].slice(m.index + m[0].length));
    if (!rest) {
      const next = lines.slice(i + 1).find(l => l.trim() && !l.trim().startsWith('|'));
      rest = next ? cleanMarkdown(next) : '';
    }
    headline = usableHeadline(rest ? firstSentence(rest) : null);
  }

  return { date: name[1], file, question, headline, issues, href: `${BLOB}${file}` };
}

/** Every dated write-up, newest first. Throws if the directory is missing: a build should fail, not render an empty list. */
export function listExperiments(dir = EXPERIMENTS_DIR): Experiment[] {
  return fs
    .readdirSync(dir)
    .filter(f => DATED.test(f))
    .sort()
    .reverse()
    .map(f => parseExperiment(f, fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter((e): e is Experiment => e !== null);
}

/* ── Canon status: the newest scripts/catalog-coverage/results/canon-gap-status-YYYY-MM.json ── */

const CANON_DIR = path.join(process.cwd(), 'scripts', 'catalog-coverage', 'results');
const CANON_FILE = /^canon-gap-status-(\d{4}-\d{2})\.json$/;

export type Tradition = {
  id: string;
  name: string;
  books: number;
  readable_books: number;
  pages_scanned: number;
  pages_transcribed: number;
  pages_translated: number;
  ocr_engines: [string, number][];
  translation_models: [string, number][];
};

export type CanonStatus = { file: string; generated_at: string; traditions: Tradition[] };

export function latestCanonStatus(dir = CANON_DIR): CanonStatus {
  const file = fs.readdirSync(dir).filter(f => CANON_FILE.test(f)).sort().pop();
  if (!file) throw new Error(`no canon-gap-status-*.json in ${dir}`);
  const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  return { file: `scripts/catalog-coverage/results/${file}`, generated_at: j.generated_at, traditions: j.traditions };
}

/**
 * Text that people typed, not a model's reading of the scan: the e-text editions aligned to our
 * scans (Esukhia's Derge, CBETA, Sefaria) and hand corrections. Everything else is an OCR engine.
 */
export const TYPED_SOURCE = /^(esukhia|cbeta|sefaria|manual)/i;

export function typedPages(t: Tradition): number {
  return t.ocr_engines.filter(([e]) => TYPED_SOURCE.test(e)).reduce((s, [, n]) => s + n, 0);
}

/* ── The sample check behind the cost/quality charts (#6304): results/pareto-sample-audit-<issue>/ ── */

const AUDIT_ISSUE = 6304;
const AUDIT_DIR = `scripts/eval/results/pareto-sample-audit-${AUDIT_ISSUE}`;

/** n of a whole, as the page states it. */
export type Of = { n: number; of: number };
/** A share of the chart's sample against the same share of the library's live pages in that language. */
export type Gap = { sample: number; corpus: number };

export type SampleAudit = {
  issue: number;
  date: string;
  writeup: string;
  files: { summary: string; drops: string; eye: string };
  /** Page slots checked by script: every page each panel plots. */
  checked: { translation: number; ocr: number };
  dropped: { translation: number; ocr: number; reasons: { family: 'translation' | 'ocr'; reason: DropReason; n: number }[] };
  /** Panels whose order and frontier did not move without the dropped pages. */
  held: { translation: Of; ocr: Of; swapsAllOverlap: boolean };
  /** Rows the write-up's per-panel table calls not fit, one per chart. */
  unfit: { chart: string; qualifier: string | null }[];
  edition: { greek: Of; latinNormalised: Of; chineseOverrun: Of };
  famous: { language: string; famous: number; n: number }[];
  /** Rank correlation of the engines on famous pages against the rest, over the pools with enough famous pages. */
  spearman: [number, number];
  /** Famous-page mean minus the rest, over every engine in those pools (points of 5). */
  levelShift: [number, number];
  coverage: {
    chineseTranslationPrinted: Gap;
    chineseHandwritten: Gap;
    tibetan: { texts: number; printed: Gap; handwritten: Gap };
    english17c: Gap;
    germanFrench: { n: number; wikisource: Gap; c19: Gap };
  };
  eye: { pages: number; readers: number; fit: number; limit: number; unfit: number; flagged: Of; unflagged: Of };
};

export type DropReason = 'judges' | 'by-eye' | 'language' | 'cer';

/** The first reason the script recorded for a drop, in the four kinds the write-up names. */
export function dropReason(why: string): DropReason {
  if (why.startsWith('ref-fit')) return 'judges';
  if (why.startsWith('by eye')) return 'by-eye';
  if (/^(script|language):/.test(why)) return 'language';
  if (why.startsWith('best-engine-cer')) return 'cer';
  throw new Error(`unknown drop reason in ${AUDIT_DIR}/summary.json: ${why}`);
}

type Coverage = Record<string, { top_gaps: { k: string; sample: number; corpus: number }[] }>;
type AuditPanel = {
  family: string; chart: string; panel: string; lang: string; n: number; works: number; famous: number; coverage: Coverage;
};

function gapOf(p: AuditPanel, dim: string, k: string): Gap {
  const g = p.coverage[dim]?.top_gaps.find(x => x.k === k);
  if (!g) throw new Error(`${AUDIT_DIR}: no ${dim}=${k} gap for ${p.family} ${p.chart}/${p.panel}`);
  return { sample: g.sample, corpus: g.corpus };
}

/** "On 109 of 121 pages the reference …" from the script's own panel note. */
function noteCount(notes: Record<string, string[]>, key: string, re: RegExp): Of {
  const m = (notes[key] ?? []).map(s => re.exec(s)).find(Boolean);
  if (!m) throw new Error(`${AUDIT_DIR}: no note matching ${re} for ${key}`);
  return { n: Number(m[1]), of: Number(m[2]) };
}

/**
 * The per-panel verdict table of the write-up: rows whose verdict says "not fit". Rows for the
 * same chart (most-pages and most-engines) collapse into one.
 */
export function unfitRows(md: string): { chart: string; qualifier: string | null }[] {
  const out: { chart: string; qualifier: string | null }[] = [];
  for (const line of md.split('\n')) {
    const cells = line.split('|').map(c => cleanMarkdown(c));
    if (cells.length < 5 || !/not fit/i.test(cells[3] ?? '')) continue;
    const [chartCell] = cells.slice(1);
    const base = chartCell.replace(/\s*·\s*(most-pages|most-engines)\s*$/, '');
    const chart = (/OCR/.test(base) ? base : base.replace(/^([^·]+?)(\s*·|$)/, '$1 translation$2')).replace(/\s*·\s*#(\d+)$/, ' (the #$1 chart)');
    const q = /not fit to rank (?!engines)(.+)$/i.exec(cells[3]);
    if (!out.some(o => o.chart === chart)) out.push({ chart, qualifier: q ? q[1].replace(/\barms\b/, 'engines') : null });
  }
  return out;
}

export function sampleAudit(root = process.cwd()): SampleAudit {
  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(root, AUDIT_DIR, f), 'utf8'));
  const s = read('summary.json');
  const eye: { group: string; verdict: string; stratum: string }[] = read('eye.json');
  const writeup = fs.readdirSync(path.join(root, 'scripts', 'eval', 'experiments')).find(f => DATED.test(f) && f.includes(`sample-audit-${AUDIT_ISSUE}`));
  if (!writeup) throw new Error(`no write-up for #${AUDIT_ISSUE} in scripts/eval/experiments`);
  const md = fs.readFileSync(path.join(root, 'scripts', 'eval', 'experiments', writeup), 'utf8');

  const panels: AuditPanel[] = s.panels;
  const panel = (family: string, chart: string, name = 'most-pages') => {
    const p = panels.find(x => x.family === family && x.chart === chart && x.panel === name);
    if (!p) throw new Error(`${AUDIT_DIR}: no ${family} ${chart}/${name} panel`);
    return p;
  };

  const drops: { family: 'translation' | 'ocr'; why: string[] }[] = s.drops;
  const reasons: SampleAudit['dropped']['reasons'] = [];
  for (const d of drops) {
    const reason = dropReason(d.why[0]);
    const r = reasons.find(x => x.family === d.family && x.reason === reason);
    if (r) r.n++;
    else reasons.push({ family: d.family, reason, n: 1 });
  }
  reasons.sort((a, b) => (a.family === b.family ? b.n - a.n : a.family === 'translation' ? -1 : 1));

  type Sens = { n: number; frontier_changed: boolean; top_before: string; top_after: string; swaps: unknown[]; ci_overlap_swaps: number };
  const sens: { translation: Sens[]; ocr: Sens[] } = s.sensitivity.drops;
  const held = (ps: Sens[]): Of => ({ n: ps.filter(p => !p.frontier_changed && p.top_before === p.top_after && p.swaps.length === 0).length, of: ps.length });

  type Pool = { spearman: number | null; means: { famous: Record<string, number>; obscure: Record<string, number> } };
  const pools = (Object.values(s.memorisation.translation_6182) as Pool[]).filter(p => p.spearman != null);
  const rhos = pools.map(p => p.spearman as number);
  const shifts = pools.flatMap(p => Object.keys(p.means.famous).map(a => p.means.famous[a] - p.means.obscure[a]));

  const famous = panels
    .filter(p => p.family === 'translation' && p.panel === 'gemini-models-6182')
    .map(p => ({ language: p.lang, famous: p.famous, n: p.n }))
    .sort((a, b) => b.famous / b.n - a.famous / a.n);

  const chineseTr = panel('translation', 'chinese');
  const tibetan = panel('translation', 'tibetan');
  const gf = panel('ocr', 'latin-script-other');

  return {
    issue: AUDIT_ISSUE,
    date: writeup.slice(0, 10),
    writeup: `${BLOB}${writeup}`,
    files: { summary: `${AUDIT_DIR}/summary.json`, drops: `${AUDIT_DIR}/drops.json`, eye: `${AUDIT_DIR}/eye.json` },
    checked: {
      translation: panels.filter(p => p.family === 'translation').reduce((t, p) => t + p.n, 0),
      ocr: panels.filter(p => p.family === 'ocr').reduce((t, p) => t + p.n, 0),
    },
    dropped: { translation: drops.filter(d => d.family === 'translation').length, ocr: drops.filter(d => d.family === 'ocr').length, reasons },
    held: {
      translation: held(sens.translation),
      ocr: held(sens.ocr),
      swapsAllOverlap: [...sens.translation, ...sens.ocr].every(p => p.ci_overlap_swaps === p.swaps.length),
    },
    unfit: unfitRows(md),
    edition: {
      greek: noteCount(s.notes.ocr, 'greek|most-pages', /On (\d+) of (\d+) pages the reference is a modern edition/),
      latinNormalised: noteCount(s.notes.ocr, 'latin|most-pages', /On (\d+) of (\d+) pages the reference expands abbreviations/),
      chineseOverrun: noteCount(s.notes.ocr, 'chinese-manuscript|most-pages', /On (\d+) of (\d+) pages the reference runs more than 15% longer/),
    },
    famous,
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
      readers: new Set(eye.map(e => e.group)).size,
      fit: eye.filter(e => e.verdict === 'fit').length,
      limit: eye.filter(e => e.verdict === 'fit-with-limit').length,
      unfit: eye.filter(e => e.verdict === 'unfit').length,
      flagged: { n: eye.filter(e => e.stratum === 'flagged' && e.verdict === 'unfit').length, of: eye.filter(e => e.stratum === 'flagged').length },
      unflagged: { n: eye.filter(e => e.stratum === 'unflagged' && e.verdict === 'unfit').length, of: eye.filter(e => e.stratum === 'unflagged').length },
    },
  };
}
