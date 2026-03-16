#!/usr/bin/env node
/**
 * Check for broken imports: find all import/require statements and verify targets exist.
 * Catches the "deleted file but forgot to update importer" bug.
 *
 * Usage: node scripts/maintenance/check-imports.mjs
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

const SRC = 'src';
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const ALIAS_PREFIX = '@/';
const errors = [];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('_archived')) continue;
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (EXTENSIONS.some(ext => full.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

function resolveImport(importPath, fromFile) {
  let target;

  if (importPath.startsWith(ALIAS_PREFIX)) {
    // @/ alias → src/
    target = join(SRC, importPath.slice(2));
  } else if (importPath.startsWith('.')) {
    // Relative import
    target = join(dirname(fromFile), importPath);
  } else {
    // Node module — skip
    return null;
  }

  // Try exact match, then with extensions, then as directory index
  const candidates = [
    target,
    ...EXTENSIONS.map(ext => target + ext),
    ...EXTENSIONS.map(ext => join(target, 'index' + ext)),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return undefined; // not found
}

const allFiles = walk(SRC);
console.log(`Scanning ${allFiles.length} source files...\n`);

// Match: import ... from '...', require('...'), dynamic(() => import('...'))
const importPattern = /(?:from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"])/g;

for (const file of allFiles) {
  const content = readFileSync(file, 'utf8');
  let match;

  while ((match = importPattern.exec(content)) !== null) {
    const importPath = match[1] || match[2] || match[3];

    // Skip imports inside comments
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const line = content.slice(lineStart, match.index);
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;

    const result = resolveImport(importPath, file);

    if (result === undefined) {
      // Could not resolve
      const line = content.slice(0, match.index).split('\n').length;
      errors.push({ file: `${file}:${line}`, importPath });
    }
    // null = node_module, skip
  }
}

if (errors.length === 0) {
  console.log('All imports resolve successfully.');
} else {
  console.log(`Found ${errors.length} broken import(s):\n`);
  for (const e of errors) {
    console.log(`  ${e.file}`);
    console.log(`    → ${e.importPath}\n`);
  }
  process.exit(1);
}
