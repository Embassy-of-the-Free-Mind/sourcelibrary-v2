import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { asksForQuotation, buildSystemPromptBody } from '@/lib/embassy/librarian';

// v3#249: "What did Marsilio Ficino say about melancholy? Quote him." ran one search,
// read title pages, and quoted from memory. A message that asks for an author's words
// now has to read pages in its first round; this pins which messages count.
const { questions } = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../scripts/eval/librarian-quote-requests-249/questions.json'), 'utf8'),
) as { questions: Array<{ id: string; q: string }> };

describe('asksForQuotation', () => {
  it('catches every question in the measured set', () => {
    expect(questions).toHaveLength(12);
    expect(questions.filter(q => !asksForQuotation(q.q)).map(q => q.id)).toEqual([]);
  });

  it('catches the plain phrasings, in English and Spanish', () => {
    for (const q of [
      'Quote him.',
      'Give me one direct quotation from De Vita about scholars and black bile, with the page.',
      'In her own words, what is the soul?',
      'What does Agrippa say about the number seven?',
      'I need the passage verbatim',
      '¿Qué dijo Paracelso sobre la sal? Cítalo.',
      'Dame una cita textual de Ficino',
    ]) expect(asksForQuotation(q), q).toBe(true);
  });

  it('leaves other questions alone (negative controls)', () => {
    for (const q of [
      'Show me an illustration of an alchemical furnace',
      'How many books do you have in Spanish?',
      'Who was Marsilio Ficino?',
      'Atlantis',
      'Tell me about the history of the Rosicrucians',
      'What books do you have on mushrooms?',
    ]) expect(asksForQuotation(q), q).toBe(false);
  });
});

describe('quote-request prompt', () => {
  const prompt = (messageIndex: number, quoteRequest: boolean) =>
    buildSystemPromptBody('', messageIndex, '', 'en', true, false, false, true, quoteRequest);
  const RULE = 'The reader asked for the author\'s own words';

  it('adds the rule only for a quote request, on any message of the thread', () => {
    expect(prompt(1, true)).toContain(RULE);
    expect(prompt(4, true)).toContain(RULE);
    expect(prompt(1, false)).not.toContain(RULE);
  });

  it('names the page-reading tools only where a real book id can exist', () => {
    // On a first message the model has no tool result, so a book id is a guess: 21 of 22
    // such reads found nothing in the measured run. Later messages carry real slugs.
    const lines = (messageIndex: number) => prompt(messageIndex, true).split('\n').find(l => l.includes(RULE)) ?? '';
    expect(lines(1)).toContain('find_passages');
    expect(lines(1)).not.toContain('get_book_page');
    expect(lines(3)).toContain('get_book_page');
  });

  it('changes nothing else in the prompt', () => {
    const [on, off] = [prompt(1, true), prompt(1, false)];
    const added = on.length - off.length;
    const at = on.indexOf(`\n\n**${RULE}`);
    expect(at).toBeGreaterThan(0);
    expect(on.slice(0, at) + on.slice(at + added)).toBe(off);
  });
});
