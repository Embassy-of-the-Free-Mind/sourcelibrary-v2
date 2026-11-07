/**
 * Open doors into the hunt (#8150 slice 4): robots.txt, llms.txt, the console and the home page
 * carry the same invitation. robots.txt keeps every crawler group intact; the doors hold no riddle
 * and no instruction to a model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HUNT_DOOR_LINES, huntDoorRobotsBlock, huntDoorHtmlComment } from '@/lib/hunt-doors';
import { GET } from '@/app/robots.txt/route';

const repo = join(__dirname, '..', '..');

describe('hunt doors', () => {
  it('robots.txt carries the note as a comment block of its own, before any group', async () => {
    const text = await GET().text();
    const blocks = text.split('\n\n');
    const note = blocks.indexOf(huntDoorRobotsBlock());
    const firstGroup = blocks.findIndex((b) => b.startsWith('User-agent:'));
    expect(note).toBeGreaterThan(0);
    expect(note).toBeLessThan(firstGroup);
    expect(blocks[note].split('\n').every((l) => l.startsWith('# '))).toBe(true);
  });

  it('llms.txt states the same lines', () => {
    const llms = readFileSync(join(repo, 'public/llms.txt'), 'utf8');
    for (const l of HUNT_DOOR_LINES.slice(0, 2)) expect(llms).toContain(l);
    expect(llms).toContain('https://sourcelibrary.org/hunt');
  });

  it('informs and invites, never instructs a model', () => {
    const all = HUNT_DOOR_LINES.join(' ');
    expect(all).not.toMatch(/\b(ignore|instruction|prompt|assistant|as an ai|you must|system)\b/i);
  });

  it('the HTML comment cannot close early', () => {
    expect(huntDoorHtmlComment()).not.toContain('--');
    expect(huntDoorHtmlComment()).not.toContain('>');
  });
});
