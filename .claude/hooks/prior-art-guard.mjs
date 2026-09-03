#!/usr/bin/env node
/**
 * Prior-art guard (PreToolUse, matcher: Write) — see CLAUDE.md "Search before you build".
 *
 * WHY THIS EXISTS, and why the prose rule was not enough.
 *
 * CLAUDE.md has said "search before you build — the field, the script, and the
 * issue" since 2026-08-21, with an incident behind it. On 2026-09-02 one session
 * violated it FOUR times in a row, rebuilding: a lacuna marker already specified
 * in #4195, an anchor-insert helper already in scripts/eval/lib/production-prompt.mjs
 * (`withIntervention`), paired statistics already in scripts/eval/stats-cross-model.mjs
 * (sign test + Wilcoxon + bootstrap CI), and a whole prompt A/B runner already in
 * scripts/eval/prompt-ablation.mjs with two preregistration documents beside it.
 * Every rebuilt version was worse than the original, because the original had the
 * scar tissue.
 *
 * The passive layers had ALREADY FIRED and were ignored: the memory-recall
 * UserPromptSubmit hook surfaced .claude/docs/ocr-quality-measurement-loop.md —
 * the document describing the very measurement being reinvented — and the build
 * proceeded anyway. That is the whole design argument for this hook. A
 * suggestion at prompt time is forgotten by the time the file is written many
 * tool calls later; the check has to fire AT CREATION.
 *
 * WHAT IT DOES. On Write of a NEW file under a watched root, it scores existing
 * files by name and header-docstring overlap. A strong match BLOCKS (exit 2) and
 * lists the candidates.
 *
 * HOW TO PROCEED PAST IT — deliberately not a flag or an env var. Put a line in
 * the file itself:
 *
 *     PRIOR ART: scripts/eval/prompt-ablation.mjs — scores against pinned
 *     ground truth; this is reference-free, so it cannot be reused here.
 *
 * The override IS the artifact. It forces the check to happen and leaves a
 * durable record of the answer in the place the next reader will look. A bare
 * `PRIOR ART: none` is accepted too — the point is the deliberate act, not the
 * bureaucracy.
 *
 * FAILS OPEN. Any error, any parse failure, any unreadable directory → exit 0.
 * A guard that wedges file creation is worse than no guard (same rule as
 * branch-guard.sh).
 */
import fs from 'fs';
import path from 'path';

const REPO = '/Users/dereklomas/sourcelibrary';

/**
 * Roots where a new file must DECLARE its prior art. Deliberately narrow: these
 * are the places where duplicating existing work has actually cost us, and where
 * new files are rare enough that a one-line declaration is cheap. `scripts/import`
 * is excluded on purpose — one script per acquisition batch is the intended
 * pattern there, not sprawl.
 */
const WATCHED = [
  { root: 'scripts/eval', scan: ['scripts/eval', 'scripts/lib'] },
  { root: 'scripts/maintenance', scan: ['scripts/maintenance', 'scripts/audit', 'scripts/lib'] },
  { root: 'scripts/audit', scan: ['scripts/audit', 'scripts/maintenance', 'scripts/lib'] },
  { root: 'scripts/lib', scan: ['scripts/lib', 'scripts/eval'] },
  { root: 'src/lib', scan: ['src/lib'] },
  { root: '.claude/docs', scan: ['.claude/docs'] },
  { root: '.claude/skills', scan: ['.claude/skills'] },
];

/** Never scan into these — generated output, archives, other checkouts. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'results', 'observations', 'dataset', 'transcripts',
  '_archived', 'archive', 'worktrees', 'fixtures', 'ground-truth', 'prompts',
  'reference-works', 'data', 'output', '.next', 'coverage',
]);

/** Tokens that carry no signal about what a file DOES. */
const STOP = new Set([
  'tmp', 'temp', 'test', 'tests', 'spec', 'new', 'old', 'copy', 'draft', 'wip',
  'script', 'scripts', 'run', 'runner', 'index', 'main', 'util', 'utils', 'lib',
  'helper', 'helpers', 'common', 'shared', 'core', 'base', 'mjs', 'ts', 'js',
  'tsx', 'json', 'md', 'sh', 'py', 'the', 'and', 'for', 'with', 'from', 'this',
  'that', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'it', 'be', 'v', 'x',
]);

export const tokenize = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')          // camelCase → words
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t) && !/^v\d+$/.test(t));

/** Weighted overlap: how much of the NEW file's vocabulary already exists. */
function overlap(newTokens, oldTokens) {
  if (!newTokens.size || !oldTokens.size) return 0;
  let hits = 0;
  for (const t of newTokens) {
    if (oldTokens.has(t)) { hits += 1; continue; }
    // Prefix match catches ab~ablation, stat~statistics, embed~embedding.
    // The 2-char floor is load-bearing and was found by the controls: the real
    // 2026-09-02 case was `prompt-ab.mjs` against `prompt-ablation.mjs`, and a
    // 3-char floor silently let it through. Guarded by requiring the EXISTING
    // token to be a real word (>=4) so "ab" cannot match "an".
    for (const o of oldTokens) {
      if (t.length >= 2 && o.length >= 4 && o.startsWith(t)) { hits += 0.6; break; }
      if (o.length >= 2 && t.length >= 4 && t.startsWith(o)) { hits += 0.6; break; }
    }
  }
  return hits / newTokens.size;
}

/**
 * A filename stem that is a prefix of an existing stem is the loudest duplicate
 * signal there is — `prompt-ab` against `prompt-ablation`, `ft-eval` against
 * `ft-evaluate`. Treated as certainty rather than scored.
 */
const GENERIC_STEMS = new Set(['readme', 'index', 'changelog', 'notes', 'todo', 'types', 'config']);

/**
 * Strip a trailing version marker: apply-review-edits-v2 -> apply-review-edits.
 * When two names agree after this, the second is a DELIBERATE iteration of the
 * first and its author plainly knows the original exists — blocking it is pure
 * friction. Measured as the largest false-positive family in the repo; the
 * version-fork pattern (-v2, -v3, 2, -new, -final) is house style here.
 */
const stripVersion = (stem) => stem
  .replace(/\.(mjs|ts|tsx|js|md|py)$/, '')
  .toLowerCase()
  .replace(/[-_]?(v\d+|\d+|new|final|old|copy|rev\d*)$/g, '')
  .replace(/[-_]+$/, '');
const isVersionFork = (a, b) => {
  const [x, y] = [stripVersion(a), stripVersion(b)];
  return x.length > 0 && x === y;
};
function stemPrefix(a, b) {
  const norm = (s) => s.replace(/\.(mjs|ts|tsx|js|md|py)$/, '').toLowerCase();
  const [x, y] = [norm(a), norm(b)];
  if (x.length < 5 || y.length < 5 || x === y) return false;
  // README-dedup.md is not a fork of README.md.
  if (GENERIC_STEMS.has(x) || GENERIC_STEMS.has(y)) return false;
  if (!(x.startsWith(y) || y.startsWith(x))) return false;
  // A version suffix is a DELIBERATE iteration, not an accidental duplicate:
  // apply-review-edits-v2.py beside apply-review-edits.py is the house pattern,
  // and firing on it was 
  // the single largest false-positive family (measured).
  // Require the extra material to be a real word: "prompt-ab" -> "prompt-ablation"
  // leaves "lation" and fires; "...-edits" -> "...-edits-v2" leaves "v2" and does not.
  const rest = (x.length > y.length ? x.slice(y.length) : y.slice(x.length));
  return /[a-z]{3,}/.test(rest);
}

function walk(dir, out, depth = 0) {
  if (depth > 4) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out, depth + 1);
    } else if (/\.(mjs|ts|tsx|js|md|py)$/.test(e.name) && !/^_tmp/i.test(e.name)) {
      out.push(full);
    }
  }
}

/** First ~40 lines: the docstring, where a file says what it is for. */
function header(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    return buf.toString('utf8', 0, n).split('\n').slice(0, 40).join(' ');
  } catch { return ''; }
}


/**
 * Score every candidate. TWO-PHASE, and the phasing is not just an optimisation:
 * name scoring is pure in-memory so it runs over the WHOLE corpus, and only the
 * top names plus same-directory neighbours pay for a header read. The first
 * version capped the corpus at 800 files instead, which silently made the result
 * depend on directory traversal order — exempting scratch files RAISED the
 * firing rate 34.6% -> 36.7% purely by changing which files won the 800 slots.
 */
export function scoreCandidates({ normalised, nameTokens, newTokens, files, headerFn = header }) {
  const base = path.basename(normalised);
  const dir = path.dirname(normalised);
  const byName = [];
  for (const f of files) {
    const frel = path.relative(REPO, f);
    if (frel === normalised) continue;
    // A single-token filename (README.md -> {readme}) trivially scores 1.0
    // against any other file sharing that token, so a name match needs either a
    // stem-prefix or at least two tokens of agreement to count.
    // A version fork of the same script is not sprawl — skip the pair entirely.
    if (isVersionFork(base, path.basename(f))) continue;
    const fTokens = new Set(tokenize(path.basename(f)));
    const rawName = overlap(nameTokens, fTokens);
    const sharedTokens = [...nameTokens].filter((t) => fTokens.has(t)).length;
    const nameScore = stemPrefix(base, path.basename(f)) ? 1
      : (nameTokens.size >= 2 && sharedTokens >= 2 ? rawName : Math.min(rawName, 0.45));
    byName.push({ f, frel, nameScore, sameDir: path.dirname(frel) === dir });
  }
  byName.sort((a, b) => b.nameScore - a.nameScore);
  const readSet = new Set(byName.slice(0, 80).map((c) => c.f));
  for (const c of byName) if (c.sameDir && readSet.size < 200) readSet.add(c.f);

  const scored = [];
  for (const c of byName) {
    const headScore = readSet.has(c.f) ? overlap(newTokens, new Set(tokenize(headerFn(c.f)))) : 0;
    const score = Math.max(c.nameScore, headScore * 0.75);
    // Low floor ON PURPOSE. This list is advisory — it exists to give you
    // somewhere to look, not to decide anything — so recall matters and
    // precision does not. At 0.5 a search for "agreement across repeated OCR
    // runs" returned nothing while scripts/eval/revision-agreement-*.mjs sat
    // right there.
    if (score >= 0.12) scored.push({ frel: c.frel, score, nameScore: c.nameScore, headScore });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function main() {
  let payload = '';
  try { payload = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
  let tool, input;
  try { const d = JSON.parse(payload); tool = d.tool_name; input = d.tool_input || {}; } catch { process.exit(0); }
  if (tool !== 'Write') process.exit(0);

  const target = input.file_path;
  const content = input.content || '';
  if (!target) process.exit(0);

  // Editing an existing file is not sprawl.
  // PRIOR_ART_GUARD_REPLAY is set ONLY by calibrate-prior-art-guard.mjs, which
  // replays real files as if they were new to measure the firing rate. Without
  // it the calibration silently measures nothing and reports a reassuring 0%
  // — which it did, on the first attempt.
  if (!process.env.PRIOR_ART_GUARD_REPLAY) {
    try { if (fs.existsSync(target)) process.exit(0); } catch { process.exit(0); }
  }

  // The declared-prior-art escape hatch.
  if (/PRIOR[ -]ART\s*:/i.test(content)) process.exit(0);

  // Scratch work is exempt in BOTH directions. CLAUDE.md designates `_tmp-`
  // files disposable and untracked, so numbered variants of one throwaway probe
  // (_tmp-batch-audit2, -audit3, -audit4) are not sprawl and blocking them is
  // pure friction. Measured: they were 
  // the dominant term in a 34.6% firing rate.
  if (/^_tmp/i.test(path.basename(target))) process.exit(0);

  const rel = path.relative(REPO, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0);   // outside the repo
  if (rel.includes('.claude/worktrees/')) {
    // A worktree path still belongs to a watched root — normalise it away so the
    // guard behaves identically in a worktree and in the main checkout.
  }
  const normalised = rel.replace(/^\.claude\/worktrees\/[^/]+\//, '');

  const watch = WATCHED.find((w) => normalised.startsWith(w.root + '/'));
  if (!watch) process.exit(0);

  const newTokens = new Set([
    ...tokenize(path.basename(normalised)),
    ...tokenize(content.split('\n').slice(0, 25).join(' ')),
  ]);
  if (newTokens.size < 2) process.exit(0);
  const nameTokens = new Set(tokenize(path.basename(normalised)));

  const files = [];
  for (const s of watch.scan) walk(path.join(REPO, s), files);
  const scored = scoreCandidates({ normalised, nameTokens, newTokens, files });

  // THE GATE IS UNCONDITIONAL, and that is the design.
  //
  // Four rounds of threshold tuning could not get the false-positive rate of a
  // similarity gate below ~30%: in a repo organised into families (ft-*, build-*,
  // report-*) most new files legitimately resemble their neighbours, so the base
  // rate of similarity is high and a ranked filter's precision tracks it. A gate
  // firing on a third of new files gets disabled within a week.
  //
  // But the failure this exists to prevent was never a RANKING failure. On
  // 2026-09-02 no search was issued at all. So the requirement is simply that a
  // new file in these roots says what it checked — no threshold, no arguing about
  // scores, and nothing to tune. The similarity list below is ADVISORY: it helps
  // you look, and its precision no longer gates anything.
  const suggestions = scored.slice(0, 5);
  const lines = suggestions.length
    ? suggestions.map((s) => `  ${s.frel}`).join('\n')
    : '  (no close matches found — say so and proceed)';

  process.stderr.write(
`PRIOR-ART GUARD — new file in ${watch.root}/ must declare what it duplicates.

Closest existing files (advisory, ranked by name + docstring overlap):

${lines}

Also worth a query before writing a new one:
  ls ${watch.scan.join(' ')}
  git grep -l "<the concept>" -- scripts/ src/lib/
  gh issue list --search "<the concept>"   # vocabulary varies: "fabricate" found
                                           # nothing where the tracker said "invented"

Then add ONE line near the top of the file and write it again:

  PRIOR ART: <path> — <why it does not fit>
  PRIOR ART: none — <where you looked>

On 2026-09-02 a session rebuilt four things the repo already had (a lacuna
marker specified in #4195, withIntervention in scripts/eval/lib/production-prompt.mjs,
paired statistics in scripts/eval/stats-cross-model.mjs, and the whole prompt A/B
runner in scripts/eval/prompt-ablation.mjs). Each rebuild was worse than the
original. The passive reminders had already fired and were ignored — which is why
this one is at the point of creation and blocks.
`);
  process.exit(2);
}

// Only act when invoked as the hook; importing this module (the calibrator does)
// must not read stdin or exit. Exact basename — `endsWith` also matched
// calibrate-prior-art-guard.mjs, which made the import run main() and exit silently.
if (process.argv[1] && path.basename(process.argv[1]) === 'prior-art-guard.mjs') {
  try { main(); } catch { process.exit(0); }
}
