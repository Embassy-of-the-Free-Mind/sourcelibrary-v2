/**
 * Batch API inputs are deleted once create returns (#5544). Left for the hourly
 * sweep, bulk-reocr-local's inputs filled a project's 20 GiB File API quota and
 * every other lane's upload to it 429'd.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { createThenDeleteInput, deleteGeminiFile } from '../../scripts/lib/gemini-batch-input-file.mjs';

const okFetch = () => vi.fn(async () => ({ ok: true, status: 200 }));

describe('createThenDeleteInput', () => {
  it('deletes the input after a successful create and returns the job', async () => {
    const fetchImpl = okFetch();
    const job = await createThenDeleteInput({
      fileName: 'files/abc', apiKey: 'K', fetchImpl,
      create: async () => ({ name: 'batches/1' }),
    });
    expect(job).toEqual({ name: 'batches/1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string }];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/files/abc?key=K');
    expect(init.method).toBe('DELETE');
  });

  it('deletes the input when create fails, and rethrows the create error', async () => {
    const fetchImpl = okFetch();
    await expect(createThenDeleteInput({
      fileName: 'files/abc', apiKey: 'K', fetchImpl,
      create: async () => { throw new Error('Batch create failed (429)'); },
    })).rejects.toThrow('Batch create failed (429)');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not delete before create has returned', async () => {
    const order: string[] = [];
    const fetchImpl = vi.fn(async () => { order.push('delete'); return { ok: true, status: 200 }; });
    await createThenDeleteInput({
      fileName: 'files/abc', apiKey: 'K', fetchImpl,
      create: async () => { order.push('create'); return {}; },
    });
    expect(order).toEqual(['create', 'delete']);
  });

  it('a failed delete never turns a submitted job into an error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network'); });
    const job = await createThenDeleteInput({
      fileName: 'files/abc', apiKey: 'K', fetchImpl,
      create: async () => ({ name: 'batches/1' }),
    });
    expect(job).toEqual({ name: 'batches/1' });
  });
});

describe('deleteGeminiFile', () => {
  it('treats 404 as already gone', async () => {
    expect(await deleteGeminiFile('files/x', 'K', { fetchImpl: async () => ({ ok: false, status: 404 }) as Response })).toBe(true);
  });
  it('reports other failures as false', async () => {
    expect(await deleteGeminiFile('files/x', 'K', { fetchImpl: async () => ({ ok: false, status: 500 }) as Response })).toBe(false);
  });
  it('does nothing without a file name or key', async () => {
    const fetchImpl = vi.fn();
    expect(await deleteGeminiFile('', 'K', { fetchImpl })).toBe(false);
    expect(await deleteGeminiFile('files/x', '', { fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('file-based Batch submitters delete their input', () => {
  const root = path.join(__dirname, '..', '..');
  for (const rel of ['scripts/batch/bulk-reocr-local.mjs', 'scripts/maintenance/reread-loop-pages.mjs']) {
    it(`${rel} wraps its file-input create in createThenDeleteInput`, () => {
      const src = readFileSync(path.join(root, rel), 'utf8');
      expect(src).toMatch(/createThenDeleteInput\(\{\s*fileName/);
    });
  }
});
