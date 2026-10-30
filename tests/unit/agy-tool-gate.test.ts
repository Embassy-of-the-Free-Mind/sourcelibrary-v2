import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// #4763 / #5924: agy 1.4.6 opens the page image with `read_file {Path}`. A gate that allowed only `view_file` denied it,
// and the model then wrote an invented page. Both tools are allowed inside the workspace; everything else is denied.
const GATE = path.resolve(__dirname, '../../scripts/lib/agy-tool-gate.py');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
const decide = (name: string, args: Record<string, string>, task = 'ocr') =>
  JSON.parse(execFileSync('python3', [GATE], { input: JSON.stringify({ toolCall: { name, args } }), env: { ...process.env, AGY_GATE_ROOT: root, AGY_GATE_TASK: task } }).toString()).decision;

describe('agy-tool-gate', () => {
  it('allows view_file and read_file on the image inside the workspace', () => {
    expect(decide('view_file', { AbsolutePath: path.join(root, 'p.jpg') })).toBe('allow');
    expect(decide('read_file', { Path: path.join(root, 'p.jpg') })).toBe('allow');
  });
  it('denies a read outside the workspace, or through ..', () => {
    expect(decide('read_file', { Path: '/etc/passwd' })).toBe('deny');
    expect(decide('read_file', { Path: path.join(root, '..', 'x.jpg') })).toBe('deny');
  });
  it('denies every other tool', () => {
    expect(decide('run_command', { CommandLine: 'ls' })).toBe('deny');
    expect(decide('write_to_file', { TargetFile: path.join(root, 'x') })).toBe('deny');
  });
  // #7751: the grounded adjudicator allows web search and page reads, and nothing on disk or in a shell.
  it('search task: allows search_web, denies files and commands', () => {
    expect(decide('search_web', { query: 'x' }, 'search')).toBe('allow');
    expect(decide('read_file', { Path: path.join(root, 'p.jpg') }, 'search')).toBe('deny');
    expect(decide('run_command', { CommandLine: 'curl x' }, 'search')).toBe('deny');
    expect(decide('search_web', { query: 'x' })).toBe('deny');
  });
});
