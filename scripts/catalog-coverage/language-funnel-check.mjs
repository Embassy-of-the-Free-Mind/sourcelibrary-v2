#!/usr/bin/env node
// Re-fetch every source behind the per-language funnel figure (#6256) and check that the
// quoted sentence, or at least the number, is on the page.
//
// Who runs it: whoever edits results/language-funnel-2026-10.json, on any machine with
// network access. No secrets, no database, $0.
//
//   node scripts/catalog-coverage/language-funnel-check.mjs [file.json ...] [--write]
//
// Each figure gets check.status:
//   quote_found   the quote is on the fetched page (whitespace/quote marks normalised)
//   number_found  the quote is not, but the figure's number is — read the page by hand
//   not_found     the page loaded and has neither
//   fetch_failed  the page did not load (bot wall, timeout, paywall) — read it by hand
//   own_measurement  kind 'ours': not fetched; produced_by names the script or document
// A status other than quote_found is not proof the figure is wrong; it means a person
// has to open the page. --write stores the status back into the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const write = args.includes('--write');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) files.push(path.join(here, 'results/language-funnel-2026-10.json'));

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const stripHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (type.includes('pdf') || buf.subarray(0, 4).toString() === '%PDF') {
    // pdftotext (poppler) if present; without it a PDF is a by-hand check.
    try {
      return execFileSync('pdftotext', ['-q', '-', '-'], { input: buf, maxBuffer: 256 * 1024 * 1024 }).toString();
    } catch {
      throw new Error('PDF (pdftotext not available or failed)');
    }
  }
  return stripHtml(buf.toString('utf8'));
}

// The number as a page might print it: 3,000,000 / 3 000 000 / 3.000.000 / "3 million".
function numberForms(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return [];
  const digits = String(Math.round(value));
  const grouped = (sep) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const forms = new Set([digits, grouped(','), grouped(' '), grouped('.')]);
  if (value >= 1e6) forms.add(`${+(value / 1e6).toFixed(2)} million`);
  if (value >= 1e4 && value % 1e4 === 0) forms.add(`${value / 1e4}万`);
  return [...forms].map(norm);
}

const pages = new Map();
const tally = {};
for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const lang of data.languages ?? []) {
    for (const fig of lang.figures ?? []) {
      let status;
      let detail = null;
      if (fig.kind === 'ours') {
        // Our own measurement: the evidence is the script or document in produced_by, not a web page.
        status = 'own_measurement';
      } else if (!fig.url) {
        status = 'fetch_failed';
        detail = 'no url';
      } else {
        if (!pages.has(fig.url)) pages.set(fig.url, fetchText(fig.url).then(norm, (e) => e));
        const page = await pages.get(fig.url);
        if (page instanceof Error) {
          status = 'fetch_failed';
          detail = page.message;
        } else if (fig.quote && page.includes(norm(fig.quote))) {
          status = 'quote_found';
        } else if (numberForms(fig.value).some((f) => page.includes(f))) {
          status = 'number_found';
        } else {
          status = 'not_found';
        }
      }
      tally[status] = (tally[status] ?? 0) + 1;
      // A by-hand verdict already recorded in the file outranks a failed re-fetch.
      if (!(fig.check?.by_hand && status !== 'quote_found')) {
        fig.check = { ...(fig.check?.by_hand ? { by_hand: fig.check.by_hand } : {}), status, ...(detail ? { detail } : {}), checked: new Date().toISOString().slice(0, 10) };
      }
      console.log(`${status.padEnd(13)} ${lang.language.padEnd(10)} ${String(fig.stage).padEnd(11)} ${String(fig.value ?? fig.share).padEnd(12)} ${fig.url ?? ''}${detail ? `  (${detail})` : ''}`);
    }
  }
  if (write) writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
console.log('\n' + Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join(' · '));
