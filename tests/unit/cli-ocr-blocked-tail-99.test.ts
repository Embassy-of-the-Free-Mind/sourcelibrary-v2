import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
// @ts-expect-error plain .mjs helper
import { ocrReadProblem } from '../../scripts/lib/cli-chatter.mjs';

// #99: an agy read of PH293 p.348 (2026-11-13) came back with one header, a few lines, then Gemini's filter block.
// cli-ocr read printed "ok (re-read)" and kept it for reuse; the keep now depends on this guard rejecting it.
const blockedTail = `<scan-quality>fair</scan-quality>
<language>German</language>
<script>handwritten</script>
<page-type>text</page-type>
<page-num>8 351</page-num>

### Tinctur ist augmentirt

Rx. ☿ ☉. setz es in digiThis request was blocked by Gemini's filters. They can occasionally trigger by mistake on safe coding, security, or biology-related queries.`;

describe('cli-ocr read: a filter-blocked reply is not a read', () => {
  it('the chatter guard rejects a one-header reply with a blocked tail', () => {
    expect(ocrReadProblem(blockedTail, { header: true })).toBeTruthy();
  });
  it('read does not keep (cache) a reply the chatter guard rejects', () => {
    const src = fs.readFileSync('scripts/batch/cli-ocr.mjs', 'utf8');
    expect(src).toMatch(/const unread = meta\.chatter \|\| meta\.write_guard === 'truncated';/);
    expect(src).toMatch(/!meta\.wrapper && !unread\) await keepRead\(/);
  });
});
