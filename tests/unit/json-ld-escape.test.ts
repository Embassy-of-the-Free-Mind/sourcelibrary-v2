/**
 * JSON-LD injected into a `<script type="application/ld+json">` must not be able
 * to close its own tag.
 *
 * `JSON.stringify` leaves `<` alone, and the HTML parser ends a `<script>` at
 * the first `</script` regardless of JS string context. Our reader page embeds a
 * 500-char excerpt of PAGE TEXT in its JSON-LD, and the OCR metadata envelope
 * contains a literal `<script>` tag recording the writing system
 * (`<script>printed</script>`) — so this is reachable from real corpus data, not
 * only from a crafted payload. Found 2026-08-04 when the same data broke an
 * offline prototype the same way.
 *
 * These assertions run the escaper; they do not grep source. Deleting the
 * `.replace()` in jsonLdHtml turns them red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { jsonLdHtml } from '../../src/lib/json-ld';

const repoRoot = path.resolve(__dirname, '../..');

describe('jsonLdHtml', () => {
  it('neutralises a closing script tag in the payload', () => {
    const out = jsonLdHtml({ text: 'transcription </script><img src=x onerror=alert(1)>' });
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<img');
  });

  it('neutralises the real OCR envelope tag that motivated this', () => {
    const out = jsonLdHtml({ text: '<script>printed</script> Sæpe iam ad huius operis' });
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<script');
  });

  it('neutralises an HTML comment opener', () => {
    expect(jsonLdHtml({ a: '<!--' })).not.toContain('<!--');
  });

  it('still round-trips to the original data', () => {
    const data = {
      '@type': 'CreativeWork',
      text: 'a </script> b <!-- c --> d',
      name: 'Sæpe — Ἰλιάς — 甲骨文',
      nested: { arr: [1, '<x>', null], flag: true },
    };
    expect(JSON.parse(jsonLdHtml(data))).toEqual(data);
  });

  it('escapes every angle bracket it emits', () => {
    const out = jsonLdHtml({ a: '<<<>>>' });
    expect(out.includes('<')).toBe(false);
    expect(JSON.parse(out).a).toBe('<<<>>>');
  });

  /**
   * ABSENCE invariant — deletion is the failure mode here, so a source check is
   * the right instrument (see CLAUDE.md on when source-shape tests earn their
   * keep). A new schema component that hand-rolls JSON.stringify into
   * dangerouslySetInnerHTML reintroduces the bug, and nothing else would catch it.
   */
  it('no component serialises JSON-LD without the escaper', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const src = readFileSync(p, 'utf8');
        // strip comments so prose about the bug can't trip the check
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        if (/dangerouslySetInnerHTML=\{\{\s*__html:\s*JSON\.stringify/.test(code)) {
          offenders.push(path.relative(repoRoot, p));
        }
      }
    };
    walk(path.join(repoRoot, 'src'));
    expect(offenders, `use jsonLdHtml() instead of raw JSON.stringify in: ${offenders.join(', ')}`).toEqual([]);
  });
});
