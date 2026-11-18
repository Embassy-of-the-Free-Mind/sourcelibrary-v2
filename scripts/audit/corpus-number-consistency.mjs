#!/usr/bin/env node
/**
 * Which surfaces state a library count of their own, and do they agree? (v2#3647)
 *
 * PRIOR ART: scripts/audit/doc-staleness.mjs — pairs an old date with a quantity in
 * CLAUDE.md and memory/, not in served copy. scripts/audit/translation-state-audit.mjs —
 * checks one headline (readable_in_english) against its view and its age, not typed-in
 * numbers. src/app/admin/page-cleanup/data.ts NUMBERS — the same list, written by hand on
 * 2026-10-17; this script regenerates it. None of them finds a count typed into a page.
 *
 * The canonical counts live in system_config.homepage_stats (scripts/lib/homepage-stats.mjs),
 * read through getLibraryStats() / getSiteStats(), with dated floors for module-load copy in
 * src/lib/public-stats.ts. A surface diverges in one of two ways, and both are reported:
 *
 *   hardcoded    a number typed beside a corpus noun ("17,000+ historical texts").
 *   local-count  a page or component that runs its own countDocuments instead of
 *                reading the cache: its predicate is its own, so its number is too.
 *
 * Static by default: no database, no secrets. Findings are compared with the accepted
 * list in scripts/audit/baselines/corpus-number-consistency.json, and only a finding that
 * is NOT on that list fails. tests/unit/corpus-number-consistency.test.ts runs the same
 * comparison in CI, so a new typed-in count fails the PR that adds it. Drain the list;
 * never add to it without a reason in the PR.
 *
 * To accept one line on purpose (a measured subset with its date), put `corpus-number-ok:
 * <what it counts, measured when>` in a comment on that line or one of the three above.
 *
 * --live adds three checks against production (needs MONGODB_URI):
 *   1. the cache's age (--max-age-hours, default 48; the page-side guard in
 *      src/lib/library-stats.ts withholds counts at 7 days);
 *   2. the floors in public-stats.ts and the fallback in site-stats.ts: a floor must not
 *      exceed the live value, and neither may trail it by more than --max-lag (0.2);
 *   3. each hardcoded number against the live value of its class (over / low / ok).
 *
 * WHAT IT CANNOT SEE. Comments are stripped with a small scanner, not a parser: an
 * apostrophe in JSX text can hide the rest of that line's comment handling, so a count in
 * a trailing comment may be reported. Numbers built at run time, numbers under 1,000 for
 * book nouns, and prose with the noun more than three words from the number are missed.
 * local-count lists every countDocuments call in a page or component; it does not prove
 * the result is shown to a reader. Dated prose (articles, blog, press) is out of scope:
 * a count there is a statement about its date.
 *
 *   node scripts/audit/corpus-number-consistency.mjs [--all] [--json] [--root <dir>]
 *   node scripts/audit/corpus-number-consistency.mjs --write-baseline [--merge]
 *   node --env-file=.env.production.local scripts/audit/corpus-number-consistency.mjs --live
 *
 * Exit 0: nothing new (and, with --live, the cache is fresh and the constants hold).
 * Exit 1: findings (printed). Exit 2: could not measure (no database, a constant could
 * not be parsed, the scan found none of its positive controls).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
export const BASELINE_PATH = 'scripts/audit/baselines/corpus-number-consistency.json';

/** Where served copy lives. */
const SCAN_ROOTS = ['src/app', 'src/components', 'src/lib', 'public/llms.txt', 'public/llms-full.txt'];
const SCAN_EXT = /\.(tsx?|jsx?|mjs|json|txt|mdx?)$/;
/** Out of scope, each for a reason. A path matches by prefix or, with a leading `*`, by suffix. */
export const EXCLUDED = [
  ['src/app/articles/', 'dated prose: a count is a statement about its date'],
  ['src/app/blog/', 'dated prose'],
  ['src/app/press', 'dated press pages and releases'],
  ['src/components/press/', 'dated press releases'],
  ['src/components/blog/', 'dated prose'],
  ['src/lib/press-releases.ts', 'dated press releases'],
  ['src/app/admin/', 'team-only; the page-cleanup list quotes the old numbers on purpose'],
  ['src/app/research/', 'dated research notes'],
  ['src/app/api/cron/_archived/', 'archived code'],
  ['src/generated/', 'generated data'],
  ['src/data/', 'data files'],
  ['src/lib/public-stats.ts', 'the floors themselves; checked by --live'],
  ['src/lib/site-stats.ts', 'the dated fallback itself; checked by --live'],
  ['src/lib/blocked-asn-prefixes.json', 'network data'],
  ['src/lib/written-past-data.ts', 'counts of what survives in the world, not of this library'],
  ['src/lib/library-partners.ts', "other libraries' holdings"],
  ['src/app/explore/histories/content/', 'dated research content'],
  ['src/app/explore/maps/', 'dated research content'],
  ['*.test.ts', 'tests'],
  ['*.test.tsx', 'tests'],
];
const isExcluded = (file) => EXCLUDED.some(([p]) => (p.startsWith('*') ? file.endsWith(p.slice(1)) : file.startsWith(p)));

/** Noun → the class of count it states, and the homepage_stats key that class is checked against. */
export const CLASSES = {
  books: { nouns: 'books?|texts?|works|volumes|titles|manuscripts|editions|sources', liveKey: 'totalBooks', min: 1000 },
  illustrations: { nouns: 'illustrations?|images|engravings|artworks', liveKey: 'illustrationCount', min: 1000 },
  languages: { nouns: 'languages', liveKey: 'languageCount', min: 20 },
};
// 12,345 | 12,345+ | 37k | 1.2 million | 200+ (the last only counts for a class whose `min` allows it)
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s?(?:k|K|million|M)\b|\d{2,6})\+?`;
const GAP = String.raw`(?:\s+(?:[\p{L}-]+|&\w+;)){0,3}?\s+`;
const classRegex = (nouns) => new RegExp(String.raw`(?<![\w.,$€£#/-])(${NUM})${GAP}(${nouns})(?![\p{L}])`, 'giu');

/** "17,000+" → 17000; "37k" → 37000; "1.2 million" → 1200000. */
export function parseCount(text) {
  const t = text.replace(/\+$/, '').trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s?(k|K|million|M)$/);
  if (m) return Math.round(Number(m[1]) * (/^k$/i.test(m[2]) ? 1e3 : 1e6));
  return Number(t.replace(/,/g, ''));
}

/**
 * Blank out comments, keeping line breaks and string contents. Handles `//`, block
 * comments and JSX comment braces (their inside is a block comment). Quoted strings end
 * at the line break at the latest, so a stray apostrophe costs one line.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null; // ' " or `
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
      if (c === quote || (c === '\n' && quote !== '`')) quote = null;
      out += c; i++; continue;
    }
    if (c === '/' && d === '/' && src[i - 1] !== ':') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    out += c; i++;
  }
  return out;
}

const WAIVER = /corpus-number-ok\s*:/;
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Pure: the findings in one file's text. `file` is the repo-relative path; it decides
 * whether comments are stripped and whether local counts are looked for.
 */
export function scanText(file, text) {
  const findings = [];
  const isCode = /\.(tsx?|jsx?|mjs)$/.test(file);
  const rawLines = text.split('\n');
  const lines = (isCode ? stripComments(text) : text).split('\n');
  const waived = (n) => rawLines.slice(Math.max(0, n - 3), n + 1).some((l) => WAIVER.test(l));

  lines.forEach((line, n) => {
    for (const [cls, def] of Object.entries(CLASSES)) {
      for (const m of line.matchAll(classRegex(def.nouns))) {
        const value = parseCount(m[1]);
        if (!Number.isFinite(value) || value < def.min) continue;
        // A year beside a noun ("1650 editions", "in 1728 works") is not a count.
        if (/^\d{4}$/.test(m[1]) && value >= 1000 && value <= 2100) continue;
        // "2,500 years of primary sources" counts years.
        if (/^\S+\s+years?\b/i.test(m[0])) continue;
        findings.push({ kind: 'hardcoded', class: cls, file, line: n + 1, text: squash(m[0]), value, waived: waived(n) });
      }
    }
  });

  // A page or component counting for itself. API routes are not copy; lib helpers are
  // where a shared count belongs.
  if (isCode && /^src\/(app\/(?!api\/).*\/(page|layout)\.tsx|components\/)/.test(file)) {
    lines.forEach((line, n) => {
      if (!/\.(countDocuments|estimatedDocumentCount)\s*\(/.test(line)) return;
      // The collection, when it is named in the same statement (up to 6 lines back).
      const ctx = lines.slice(Math.max(0, n - 6), n + 1).join(' ');
      const coll = [...ctx.matchAll(/collection(?:<[^>]*>)?\(\s*['"`]([\w-]+)['"`]/g)].pop()?.[1] ?? '?';
      findings.push({ kind: 'local-count', class: coll, file, line: n + 1, text: squash(line).slice(0, 140), waived: waived(n) });
    });
  }
  return findings;
}

/**
 * The baseline key. No line number, so an unrelated edit above does not move it. A
 * local count is keyed by file and collection, not by its source line: reformatting
 * the query must not fail CI. The cost: a second count on the same collection in a
 * file that already has one is not new.
 */
export const findingKey = (f) => (f.kind === 'local-count' ? `${f.kind}|${f.file}|${f.class}` : `${f.kind}|${f.file}|${f.text}`);

export function listFiles(root = REPO) {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...SCAN_ROOTS], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  return out.split('\0').filter((f) => f && SCAN_EXT.test(f) && !isExcluded(f));
}

export function scanRepo(root = REPO) {
  const findings = [];
  const files = listFiles(root);
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    findings.push(...scanText(file, text));
  }
  return { files: files.length, findings };
}

export function readBaseline(root = REPO) {
  const p = path.join(root, BASELINE_PATH);
  if (!fs.existsSync(p)) return { accepted: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Pure: split findings into new (fails), accepted (on the list), waived; and list entries nothing matches any more. */
export function compareWithBaseline(findings, baseline) {
  const accepted = new Set(baseline.accepted ?? []);
  const seen = new Set();
  const res = { fresh: [], known: [], waived: [], resolved: [] };
  for (const f of findings) {
    const k = findingKey(f);
    if (f.waived) res.waived.push(f);
    else if (accepted.has(k)) { res.known.push(f); seen.add(k); }
    else res.fresh.push(f);
  }
  res.resolved = [...accepted].filter((k) => !seen.has(k));
  return res;
}

/** Pure: read the floors and the fallback out of the two constants files. Throws when one is missing. */
export function parseConstants(publicStatsSrc, siteStatsSrc) {
  const str = (src, key) => {
    const m = src.match(new RegExp(String.raw`\b${key}:\s*'([\d,.]+\s?(?:k|K|M|million)?\+?)'`));
    if (!m) throw new Error(`public-stats.ts: no '${key}' floor found`);
    return { label: m[1], value: parseCount(m[1]) };
  };
  const num = (src, key) => {
    const m = src.match(new RegExp(String.raw`\b${key}:\s*(\d[\d_]*)`));
    if (!m) throw new Error(`site-stats.ts: no '${key}' in SITE_STATS_FALLBACK`);
    return Number(m[1].replace(/_/g, ''));
  };
  const fb = siteStatsSrc.slice(siteStatsSrc.indexOf('SITE_STATS_FALLBACK'));
  return {
    floors: {
      books: str(publicStatsSrc, 'books'),
      readableInEnglish: str(publicStatsSrc, 'readableInEnglish'),
      languages: str(publicStatsSrc, 'languages'),
      illustrations: str(publicStatsSrc, 'illustrations'),
      artworks: str(publicStatsSrc, 'artworks'),
    },
    fallback: Object.fromEntries(['totalBooks', 'readableInEnglish', 'firstTranslationCount', 'languageCount', 'illustrationCount'].map((k) => [k, num(fb, k)])),
  };
}

/**
 * Pure: the --live findings. `live` is the homepage_stats document plus
 * `artworksByResourceType` (the predicate IMAGE_CORPUS_STATS.artworks documents).
 */
export function checkLive({ live, constants, hardcoded, now = Date.now(), maxAgeHours = 48, maxLag = 0.2 }) {
  const problems = [];
  const notes = [];
  const fmt = (n) => Number(n).toLocaleString('en-US');

  const at = live?.updatedAt ? new Date(live.updatedAt).getTime() : NaN;
  if (!live?.totalBooks) problems.push('system_config.homepage_stats is missing or has no totalBooks: every page is on its fallback.');
  else if (!Number.isFinite(at)) problems.push('system_config.homepage_stats has no readable updatedAt: its age cannot be checked, and the page-side guard treats it as fresh.');
  else {
    const hours = (now - at) / 3_600_000;
    if (hours > maxAgeHours) problems.push(`system_config.homepage_stats is ${hours.toFixed(1)} h old (limit ${maxAgeHours} h; written ${new Date(at).toISOString()}). The daily prewarm-browse job has stopped writing it. At 7 days getLibraryStats() withholds the counts.`);
    else notes.push(`homepage_stats written ${new Date(at).toISOString()} (${hours.toFixed(1)} h ago): fresh.`);
  }
  if (!live?.totalBooks) return { problems, notes, rows: [] };

  const floor = (name, f, liveValue, liveName) => {
    if (!Number.isFinite(liveValue)) { problems.push(`${name} '${f.label}': no live value (${liveName}) to check it against.`); return; }
    if (f.value > liveValue) problems.push(`${name} '${f.label}' OVERSTATES ${liveName} = ${fmt(liveValue)}. Lower it in src/lib/public-stats.ts.`);
    else if (f.value < liveValue * (1 - maxLag)) problems.push(`${name} '${f.label}' trails ${liveName} = ${fmt(liveValue)} by ${Math.round(100 * (1 - f.value / liveValue))}% (limit ${Math.round(maxLag * 100)}%). Re-measure and raise it in src/lib/public-stats.ts.`);
    else notes.push(`${name} '${f.label}' holds against ${liveName} = ${fmt(liveValue)}.`);
  };
  floor('BOOK_CORPUS_STATS.books', constants.floors.books, live.totalBooks, 'totalBooks');
  floor('BOOK_CORPUS_STATS.readableInEnglish', constants.floors.readableInEnglish, live.readableInEnglish, 'readableInEnglish');
  floor('BOOK_CORPUS_STATS.languages', constants.floors.languages, live.languageCount, 'languageCount');
  floor('IMAGE_CORPUS_STATS.illustrations', constants.floors.illustrations, live.illustrationCount, 'illustrationCount');
  floor('IMAGE_CORPUS_STATS.artworks', constants.floors.artworks, live.artworksByResourceType, 'visible books with resource_type');
  if (Number.isFinite(live.artworksByResourceType) && Number.isFinite(live.artworkCount)
    && Math.abs(live.artworksByResourceType - live.artworkCount) > 0.1 * live.artworkCount) {
    notes.push(`"artworks" has two definitions: visible books with resource_type = ${fmt(live.artworksByResourceType)} (public-stats.ts), content_type 'artwork' = ${fmt(live.artworkCount)} (homepage_stats.artworkCount).`);
  }
  for (const [k, v] of Object.entries(constants.fallback)) {
    const lv = Number(live[k]);
    if (!Number.isFinite(lv) || !lv) continue;
    if (Math.abs(v - lv) > maxLag * lv) problems.push(`SITE_STATS_FALLBACK.${k} = ${fmt(v)} is ${Math.round(100 * Math.abs(v - lv) / lv)}% off the live ${fmt(lv)}. It is what the homepage shows when Mongo is unreachable: refresh every field in src/lib/site-stats.ts from one day and change the date.`);
  }

  const rows = hardcoded.filter((f) => f.kind === 'hardcoded' && !f.waived).map((f) => {
    const lv = Number(live[CLASSES[f.class].liveKey]);
    const verdict = !Number.isFinite(lv) ? '?' : f.value > lv ? 'over' : f.value < lv * 0.5 ? 'low' : 'ok';
    return { ...f, live: lv, verdict };
  });
  return { problems, notes, rows };
}

function printFindings(title, list, extra = () => '') {
  if (!list.length) return;
  console.log(`\n${title} (${list.length})`);
  for (const f of list) console.log(`  ${f.file}:${f.line}  [${f.kind}/${f.class}]  ${f.text}${extra(f)}`);
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(n);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const root = path.resolve(opt('--root', REPO));

  const { files, findings } = scanRepo(root);
  // Positive control: the scan must see the files it exists for. An empty scan is a
  // broken instrument (wrong directory, git missing), never a clean library.
  if (files < 100) { console.error(`Scanned only ${files} files under ${root}: not a checkout, or git ls-files failed. Nothing was checked.`); process.exit(2); }

  if (flag('--write-baseline')) {
    const keys = new Set(findings.filter((f) => !f.waived).map(findingKey));
    // --merge keeps what is already accepted (used once, to cover a PR that is open
    // against the same files); a plain write drops entries that no longer match.
    if (flag('--merge')) for (const k of readBaseline(REPO).accepted ?? []) keys.add(k);
    const body = {
      _doc: 'Accepted findings of scripts/audit/corpus-number-consistency.mjs: counts typed into served copy, and pages that count for themselves, as they stood when the check was added (v2#3647). A finding NOT on this list fails tests/unit/corpus-number-consistency.test.ts. Remove an entry when its surface reads getLibraryStats() / BOOK_CORPUS_STATS; do not add one without a reason in the PR. Regenerate: node scripts/audit/corpus-number-consistency.mjs --write-baseline',
      accepted: [...keys].sort(),
    };
    fs.writeFileSync(path.join(REPO, BASELINE_PATH), JSON.stringify(body, null, 2) + '\n');
    console.log(`Wrote ${body.accepted.length} accepted findings to ${BASELINE_PATH}`);
    return;
  }

  const cmp = compareWithBaseline(findings, readBaseline(REPO));
  let live = null;
  if (flag('--live')) {
    if (!process.env.MONGODB_URI) { console.error('--live needs MONGODB_URI (node --env-file=.env.production.local …). Nothing was checked.'); process.exit(2); }
    try {
      const constants = parseConstants(
        fs.readFileSync(path.join(root, 'src/lib/public-stats.ts'), 'utf8'),
        fs.readFileSync(path.join(root, 'src/lib/site-stats.ts'), 'utf8'),
      );
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
      await client.connect();
      try {
        const db = client.db('bookstore');
        const doc = await db.collection('system_config').findOne({ _id: 'homepage_stats' });
        const artworksByResourceType = await db.collection('books').countDocuments({ resource_type: { $exists: true }, visible: true });
        live = checkLive({
          live: doc ? { ...doc, artworksByResourceType } : null,
          constants,
          hardcoded: findings,
          maxAgeHours: Number(opt('--max-age-hours', 48)),
          maxLag: Number(opt('--max-lag', 0.2)),
        });
      } finally { await client.close(); }
    } catch (e) {
      console.error(`Could not measure: ${e.message}. Nothing was checked against production.`);
      process.exit(2);
    }
  }

  if (flag('--json')) {
    console.log(JSON.stringify({ files, ...cmp, live }, null, 2));
  } else {
    const hard = cmp.known.filter((f) => f.kind === 'hardcoded').length;
    console.log(`Scanned ${files} files. ${findings.length} findings: ${cmp.fresh.length} new, ${cmp.known.length} accepted (${hard} hardcoded, ${cmp.known.length - hard} local counts), ${cmp.waived.length} waived in source.`);
    printFindings('NEW: not on the accepted list. Read the count from getLibraryStats() / BOOK_CORPUS_STATS, or mark a measured subset with corpus-number-ok:', cmp.fresh);
    if (flag('--all')) {
      printFindings('Accepted (still to move onto the shared counts)', cmp.known);
      printFindings('Waived in source', cmp.waived);
    }
    if (cmp.resolved.length) {
      console.log(`\nOn the accepted list but no longer found (${cmp.resolved.length}); remove with --write-baseline:`);
      for (const k of cmp.resolved) console.log(`  ${k}`);
    }
    if (live) {
      console.log('\nAgainst production:');
      for (const n of live.notes) console.log(`  ok    ${n}`);
      for (const p of live.problems) console.log(`  FAIL  ${p}`);
      const bad = live.rows.filter((r) => r.verdict !== 'ok');
      const tally = live.rows.reduce((t, r) => ((t[r.verdict] = (t[r.verdict] || 0) + 1), t), {});
      console.log(`\nHardcoded numbers against the live value of their class: ${JSON.stringify(tally)}  (over = above the live count; low = under half of it; many are subsets, so read them)`);
      for (const r of bad) console.log(`  ${r.verdict.padEnd(4)} ${r.file}:${r.line}  "${r.text}"  vs ${r.class} = ${Number(r.live).toLocaleString('en-US')}`);
    }
  }
  process.exit(cmp.fresh.length || live?.problems.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(`Could not measure: ${e.stack || e}`); process.exit(2); });
}
