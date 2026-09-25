/**
 * No merge-conflict markers in tracked text files.
 *
 * scripts/eval/EXPERIMENTS.md, the append-only record of what every eval concluded,
 * carried three stray `|||||||` lines on main for days (left by diff3-style conflict
 * resolutions in three separate merges) and nobody noticed, because a markdown file
 * never fails to build. A fourth appeared during the #5090 rebase and was caught by
 * eye. Code files fail loudly on a marker; prose and data files do not, so this test
 * sweeps them all.
 *
 * `=======` alone is not flagged: it is a legitimate setext heading underline in
 * markdown. The three markers that carry a label are unambiguous.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

const MARKER = /^(<{7}|\|{7}|>{7})( |$)/;
const TEXT_EXT = /\.(md|mdx|ts|tsx|js|mjs|cjs|json|jsonl|ya?ml|txt|css|html|sh|py)$/;

export function conflictMarkerLines(text: string): number[] {
  return text.split('\n').flatMap((line, i) => (MARKER.test(line) ? [i + 1] : []));
}

describe('conflictMarkerLines', () => {
  it('finds each labelled marker', () => {
    const text = ['a', '<<<<<<< HEAD', 'b', '||||||| parent of abc', '=======', 'c', '>>>>>>> branch'].join('\n');
    expect(conflictMarkerLines(text)).toEqual([2, 4, 7]);
  });

  it('ignores a markdown setext underline and markers not at line start', () => {
    expect(conflictMarkerLines('Title\n=======\ntext with <<<<<<< inside')).toEqual([]);
  });
});

describe('tracked files', () => {
  it('contain no merge-conflict markers', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter(f => TEXT_EXT.test(f));
    expect(files.length).toBeGreaterThan(1000); // the sweep must actually see the repo
    const hits: string[] = [];
    for (const f of files) {
      let text: string;
      try { text = readFileSync(f, 'utf8'); } catch { continue; } // deleted in the working tree
      if (!text.includes('|||||||') && !text.includes('<<<<<<<') && !text.includes('>>>>>>>')) continue;
      for (const n of conflictMarkerLines(text)) hits.push(`${f}:${n}`);
    }
    expect(hits).toEqual([]);
  });
});
