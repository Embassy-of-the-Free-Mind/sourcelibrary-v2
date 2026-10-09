#!/usr/bin/env node
/**
 * What readers have told us about text quality: themes, counts and what we did,
 * written to src/data/quality-feedback-themes.json for the public /quality page (#5918).
 *
 * PRIOR ART: scripts/audit/feedback-symptom-clusters.mjs clusters feedback by symptom to
 * find one fault reported on several books (an alarm, exit 1, printed rows); it prints
 * messages and has no reader-facing labels or "what we did". scripts/analytics/
 * feedback-triage.mjs classifies the open queue by workflow (bug / request / praise) for
 * triage, not by kind of text fault. This script reuses their reading of the collection
 * and the symptom regexes where they fit, and writes ONLY aggregates.
 *
 * PRIVACY. Feedback rows carry names, emails, IP hashes and free text. The output holds
 * none of them: per theme a count of reports, a count of distinct books, how many were
 * marked done, a paraphrase WRITTEN HERE (never derived from a message), and links to
 * public GitHub issues/PRs that triage attached. No message text, no page paths, no book
 * ids, no dates finer than the first and last day of the window.
 *
 * UNTRUSTED INPUT. Feedback is a public write surface. Nothing here acts on a message;
 * the themes are counted, not believed. Counts are a self-selected stream, not a quality
 * measure, and the page says so (.claude/docs/community-quality-review-design.md).
 *
 * METHOD ($0, no model). Readers only: rows from the web widget (channel "web"); reports
 * that AI assistants send through the public MCP tool are counted but not themed. Rows
 * submitted from a non-Source-Library host (test forms, previews) are dropped. Each row
 * gets the FIRST theme whose rule matches, in the order of THEMES below. Two rules use
 * the widget's own category marker at the start of the message ("Translation requested
 * for", "[Translation feedback]", "Reading guide requested"); the rest are keyword rules.
 * A row that matches no theme is not counted (praise, site bugs, book suggestions).
 *
 *   node --env-file=.env.production.local scripts/analytics/quality-feedback-themes.mjs          # write the JSON
 *   node --env-file=.env.production.local scripts/analytics/quality-feedback-themes.mjs --check  # exit 1 if the JSON's counts differ
 *   node --env-file=.env.production.local scripts/analytics/quality-feedback-themes.mjs --print  # print, write nothing
 *
 * Exit codes: 0 ok / current, 1 --check found different counts, 2 could not read Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getScriptClient } from '../lib/mongo.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'src', 'data', 'quality-feedback-themes.json');
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const PRINT = argv.includes('--print');

const ISSUE = 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/';
const PUBLIC_LINK = /^https:\/\/github\.com\/Embassy-of-the-Free-Mind\/sourcelibrary-v2\/(issues|pull)\/(\d+)$/;

/**
 * Order matters: first match wins, specific faults before the general "the English is
 * wrong". `status` and `did` are our account of the response, as of the date this file
 * was last edited; the counts beside them are regenerated from data.
 */
export const THEMES = [
  {
    id: 'wrong-page',
    label: 'The text belongs to another page',
    rule: /not the same as image|doesn.?t correspond|(ocr|text).{0,30}not.{0,15}aligned|wrong image|chapter \d+ on the image|repeated on this page from/i,
    paraphrase: 'The transcription or English beside a scan was the text of a neighbouring page, or repeated the page before.',
    status: 'in progress',
    did: 'A screen of the whole library for text shifted one page against its image has run. The repair is open.',
    links: [5803],
  },
  {
    id: 'garbled',
    label: 'Garbled or invented transcription',
    rule: /ocr went nuts|garbl|gibberish|\brepeating\b|^repetition$|repeated line|russian characters|\\frac|hallucinat|hardly any text but a lot of translation/i,
    paraphrase: 'A transcription ran into a loop, used the wrong alphabet, wrote formulas instead of letters, or held far more text than the page.',
    status: 'in progress',
    did: 'Reported pages are re-read one at a time. A check that finds garbled pages across the whole library is planned.',
    links: [5313, 4850, 4580],
  },
  {
    id: 'notes-as-text',
    label: 'Notes mixed into the text',
    rule: /notes?.{0,40}(hide|hides|highlight|bracket|actual text)|note or what is text|notes? off.{0,40}text/i,
    paraphrase: 'Notes added in translation looked like the book’s own words, or switching notes off also hid the text.',
    status: 'in progress',
    did: 'Single display faults were fixed in the reader. Notes are being rebuilt as a separate layer that a reader can switch off.',
    links: [5698, 5902, 4069],
  },
  {
    id: 'scans',
    label: 'Scan problems',
    rule: /not split|needs? splitting|didn.?t get split|cropping|upside down|low res|higher res|blank page/i,
    bookOnly: true,
    paraphrase: 'A two-page spread was not split, a scan was badly cropped or upside down, or the image was too small to read.',
    status: 'in progress',
    did: 'Splitting and cropping are fixed book by book when reported. Trimming dark scanner borders across the library is under way.',
    links: [5876, 2454],
  },
  {
    id: 'no-english',
    label: 'No English on the page',
    rule: /^Translation requested for|not translated|needs? translation|no english|untranslated|isn.?t translated|not all (of )?the text is translated|not all pages are translated/i,
    paraphrase: 'A reader reached a page with a transcription but no English, or English for only part of it, and asked for it.',
    status: 'in progress',
    did: 'Each request names one page. It is read in the feedback queue and the page is sent for translation.',
    links: [],
  },
  {
    id: 'catalogue',
    label: 'Wrong edition, author or date',
    rule: /\bedition\b|actually not from|\bnot \d{3,4}\b|bekker|under copyright|wrong (author|date|year|title)/i,
    paraphrase: 'The catalogue named the wrong edition, author or year, or a reader asked whether a book is still in copyright.',
    status: 'in progress',
    did: 'Each report is checked against the title page and the record corrected when it holds up.',
    links: [],
  },
  {
    id: 'mistranslation',
    label: 'The English says something the original does not',
    // The "[Translation feedback]" label alone is not enough: that form also collects notes on
    // image descriptions, layout and test submissions. A keyword must say the meaning is wrong.
    rule: /nonsens|mistransl|messed up translation|translation.{0,20}(wrong|error)|should be:|should be "|entire thing is wrong|from another source|problemas de traduc/i,
    paraphrase: 'A reader of the original language pointed to a sentence whose English changed or lost the meaning.',
    status: 'in progress',
    did: 'Single reports are corrected on the page. The library-wide picture is measured against published translations, and the fixes it points to are in progress.',
    links: [5700],
  },
  {
    id: 'reading-help',
    label: 'Asked for a guide or a summary',
    rule: /^Reading guide requested|summary generated for/i,
    paraphrase: 'A reader asked for a reading guide or a summary of the book they were reading.',
    status: 'in progress',
    did: 'Summaries and reading guides exist for some books. Requests are recorded per book and answered one at a time.',
    links: [],
  },
];

const isAgent = (r) => r.channel === 'mcp' || (r.user_agent || '').startsWith('SourceLibrary-MCP');
// The widget records either a path or a full URL. A full URL on another host is a test form or a preview.
// The team also uses the button for meeting notes; those are not reader reports.
const teamNote = (message) => /^FROM MEETING\b/.test(String(message || '').trim());
const offSite = (page) => /^https?:\/\//.test(page || '') && !/^https?:\/\/([a-z0-9-]+\.)*sourcelibrary\.org(\/|$)/i.test(page);
const bookKey = (page) => String(page || '').match(/\/book\/([^/?#]+)/)?.[1] ?? null;
const day = (d) => new Date(d).toISOString().slice(0, 10);

export function classify(message, page) {
  const m = String(message || '').trim();
  return THEMES.find((t) => t.rule.test(m) && (!t.bookOnly || bookKey(page)))?.id ?? null;
}

export function synthesize(rows, generatedOn) {
  const readers = rows.filter((r) => !isAgent(r) && !offSite(r.page) && !teamNote(r.message));
  const agents = rows.filter(isAgent).length;
  const by = new Map(THEMES.map((t) => [t.id, []]));
  for (const r of readers) {
    const id = classify(r.message, r.page);
    if (id) by.get(id).push(r);
  }
  const dates = readers.map((r) => r.created_at).filter(Boolean).map((d) => new Date(d).getTime());
  const themes = THEMES.map((t) => {
    const items = by.get(t.id);
    const linked = new Set(t.links);
    for (const r of items) {
      const m = String(r.addressed_link || '').match(PUBLIC_LINK);
      if (m && m[1] === 'issues') linked.add(Number(m[2]));
    }
    return {
      id: t.id,
      label: t.label,
      reports: items.length,
      books: new Set(items.map((r) => bookKey(r.page)).filter(Boolean)).size,
      marked_done: items.filter((r) => r.addressed === true).length,
      paraphrase: t.paraphrase,
      status: t.status,
      did: t.did,
      issues: [...linked].sort((a, b) => b - a),
    };
  })
    .filter((t) => t.reports > 0)
    .sort((a, b) => b.reports - a.reports);
  return {
    generated_on: generatedOn,
    script: 'scripts/analytics/quality-feedback-themes.mjs',
    source: 'Mongo bookstore.feedback, rows sent from the feedback button on the site',
    method:
      'Each report gets the first theme whose rule matches: the widget’s own label at the start of the message (a translation request, translation feedback, a reading-guide request) or a keyword rule. No model reads the messages. Reports that match no theme (thanks, site bugs, book suggestions) are not counted.',
    window: dates.length ? { first: day(Math.min(...dates)), last: day(Math.max(...dates)) } : null,
    reader_reports: readers.length,
    themed_reports: themes.reduce((s, t) => s + t.reports, 0),
    agent_reports_not_themed: agents,
    issue_base: ISSUE,
    themes,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set: run with --env-file=.env.production.local');
    process.exit(2);
  }
  let rows;
  let client;
  try {
    let db;
    ({ client, db } = await getScriptClient({ timeoutMs: 120_000 }));
    rows = await db.collection('feedback')
      .find({}, { projection: { message: 1, page: 1, channel: 1, user_agent: 1, created_at: 1, addressed: 1, addressed_link: 1 } })
      .toArray();
  } catch (e) {
    console.error(`could not read feedback: ${e.message}`);
    process.exit(2);
  } finally {
    await client?.close().catch(() => {});
  }
  const out = synthesize(rows, day(Date.now()));
  const text = JSON.stringify(out, null, 2) + '\n';
  if (PRINT) {
    process.stdout.write(text);
  } else if (CHECK) {
    const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
    const strip = (j) => j && JSON.stringify({ ...j, generated_on: null });
    if (strip(prev) === strip(out)) {
      console.log(`feedback themes current (file dated ${prev.generated_on})`);
    } else {
      console.log('feedback themes differ from the committed file:');
      for (const t of out.themes) {
        const p = prev?.themes?.find((x) => x.id === t.id);
        console.log(`  ${t.id.padEnd(16)} reports ${p?.reports ?? 0} -> ${t.reports}, done ${p?.marked_done ?? 0} -> ${t.marked_done}`);
      }
      console.log('Regenerate: node --env-file=.env.production.local scripts/analytics/quality-feedback-themes.mjs');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`wrote ${path.relative(ROOT, OUT)}: ${out.themed_reports} of ${out.reader_reports} reader reports in ${out.themes.length} themes`);
  }
}
