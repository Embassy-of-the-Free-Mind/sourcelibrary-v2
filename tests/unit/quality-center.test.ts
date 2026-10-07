import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseExperiment, listExperiments, latestCanonStatus, typedPages } from '@/lib/quality-center';
import { FOOTER_NAV_COLUMNS, visibleFooterNavColumns } from '@/lib/footer-nav';
import { FOOTER_STRINGS } from '@/lib/i18n';
// @ts-expect-error -- plain ESM script, no types
import { checkFreshness, readDates } from '../../scripts/audit/quality-center-freshness.mjs';
// @ts-expect-error -- plain ESM script, no types
import { classify, synthesize } from '../../scripts/analytics/quality-feedback-themes.mjs';

/**
 * /quality (#5918). The page itself has no DOM harness here, so these pin the pieces that
 * decide what it says: the experiment list, the freshness rule, the feedback themes and the
 * privacy of their output, and the footer door.
 */

describe('experiment write-ups', () => {
  it('takes date, question, issues and an Answer line', () => {
    const e = parseExperiment(
      '2026-10-05-engine-contest-5870.md',
      '<!-- PRIOR ART: x -->\n## 2026-10-05 · Can an open engine replace the re-read? (#5870)\n\n- **Answer.** No script moves off Flash for any of the three groups tested. The rest follows.\n',
    )!;
    expect(e.date).toBe('2026-10-05');
    expect(e.question).toBe('Can an open engine replace the re-read?');
    expect(e.issues).toEqual([5870]);
    expect(e.headline).toBe('No script moves off Flash for any of the three groups tested.');
    expect(e.href).toMatch(/scripts\/eval\/experiments\/2026-10-05-engine-contest-5870\.md$/);
  });

  it('shows no headline rather than a fragment', () => {
    const table = parseExperiment('2026-10-04-x.md', '## 2026-10-04 · Q?\n\n**Result.**\n\n| a | b |\n');
    expect(table!.headline).toBeNull();
    const cut = parseExperiment('2026-10-04-y.md', '## 2026-10-04 · Q?\n\n**Answer.** the parse fails on 22 of 120 blocks and 13 of\n');
    expect(cut!.headline).toBeNull();
  });

  it('ignores files that are not dated entries', () => {
    expect(parseExperiment('README.md', '# x')).toBeNull();
    expect(parseExperiment('_series-audit.md', '# x')).toBeNull();
  });

  it('reads every dated file in the real directory, newest first', () => {
    const dir = path.join(process.cwd(), 'scripts/eval/experiments');
    const dated = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f));
    const list = listExperiments(dir);
    expect(list.length).toBe(dated.length);
    expect(list.every(e => e.question.length > 0)).toBe(true);
    const dates = list.map(e => e.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('canon status', () => {
  it('reads the newest status file and counts typed pages', () => {
    const c = latestCanonStatus();
    expect(c.traditions.length).toBeGreaterThan(0);
    const tibetan = c.traditions.find(t => t.id === 'tibetan');
    if (tibetan) expect(typedPages(tibetan)).toBeGreaterThan(0);
    const t = { ocr_engines: [['esukhia-derge-tengyur', 10], ['gemini-3-flash-preview', 5], ['cbeta-xml-p5@x', 2]] } as never;
    expect(typedPages(t)).toBe(12);
  });
});

describe('freshness rule', () => {
  const base = { proseAsOf: '2026-10-06', openWorkAsOf: '2026-10-06', newestExperiment: '2026-10-06', feedbackOn: '2026-10-06', today: '2026-10-06' };

  it('passes when everything is current', () => {
    expect(checkFreshness(base)).toEqual([]);
  });

  it('flags prose more than 30 days behind the newest experiment, not 30', () => {
    expect(checkFreshness({ ...base, newestExperiment: '2026-11-05', today: '2026-11-05', feedbackOn: '2026-11-05' })).toEqual([]);
    const f = checkFreshness({ ...base, newestExperiment: '2026-11-06', today: '2026-11-06', feedbackOn: '2026-11-06' });
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/PROSE_AS_OF/);
    expect(f[1]).toMatch(/issues\.ts/);
  });

  it('flags a feedback synthesis older than 30 days even when no experiment landed', () => {
    const f = checkFreshness({ ...base, today: '2026-11-20' });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/quality-feedback-themes/);
  });

  it('reads all four dates from the repository', () => {
    const d = readDates(process.cwd());
    for (const v of Object.values(d)) expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('feedback themes', () => {
  it('uses the widget labels and keyword rules', () => {
    expect(classify('Translation requested for "A Book" (Latin) — page 5', '/book/x')).toBe('no-english');
    expect(classify('Reading guide requested for "A Book" (book 1)', '/book/x')).toBe('reading-help');
    expect(classify('The page ocr and text of image do not appear to be aligned', '/book/x')).toBe('wrong-page');
    expect(classify('When I turn notes off it also hides the actual text', '/book/x')).toBe('notes-as-text');
    // The translation-feedback label alone is not a mistranslation: that form also collects layout notes.
    expect(classify('[Translation feedback] "A Book" p.3: magnifier is not aligned', '/book/x')).toBeNull();
    // Scan complaints count only on a book page.
    expect(classify('very low res thumbnail', '/gallery/image/1')).toBeNull();
    expect(classify('This book needs splitting', '/book/x')).toBe('scans');
    expect(classify('Thank you, wonderful site', '/')).toBeNull();
  });

  it('writes no message text, name, email, page path or id', () => {
    const rows = [
      { message: 'Translation requested for "Secret Title" (Latin) — page 5', page: '/book/abc123/page/p1', channel: 'web', name: 'Jane Reader', email: 'jane@example.org', created_at: new Date('2026-09-01'), addressed: true, addressed_link: 'https://sourcelibrary.org/book/abc123' },
      { message: 'This page has errors — not the same as image', page: '/book/def456', channel: 'web', name: 'Bob', email: 'bob@example.org', created_at: new Date('2026-09-02'), addressed_link: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/4405' },
      { message: 'agent report', page: '/', channel: 'mcp', created_at: new Date('2026-09-03') },
      { message: 'test', page: 'https://preview.vercel.app/x', channel: 'web', created_at: new Date('2026-09-04') },
    ];
    const out = synthesize(rows, '2026-10-06');
    const text = JSON.stringify(out);
    for (const secret of ['Secret Title', 'Jane', 'jane@', 'Bob', 'bob@', 'abc123', 'def456', 'not the same as image', 'sourcelibrary.org/book']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(out.reader_reports).toBe(2);
    expect(out.agent_reports_not_themed).toBe(1);
    expect(out.themes.find((t: { id: string }) => t.id === 'wrong-page').issues).toContain(4405);
  });

  it('the committed file holds aggregates only', () => {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/quality-feedback-themes.json'), 'utf8'));
    expect(JSON.stringify(j)).not.toMatch(/@[a-z0-9-]+\.[a-z]/i);
    expect(JSON.stringify(j)).not.toMatch(/\/book\//);
    for (const t of j.themes) {
      expect(Object.keys(t).sort()).toEqual(['books', 'did', 'id', 'issues', 'label', 'marked_done', 'paraphrase', 'reports', 'status']);
    }
  });
});

describe('footer door', () => {
  it('links /quality from Participate, labelled in every locale, and hides it on partner hosts', () => {
    const participate = FOOTER_NAV_COLUMNS.find(c => c.titleKey === 'colParticipate')!;
    expect(participate.links.map(l => l.href)).toContain('/quality');
    for (const strings of Object.values(FOOTER_STRINGS)) expect(strings.qualityCenter).toBeTruthy();
    expect(visibleFooterNavColumns(true).flatMap(c => c.links.map(l => l.href))).not.toContain('/quality');
  });
});
