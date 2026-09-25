import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { bodyLen, isCollapsed } from '../../scripts/lib/translate-core.mjs';
import { translatableBodyLen } from '../../src/lib/translate-write';

/**
 * A centred heading must not delete the page it heads (#5105).
 *
 * Page 98 of Arrian's Periplus, Basel 1533, opens with `->from Strabo<-`. The body
 * measure stripped `<[^>]+>` before the centring markers, so the `<` of `<-` opened a
 * "tag" that ran to the first `>` in the text, at the end of `<term>scombri</term>`
 * 1,500 characters later. A 1,966-character translation measured 373, `isCollapsed`
 * fired, and a good translation was refused and stamped `health_blocked: 'collapsed'`.
 *
 * The same bug on title pages was #4815, fixed in one helper only. This file therefore
 * also scans the source for the wrong ORDER, so a third copy fails here.
 */

/** Reconstructed from the refused translation (page_revisions, source health-gate-refused). */
const PROSE =
  'were defeated, and all these are far from Corduba. THAT the sons of Pompey. Gnaeus indeed ' +
  'was truly destroyed, fled to Carteia, and was destroyed there. But Sextus, having been saved ' +
  'from Corduba, and landing a little later in Sicily after it was taken by him, then having been ' +
  'cast out of it, sailed to Miletus, and having been captured by the generals of Antony, he also ' +
  'died there. THAT the Baetis is navigable by large merchant ships into the interior, as far as ' +
  'Hispalis. And there are mines around its banks, and among others, silver in great quantity. ';
const PAGE_98 =
  '->from Strabo<-\n\n' + PROSE.repeat(3) +
  'an island called Scombraria, from the caught mackerel <term>scombri</term>, from which the ' +
  'best <term>garum</term> <gloss>fish sauce</gloss> is prepared.';
/** A Greek source of about the same length, for the collapse check. */
const OCR_98 = `<language>Greek</language>\n${'Ὅτι ὁ Βαῖτις ἀναπλεῖται ὁλκάσι μεγάλαις μέχρι Ἱσπάλιος. '.repeat(30)}`;

describe('a centred heading does not swallow the text after it', () => {
  it('bodyLen measures the whole page 98 translation', () => {
    expect(bodyLen(PAGE_98)).toBeGreaterThan(PAGE_98.length * 0.9);
  });

  it('the TS twin agrees', () => {
    expect(translatableBodyLen(PAGE_98)).toBe(bodyLen(PAGE_98));
  });

  it('page 98 is not judged collapsed', () => {
    expect(isCollapsed(OCR_98, PAGE_98)).toBe(false);
  });

  it('centred lines anywhere, and a bare "<" in prose, keep their text', () => {
    const t = 'a ->Title<- b <term>x</term> c ->Sub<- d where 3 < 4 and 5 > 2 e';
    expect(bodyLen(t)).toBe('a Title b x c Sub d where 3 < 4 and 5 > 2 e'.length);
  });

  it('real tags are still stripped', () => {
    expect(bodyLen('<term>a</term> <gloss lang="la">b</gloss><br/>')).toBe('a b'.length);
  });
});

/**
 * Wrong order: a `<[^>]+>` strip that runs before the `->|<-` strip. Matched as text in
 * the source, within the same chain (a few hundred characters).
 */
const LOOSE_TAG = '/<[^>]+>/g';
const CENTRING = '/->|<-/g';
const ROOTS = ['scripts', 'src'];
const SKIP = new Set(['node_modules', 'results', 'output', '.next']);

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(mjs|js|ts|tsx)$/.test(name)) yield p;
  }
}

export function wrongOrderSites(text: string): number[] {
  const hits: number[] = [];
  let i = text.indexOf(CENTRING);
  while (i !== -1) {
    const before = text.slice(Math.max(0, i - 400), i);
    if (before.includes(LOOSE_TAG)) hits.push(text.slice(0, i).split('\n').length);
    i = text.indexOf(CENTRING, i + 1);
  }
  return hits;
}

describe('no helper strips loose tags before centring markers', () => {
  it('the detector fires on the pre-fix bodyLen', () => {
    const preFix = `.replace(${LOOSE_TAG}, ' ').replace(${CENTRING}, ' ')`;
    expect(wrongOrderSites(preFix)).toHaveLength(1);
  });

  it('no source file has the wrong order', () => {
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];
    for (const r of ROOTS) {
      for (const f of sourceFiles(join(root, r))) {
        for (const line of wrongOrderSites(readFileSync(f, 'utf8'))) offenders.push(`${relative(root, f)}:${line}`);
      }
    }
    expect(offenders, 'strip ->|<- before any <…> tag strip (#5105)').toEqual([]);
  });
});
