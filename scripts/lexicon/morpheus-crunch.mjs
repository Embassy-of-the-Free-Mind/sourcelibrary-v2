/**
 * Bulk Morpheus run: Greek corpus forms → form→lemma table (#3823 Phase 3).
 *
 * Streams the enumerated corpus forms (greek-forms.tsv, count >= --min-count,
 * default 2 — the hapax tail is OCR noise) through ONE long-lived cruncher
 * process inside the perseidsproject/morpheus Docker image (MPL-2.0, engine
 * and stemlibs alike — this regenerated table is unencumbered, unlike the
 * CC BY-NC MorpheusGreekUnicode dump).
 *
 * Betacode: cruncher speaks betacode, not Unicode. We NFD-decompose each
 * form and map base letters + combining marks (smooth=`)`, rough=`(`,
 * acute=`/`, grave=`\`, circumflex=`=`, iota subscript=`|`, diaeresis=`+`),
 * lowercased so no `*` capital prefixes are needed; lemmas come back the
 * same way and are reversed to NFC Unicode. Forms whose decomposition
 * contains anything unmappable are skipped and counted, not guessed at.
 *
 * Output: scripts/lexicon/output/greek-form-lemmas.jsonl
 *   {"form":"ἄνθρωπον","lemmas":["ἄνθρωπος"]}
 * plus a .skipped.txt of unconvertible/unanalyzed forms (the honest-miss
 * ledger — nothing silently dropped).
 *
 * Run: node scripts/lexicon/morpheus-crunch.mjs [--min-count 2] [--limit N]
 */
import fs from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const IN = 'scripts/lexicon/output/greek-forms.tsv';
const OUT = 'scripts/lexicon/output/greek-form-lemmas.jsonl';
const SKIPPED = 'scripts/lexicon/output/greek-form-lemmas.skipped.txt';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const MIN_COUNT = flag('min-count', 2);
const LIMIT = flag('limit', Infinity);
// Sharding: run N of these in parallel (emulated amd64 is slow per-process);
// shard i takes lines where index % count === i and writes OUT.<i>.
const SHARD_INDEX = flag('shard-index', -1);
const SHARD_COUNT = flag('shard-count', 1);

const LETTER = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'h', θ: 'q', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'c', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'u', φ: 'f', χ: 'x', ψ: 'y', ω: 'w', ϝ: 'v',
};
const MARK = {
  '̓': ')', '̔': '(', '́': '/', '̀': '\\',
  '͂': '=', 'ͅ': '|', '̈': '+', '̄': '', '̆': '', // strip length marks
};
const LETTER_REV = Object.fromEntries(Object.entries(LETTER).map(([g, b]) => [b, g]));
LETTER_REV.s = 'σ'; // ς overwrote σ in the reverse map; medial is the right default
const MARK_REV = Object.fromEntries(Object.entries(MARK).filter(([, b]) => b).map(([g, b]) => [b, g]));

export function toBetacode(unicode) {
  let out = '';
  for (const ch of unicode.normalize('NFD').toLowerCase()) {
    if (LETTER[ch] !== undefined) out += LETTER[ch];
    else if (MARK[ch] !== undefined) out += MARK[ch];
    else return null; // unmappable — skip honestly
  }
  return out;
}

export function fromBetacode(beta) {
  let out = '';
  for (const ch of beta) {
    if (LETTER_REV[ch]) out += LETTER_REV[ch];
    else if (MARK_REV[ch]) out += MARK_REV[ch];
    else if (/[0-9]/.test(ch)) out += ch; // homograph number, keep
    else if (ch === "'") out += ch;
    else if (ch === '*') continue; // capital prefix — lookup keys are lowercase
    else if (ch === '-') continue; // prefix separator in compound lemmas
    else return null;
  }
  // final sigma
  out = out.replace(/σ(?=$|[0-9])/g, 'ς');
  return out.normalize('NFC');
}

async function main() {
  // Resume: forms already present in any prior output are skipped.
  const doneForms = new Set();
  const resumeIdx = args.indexOf('--resume');
  if (resumeIdx >= 0) {
    const resumeFile = args[resumeIdx + 1];
    if (fs.existsSync(resumeFile)) {
      const rrl = readline.createInterface({ input: fs.createReadStream(resumeFile) });
      for await (const line of rrl) {
        try { doneForms.add(JSON.parse(line).form); } catch { /* partial line */ }
      }
      console.log(`resume: ${doneForms.size} forms already crunched`);
    }
  }

  const forms = [];
  const rl = readline.createInterface({ input: fs.createReadStream(IN) });
  let lineNo = 0;
  for await (const line of rl) {
    const [form, countStr] = line.split('\t');
    if (Number(countStr) < MIN_COUNT) break; // file is frequency-sorted
    if ((SHARD_INDEX < 0 || lineNo % SHARD_COUNT === SHARD_INDEX) && !doneForms.has(form)) forms.push(form);
    lineNo++;
    if (forms.length >= LIMIT) break;
  }
  const suffix = SHARD_INDEX >= 0 ? `.${SHARD_INDEX}` : '';
  console.log(`${forms.length} forms to crunch (min-count ${MIN_COUNT}, shard ${SHARD_INDEX}/${SHARD_COUNT})`);

  const out = fs.createWriteStream(OUT + suffix);
  const skipped = fs.createWriteStream(SKIPPED + suffix);
  const child = spawn('docker', [
    'run', '-i', '--rm', '--platform', 'linux/amd64',
    '-e', 'MORPHLIB=stemlib', 'perseidsproject/morpheus', 'bin/cruncher', '-S', '-n',
  ], { stdio: ['pipe', 'pipe', 'inherit'] });

  const betaToForm = new Map();
  let sent = 0, answered = 0, found = 0, skippedCount = 0;

  // Reader: cruncher echoes each input line, then zero+ <NL>...</NL> lines.
  let currentBeta = null;
  let currentLemmas = new Set();
  const flushCurrent = () => {
    if (currentBeta === null) return;
    const form = betaToForm.get(currentBeta);
    const lemmas = [...currentLemmas].map(fromBetacode).filter(Boolean);
    if (form && lemmas.length) {
      out.write(JSON.stringify({ form, lemmas }) + '\n');
      found++;
    } else if (form) {
      skipped.write(form + '\tno-analysis\n');
      skippedCount++;
    }
    answered++;
    if (answered % 50000 === 0) console.log(`  ${answered}/${sent} answered, ${found} with lemmas`);
    currentBeta = null;
    currentLemmas = new Set();
  };

  const outRl = readline.createInterface({ input: child.stdout });
  const done = new Promise((resolve) => {
    outRl.on('line', (line) => {
      if (line.includes('<NL>')) {
        // ALL analyses for one form arrive concatenated on one line:
        // "<NL>N gh= fem gen sg...</NL><NL>V ei)mi/ imperf...</NL>".
        // Lemma token is "form,lemma" (comma pair) or bare lemma.
        for (const m of line.matchAll(/<NL>[A-Z]+[\s·]+(\S+?)[\s·]/g)) {
          const pair = m[1].split(',');
          currentLemmas.add(pair[pair.length - 1]);
        }
      } else if (line.trim() && betaToForm.has(line.trim())) {
        flushCurrent();
        currentBeta = line.trim();
      }
    });
    outRl.on('close', () => { flushCurrent(); resolve(); });
  });

  // Writer with backpressure.
  for (const form of forms) {
    const beta = toBetacode(form);
    if (beta === null || !beta) {
      skipped.write(form + '\tunconvertible\n');
      skippedCount++;
      continue;
    }
    if (!betaToForm.has(beta)) betaToForm.set(beta, form);
    if (!child.stdin.write(beta + '\n')) {
      await new Promise((r) => child.stdin.once('drain', r));
    }
    sent++;
  }
  child.stdin.end();
  await done;
  out.end();
  skipped.end();
  console.log(`DONE: sent=${sent} withLemmas=${found} skipped=${skippedCount} → ${OUT}${suffix}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
