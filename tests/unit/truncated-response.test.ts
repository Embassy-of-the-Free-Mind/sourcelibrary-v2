import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  isTruncatedCandidate,
  truncationFailReason,
  TRUNCATING_FINISH_REASONS,
  candidateText,
} from '../../scripts/lib/truncated-response.mjs';
import {
  isTruncatedCandidate as isTruncatedTs,
  TRUNCATING_FINISH_REASONS as REASONS_TS,
  candidateText as candidateTextTs,
} from '../../src/lib/truncated-response';

/**
 * A partial answer is a FAILED read, not a short one.
 *
 * Gemini returns `finishReason: 'MAX_TOKENS'` with the partial text still attached.
 * Every collector here branched on RECITATION (a refusal, no text) and on missing
 * text — a truncation is neither, so it fell through and was stored as a finished
 * page. 48 pages of Stefan's Forum of Conscience books held a 107-382 character stub
 * ending mid-word; `pages_ocr` counted them, so every completeness check passed, and
 * the translate lane then stored the model's "Please provide the Latin text…" reply
 * as the page's translation, live to readers (#4890).
 *
 * The second describe block is the part that actually guards anything. A unit test of
 * the helper stays green when someone deletes the branch at a call site, and there are
 * eleven call sites — which is precisely the failure this repo has shipped twice
 * before (the R2 key guard added to one helper and called done, #3362/#3365).
 */

const REPO = path.resolve(__dirname, '../..');

describe('isTruncatedCandidate', () => {
  it('refuses the shape that reached readers: text present, MAX_TOKENS', () => {
    expect(isTruncatedCandidate({ finishReason: 'MAX_TOKENS' })).toBe(true);
    expect(truncationFailReason({ finishReason: 'MAX_TOKENS' })).toBe('truncated:MAX_TOKENS');
  });

  it('passes a finished read — the case that must not be thrown away', () => {
    expect(isTruncatedCandidate({ finishReason: 'STOP' })).toBe(false);
  });

  it('leaves RECITATION to the refusal branch that already handles it', () => {
    // Both are failures, but they mean different things to a human reading the
    // page and they have different recoveries (#2065 escalates the model).
    expect(isTruncatedCandidate({ finishReason: 'RECITATION' })).toBe(false);
    expect(isTruncatedCandidate({ finishReason: 'SAFETY' })).toBe(false);
  });

  it('passes an UNKNOWN reason rather than discarding a good read', () => {
    // Providers add finish reasons. Refusing everything that is not STOP would
    // throw away real transcriptions the first time Google ships a new value —
    // the more expensive mistake of the two.
    expect(isTruncatedCandidate({ finishReason: 'SOME_FUTURE_REASON' })).toBe(false);
  });

  it('survives a missing or malformed candidate', () => {
    expect(isTruncatedCandidate(undefined)).toBe(false);
    expect(isTruncatedCandidate(null)).toBe(false);
    expect(isTruncatedCandidate({})).toBe(false);
    expect(isTruncatedCandidate({ finishReason: '' })).toBe(false);
    expect(isTruncatedCandidate({ finishReason: 'max_tokens' })).toBe(true); // case-insensitive
  });

  it('the .mjs and .ts twins agree — they guard the same write path', () => {
    expect([...REASONS_TS].sort()).toEqual([...TRUNCATING_FINISH_REASONS].sort());
    for (const r of ['MAX_TOKENS', 'LENGTH', 'STOP', 'RECITATION', 'WHATEVER']) {
      expect(isTruncatedTs({ finishReason: r })).toBe(isTruncatedCandidate({ finishReason: r }));
    }
  });
});

/**
 * Files that read a model candidate AND store page text. Same probe shape as
 * `ocr-write-paths-guarded.test.ts`, widened to translation writers because the
 * #4890 harm arrived on the translation side of the page.
 */
const WRITE_LINE =
  /(?:'(?:ocr|translation)\.data':\s*(?!null\b|undefined\b|''|\{|regexFilter)[A-Za-z(]|^\s*data:\s*(?:text|ocrText|result\.text|ocrResult\.text|translated|translation|v\.text)\b)/;

/** Files that write the field but never from a model response of their own. */
const ALLOWED: Record<string, string> = {
  // (none today — every candidate-reading writer consults the finish reason)
};

function candidateReaders(): string[] {
  let files: string[];
  try {
    files = execFileSync(
      'git',
      ['grep', '-lE', String.raw`candidates\?\.\[0\]|candidates\[0\]`, '--', 'scripts', 'src'],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ).split('\n').filter(Boolean);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
  return files.filter(
    (f) =>
      !/(^|\/)(_archived|tests)\//.test(f) &&
      !/\/(eval|audit)\//.test(f) &&
      /\.(mjs|ts|tsx|js)$/.test(f),
  );
}

function textWriters(): string[] {
  return candidateReaders().filter((f) => {
    const lines = readFileSync(path.join(REPO, f), 'utf8').split('\n');
    return lines.some((l, i) => {
      if (!WRITE_LINE.test(l)) return false;
      if (/'(?:ocr|translation)\.data'/.test(l)) return true;
      // A bare `data: text` is ambiguous — it only counts inside an ocr or
      // translation subdocument, named within the preceding few lines.
      return lines
        .slice(Math.max(0, i - 8), i)
        .some((prev) => /\b(?:ocr|translation)\b\s*[:=]|'(?:ocr|translation)'/.test(prev));
    });
  });
}

describe('every writer that reads a model candidate checks whether it finished (#4890)', () => {
  it('no candidate-reading text writer ignores the finish reason', () => {
    const unguarded = textWriters().filter(
      (f) => !ALLOWED[f] && !/truncated-response/.test(readFileSync(path.join(REPO, f), 'utf8')),
    );

    expect(
      unguarded,
      [
        'These files store model text without asking whether the provider finished (#4890).',
        'Call isTruncatedCandidate() on the candidate before the write, or add the file to',
        'ALLOWED with the reason its text is not a model response.',
      ].join(' '),
    ).toEqual([]);
  });

  it('the probe still matches — a check that finds nothing proves nothing', () => {
    const files = textWriters();
    expect(files.length).toBeGreaterThan(8);
    // The two lanes that actually wrote the #4890 stubs.
    expect(files).toContain('scripts/workers/batch-collector.mjs');
    expect(files).toContain('src/app/api/books/[id]/batch-ocr-async/route.ts');
  });

  it('realtime-translate.mjs is guarded even though it writes through translate-core', () => {
    // It calls Gemini directly and hands the text to a shared writer, so the probe
    // above cannot see its write. Named here so a future edit cannot quietly drop
    // the guard from the one translation lane that runs outside the batch API.
    const src = readFileSync(path.join(REPO, 'scripts/batch/realtime-translate.mjs'), 'utf8');
    expect(src).toMatch(/truncated-response/);
    expect(src).toMatch(/isTruncatedCandidate\(/);
  });
});

/**
 * A candidate's text is ALL of its text parts (#5813).
 *
 * Gemini 3 answered 160 of 2,929 finished Batch OCR requests in two text parts, every one
 * with finishReason STOP. Both collectors stored `parts[0].text`, so those pages were written
 * cut off over a complete older transcription — one of them as 59 characters ending
 * `<language>Ancient Greek</`. The fixture below is that response's shape.
 */
describe('candidateText', () => {
  const twoParts = {
    finishReason: 'STOP',
    content: { parts: [
      { text: '<scan-quality>good</scan-quality>\n<language>Ancient Greek</' },
      { text: 'language>\n<page-num>134</page-num>\n\n6 ἵνα μὴ φαίνηται σοφὸς παρ’ ἑαυτῷ.', thoughtSignature: 'abc' },
    ] },
  };

  it('joins every text part in order — the page that was stored as 59 characters', () => {
    const text = candidateText(twoParts);
    expect(text).toBe(twoParts.content.parts[0].text + twoParts.content.parts[1].text);
    expect(text).toContain('<language>Ancient Greek</language>');
  });

  it('negative control: reading the first part alone loses the page', () => {
    expect(twoParts.content.parts[0].text).not.toContain('σοφὸς');
    expect(candidateText(twoParts)).toContain('σοφὸς');
  });

  it('a one-part answer is unchanged, and thought parts are never the answer', () => {
    expect(candidateText({ content: { parts: [{ text: 'abc' }] } })).toBe('abc');
    expect(candidateText({ content: { parts: [{ text: 'reasoning', thought: true }, { text: 'abc' }] } })).toBe('abc');
  });

  it("returns '' for a refusal or a malformed candidate, so `if (!text)` still fires", () => {
    expect(candidateText({ finishReason: 'RECITATION' })).toBe('');
    expect(candidateText({ content: { parts: [] } })).toBe('');
    expect(candidateText({ content: { parts: [{ inlineData: {} }] } } as never)).toBe('');
    expect(candidateText(undefined)).toBe('');
    expect(candidateText(null)).toBe('');
  });

  it('the .mjs and .ts twins agree', () => {
    for (const c of [twoParts, { content: { parts: [{ text: 'x' }] } }, {}, null]) {
      expect(candidateTextTs(c as never)).toBe(candidateText(c as never));
    }
  });
});

describe('no page-text writer reads only the first part of a candidate (#5813)', () => {
  const FIRST_PART = /parts\??\.?\[0\]\??\.text/;

  it('every candidate-reading text writer takes the text through candidateText()', () => {
    const firstPartOnly = textWriters().filter((f) => FIRST_PART.test(readFileSync(path.join(REPO, f), 'utf8')));
    expect(
      firstPartOnly,
      [
        'These files store page text read from `parts[0].text`. Gemini can split one answer',
        'across several text parts, and the first alone is a cut-off page (#5813).',
        'Use candidateText(candidate) from truncated-response.',
      ].join(' '),
    ).toEqual([]);
  });

  it('the probe still matches the pattern it forbids', () => {
    expect(FIRST_PART.test('const text = candidate?.content?.parts?.[0]?.text;')).toBe(true);
    expect(FIRST_PART.test('const text = data.candidates[0].content.parts[0].text')).toBe(true);
    expect(FIRST_PART.test('const text = candidateText(candidate);')).toBe(false);
  });
});
