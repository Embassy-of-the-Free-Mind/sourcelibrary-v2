import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

// Every vector RPC goes through a scope (#4330, #2753).
//
// The embedding tables carry no tenant column, so a raw `supabase.rpc('match_…')`
// ranks the whole library whatever host asked. Eight call sites did exactly
// that; four filtered afterwards, one (/api/search/semantic) did not filter at
// all and served the global corpus on partner subdomains for months. "Remember
// to scope it" was the rule that failed, so the rule is now this file: the RPCs
// are callable only from the two modules that take a `SearchScope`.
//
// A new vector lane calls `matchClip` / `matchGalleryText` / the
// `semantic*Search` functions, which REQUIRE a scope, or adds its wrapper to
// src/lib/tenant-search-scope.ts.
const repoRoot = path.resolve(__dirname, '..', '..');

const ALLOWED = new Set([
  'src/lib/tenant-search-scope.ts',
  'src/lib/semantic-search.ts',
]);

// Vector RPCs that rank an embedding table. Not listed: `match_site_pages*`
// (the table has its own tenant column and the RPC filters on it).
const VECTOR_RPC = /\.rpc\(\s*['"`](match_(?:semantic|books_semantic|artworks_semantic|artworks|gallery_text|clip_text|clip_images|clip_in_books|pages_in_books|pages_in_scope|page_texts|page_texts_in_books|books_semantic_in_books|artworks_semantic_in_books|gallery_text_in_books)[a-z0-9_]*)['"`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe('vector RPCs are reachable only through a SearchScope', () => {
  const files = walk(path.join(repoRoot, 'src'));

  it('no file outside the scoped modules calls a match_* RPC directly', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(VECTOR_RPC)) offenders.push(`${rel}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the scan sees the RPC calls it is guarding (positive control)', () => {
    // If the regex stopped matching the real call shape, the test above would
    // pass on an empty scan. The allowed modules must contain matches.
    const lib = readFileSync(path.join(repoRoot, 'src/lib/semantic-search.ts'), 'utf8');
    expect([...lib.matchAll(VECTOR_RPC)].length).toBeGreaterThan(0);
    expect(files.length).toBeGreaterThan(500);
  });

  it('the semantic search functions cannot be called without a scope', () => {
    const lib = readFileSync(path.join(repoRoot, 'src/lib/semantic-search.ts'), 'utf8');
    // `scope` is a required member of each options type, and the options
    // argument itself is required — an optional one is how `tenantId` came to
    // be accepted and ignored.
    expect(lib).toMatch(/export async function semanticBookSearch\(\s*query: string,\s*limit: number,\s*opts: \{ scope: SearchScope;/);
    expect(lib).toMatch(/export async function semanticArtworkSearch\(\s*query: string,\s*limit: number,\s*opts: \{ scope: SearchScope;/);
    expect(lib).toMatch(/export async function semanticPageSearchGlobal\(\s*query: string,\s*limit: number,\s*opts: SemanticPageSearchOptions,/);
    expect(lib).toMatch(/export interface SemanticPageSearchOptions \{[\s\S]{0,400}?\n {2}scope: SearchScope;/);
  });
});
