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
