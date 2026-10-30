import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

// #7771: scripts present one identity to other institutions' servers, with a contact address.
// A purpose tag may follow the closing parenthesis ("... derek@sourcelibrary.org) oai-pmh-harvest").
// Before this, 43 different SourceLibrary/1.0 strings named derek@, contact@, team@, a
// university address, or no contact at all.
const CANON = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

describe('scripts send one Source Library identity', () => {
  it('every SourceLibrary/1.0 User-Agent literal under scripts/ is the canonical one', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-n', '-o', '-E', `['"]SourceLibrary/1\\.0[^'"]*['"]`, '--', 'scripts'], { encoding: 'utf8' });
    } catch (e) {
      // git grep exits 1 when nothing matches
      if ((e as { status?: number }).status !== 1) throw e;
    }
    const hits = out.split('\n').filter(Boolean);
    expect(hits.length).toBeGreaterThan(50); // positive control: the scan sees the scripts
    const odd = hits.filter((h) => {
      const lit = h.replace(/^[^:]+:\d+:/, '').slice(1, -1);
      return !(lit === CANON || lit.startsWith(CANON + ' '));
    });
    expect(odd).toEqual([]);
  });
});
