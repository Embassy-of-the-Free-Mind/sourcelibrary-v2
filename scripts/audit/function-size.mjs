#!/usr/bin/env node
/**
 * Will every server function in this build fit under Vercel's 250 MB limit? (#7318)
 *
 * PRIOR ART: none — looked in scripts/audit/, scripts/maintenance/ and for any `nft.json`
 * reader in the repo (git grep); next-build.yml only asks whether the build compiles.
 *
 * #7299 (next 16.3.8 → 16.4.3) passed next-build, then the release failed at deploy:
 * "The Vercel Function "quality" is 499.6mb uncompressed", because a process.cwd() read
 * in src/lib/quality-center.ts made the tracer ship the whole repository with /quality.
 * Next writes each function's traced files to `<entry>.js.nft.json` after `next build`
 * (compile-only mode too); this sums them, plus the shared next-server trace every
 * function also carries, and fails above --max-mb, naming the function and its five
 * largest files. The sum is an estimate (Vercel dedupes and drops some files, and
 * platform binaries differ per arch), so the default limit leaves 30 MB of headroom.
 *
 *   node scripts/audit/function-size.mjs [--dir .next] [--max-mb 220] [--top 5]
 *
 * Exit 0: every function fits. Exit 1: one or more are over (printed). Exit 2: no traces.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MB = 1024 * 1024;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js.nft.json')) out.push(p);
  }
  return out;
}

/** Absolute paths a trace lists, its own entry file included. */
function traced(nftFile) {
  const dir = path.dirname(nftFile);
  const { files = [] } = JSON.parse(fs.readFileSync(nftFile, 'utf8'));
  return [nftFile.replace(/\.nft\.json$/, ''), ...files.map((f) => path.resolve(dir, f))];
}

/** Every function's traced size in bytes, largest first, with its largest files. */
export function measure(nextDir, top = 5) {
  const sizes = new Map();
  const size = (p) => {
    if (!sizes.has(p)) {
      let s = 0;
      try { s = fs.statSync(p).size; } catch { /* listed but absent: Vercel will not ship it either */ }
      sizes.set(p, s);
    }
    return sizes.get(p);
  };
  const serverTrace = path.join(nextDir, 'next-server.js.nft.json');
  const shared = fs.existsSync(serverTrace) ? traced(serverTrace) : [];
  const serverDir = path.join(nextDir, 'server');
  const fns = fs.existsSync(serverDir) ? walk(serverDir) : [];
  return fns.map((nft) => {
    const files = [...new Set([...shared, ...traced(nft)])];
    const bytes = files.reduce((s, f) => s + size(f), 0);
    const largest = files.map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1]).slice(0, top);
    return { fn: path.relative(serverDir, nft).replace(/\.js\.nft\.json$/, ''), bytes, files: files.length, largest };
  }).sort((a, b) => b.bytes - a.bytes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nextDir = path.resolve(arg('dir', '.next'));
  const maxMb = Number(arg('max-mb', 220));
  const top = Number(arg('top', 5));
  const fns = measure(nextDir, top);
  if (!fns.length) {
    console.error(`no *.js.nft.json under ${nextDir}/server — run next build first`);
    process.exit(2);
  }
  const mb = (b) => `${(b / MB).toFixed(1)} MB`;
  const rel = (f) => path.relative(process.cwd(), f);
  console.log(`${fns.length} functions traced; largest:`);
  for (const f of fns.slice(0, 5)) console.log(`  ${mb(f.bytes).padStart(9)}  ${f.fn} (${f.files} files)`);
  const over = fns.filter((f) => f.bytes > maxMb * MB);
  if (!over.length) {
    console.log(`all under ${maxMb} MB`);
    process.exit(0);
  }
  console.error(`\n${over.length} function(s) over ${maxMb} MB (Vercel refuses a function above 250 MB uncompressed):`);
  for (const f of over) {
    console.error(`\n  ${f.fn}: ${mb(f.bytes)}, ${f.files} files. Largest:`);
    for (const [file, s] of f.largest) console.error(`    ${mb(s).padStart(9)}  ${rel(file)}`);
  }
  console.error('\nA cwd-relative fs read (path.join(process.cwd(), …)) traces the whole repo: import the file instead, or narrow it with outputFileTracingExcludes in next.config.ts.');
  process.exit(1);
}
