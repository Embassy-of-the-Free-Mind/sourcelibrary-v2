#!/usr/bin/env node

// Source Library CLI — search, read, and cite historical texts from the terminal.
// Same API as the MCP server, but with human-friendly output.

import {
  searchLibrary,
  searchPassages,
  searchWithinBook,
  listBooks,
  getBook,
  getBookText,
  getQuote,
  searchImages,
  submitFeedback,
} from "./api.js";

// ── Formatting helpers ────────────────────────────────────────────────

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";

function dim(s: string) { return `${DIM}${s}${RESET}`; }
function bold(s: string) { return `${BOLD}${s}${RESET}`; }
function cyan(s: string) { return `${CYAN}${s}${RESET}`; }
function green(s: string) { return `${GREEN}${s}${RESET}`; }

function truncate(s: string | undefined | null, max: number): string {
  if (!s) return "";
  const clean = s.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

function wrap(text: string, width = 80, indent = 0): string {
  const prefix = " ".repeat(indent);
  const words = text.replace(/\n/g, " ").split(/\s+/);
  const lines: string[] = [];
  let line = prefix;
  for (const word of words) {
    if (line.length + word.length + 1 > width && line.trim()) {
      lines.push(line);
      line = prefix + word;
    } else {
      line += (line.trim() ? " " : "") + word;
    }
  }
  if (line.trim()) lines.push(line);
  return lines.join("\n");
}

// ── Output formatters ─────────────────────────────────────────────────

type AnyRecord = Record<string, unknown>;

function formatSearchResults(data: AnyRecord) {
  const results = data.results as AnyRecord[] | undefined;
  console.log(dim(`${data.total} results for "${data.query}"\n`));
  if (!results?.length) return;
  for (const r of results) {
    const badge = r.type === "page" ? dim("[page]") : "";
    console.log(`  ${bold(r.title as string)} ${badge}`);
    console.log(`  ${dim((r.author as string) || "Unknown")} · ${dim(String(r.published || ""))} · ${dim(r.language as string || "")}`);
    if (r.snippet) console.log(`  ${dim(">")} ${truncate(r.snippet as string, 120)}`);
    if (r.page_number) console.log(`  ${dim("p.")} ${r.page_number}`);
    console.log(`  ${cyan(r.url as string)}`);
    console.log();
  }
}

function formatPassages(data: AnyRecord) {
  const passages = data.passages as AnyRecord[] | undefined;
  console.log(dim(`${data.total} passages for "${data.query}"\n`));
  if (!passages?.length) return;
  for (const p of passages) {
    console.log(`  ${bold(p.title as string)} ${dim("p." + String(p.page || "?"))}`);
    console.log(`  ${dim((p.author as string) || "Unknown")} · ${dim(String(p.published || ""))}`);
    if (p.snippet) console.log(`  ${dim(">")} ${truncate(p.snippet as string, 120)}`);
    console.log(`  ${cyan(p.url as string)}`);
    console.log();
  }
}

function formatWithinBook(data: AnyRecord) {
  const results = data.results as AnyRecord[] | undefined;
  console.log(dim(`${data.total} matches in book ${data.book_id}\n`));
  if (!results?.length) return;
  for (const r of results) {
    console.log(`  ${bold("p." + String(r.page))} ${dim(`(${r.source || "text"})`)}`);
    if (r.snippet) console.log(`  ${dim(">")} ${truncate(r.snippet as string, 120)}`);
    console.log(`  ${cyan(r.url as string)}`);
    console.log();
  }
}

function formatBooks(data: AnyRecord) {
  const books = data.books as AnyRecord[] | undefined;
  console.log(dim(`${data.total} books (showing ${data.showing})\n`));
  if (!books?.length) return;
  for (const b of books) {
    const pct = typeof b.translation_percent === "number" ? ` ${green(Math.round(b.translation_percent as number) + "% translated")}` : "";
    console.log(`  ${bold(b.title as string)}${pct}`);
    console.log(`  ${dim((b.author as string) || "Unknown")} · ${dim(String(b.published || ""))} · ${dim(b.language as string || "")}`);
    console.log(`  ${dim("id:")} ${b.id}  ${cyan(b.url as string)}`);
    console.log();
  }
}

function formatBook(data: AnyRecord) {
  console.log(bold(data.title as string));
  if (data.original_title) console.log(dim(data.original_title as string));
  console.log(`${dim((data.author as string) || "Unknown")} · ${dim(String(data.published || ""))} · ${dim(data.language as string || "")}`);
  if (data.doi) console.log(`${dim("DOI:")} ${data.doi}`);
  console.log(`${dim("Pages:")} ${data.pages_count}  ${dim("OCR:")} ${data.pages_ocr}  ${dim("Translated:")} ${data.pages_translated}`);

  const idx = data.index as AnyRecord | undefined;
  if (idx?.has_index) {
    console.log(`${dim("Index:")} ${idx.concepts} concepts, ${idx.people} people, ${idx.places} places, ${idx.keywords} keywords`);
  }

  const summary = data.reading_summary as AnyRecord | undefined;
  if (summary?.overview) {
    console.log(`\n${bold("Summary")}`);
    console.log(wrap(summary.overview as string, 80, 2));
  }

  const chapters = data.chapters as AnyRecord[] | undefined;
  if (chapters?.length) {
    console.log(`\n${bold("Chapters")}`);
    for (const ch of chapters) {
      console.log(`  ${dim("p." + String(ch.page || ch.start_page || "?"))} ${ch.title || ch.heading}`);
    }
  }

  console.log(`\n${cyan(data.url as string)}`);
}

function formatText(data: unknown) {
  if (typeof data === "string") {
    process.stdout.write(data);
    return;
  }
  // JSON format — print pages sequentially
  const obj = data as AnyRecord;
  const pages = obj.pages as AnyRecord[] | undefined;
  if (!pages?.length) {
    console.log(dim("No text found."));
    return;
  }
  for (const p of pages) {
    console.log(dim(`\n── p.${p.page_number} ──`) + `  ${dim(p.url as string || "")}`);
    if (p.translation) console.log(p.translation);
    else if (p.ocr) console.log(p.ocr);
  }
}

function formatImages(data: AnyRecord) {
  const images = data.images as AnyRecord[] | undefined;
  console.log(dim(`${data.total} images (showing ${data.showing})\n`));
  if (!images?.length) return;
  for (const img of images) {
    const book = img.book as AnyRecord | undefined;
    console.log(`  ${bold(truncate(img.description as string, 80))}`);
    console.log(`  ${dim(img.type as string || "image")} · ${dim(book?.title as string || "")} (${dim(String(book?.year || ""))})`);
    if (img.subjects) console.log(`  ${dim("Subjects:")} ${(img.subjects as string[]).join(", ")}`);
    console.log(`  ${cyan(img.url as string)}`);
    if (img.book_url) console.log(`  ${dim("In book:")} ${cyan(img.book_url as string)}`);
    console.log();
  }
}

// ── CLI argument parsing ──────────────────────────────────────────────

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const command = argv[0] || "help";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[arg.slice(2)] = argv[i + 1];
        i++;
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function flag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagNum(flags: Record<string, string | boolean>, key: string): number | undefined {
  const v = flag(flags, key);
  return v !== undefined ? Number(v) : undefined;
}

function flagBool(flags: Record<string, string | boolean>, key: string): boolean | undefined {
  const v = flags[key];
  if (v === true) return true;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

// ── Commands ──────────────────────────────────────────────────────────

const HELP = `${bold("source-library")} — search, read, and cite 1,200+ rare historical texts

${bold("USAGE")}
  source-library <command> [args] [--flags]

${bold("COMMANDS")}
  ${bold("Search & Discovery")}
    search <query>              Full-text search across all books and pages
    translations <query>        Search inside translated text across the library
    within <book_id> <query>    Search inside a specific book
    books [--search=...] [--language=...] [--sort=...]
                                Browse/filter the book collection

  ${bold("Reading")}
    book <book_id>              Detailed book info (summary, chapters, stats)
    quote <book_id> <page>      Get exact text of a single page for quoting
    text <book_id> [--from=N] [--to=N] [--content=translation|ocr|both]
                                Read a book — returns 50+ pages in one call

  ${bold("Gallery")}
    images [--query=...] [--type=...] [--subject=...] [--book=...]
                                Search 50,000+ historical illustrations

  ${bold("Feedback")}
    feedback <message>          Submit feedback to the Source Library team
                                [--name=...] [--email=...] [--page=...]

  ${bold("Other")}
    help                        Show this help
    json <command> [args...]    Output raw JSON (for piping)

${bold("FLAGS")}
  --language=Latin     Filter by language
  --year-from=1400     Publication year range start
  --year-to=1700       Publication year range end
  --limit=20           Max results
  --sort=relevance     Sort order
  --json               Output raw JSON instead of formatted text

${bold("EXAMPLES")}
  source-library search "philosopher's stone" --language=Latin
  source-library translations "prima materia" --limit=5
  source-library text 694f49d3... --from=1 --to=50
  source-library books --language=German --sort=title-asc
  source-library images --subject=alchemy --type=emblem
  source-library feedback "Love this translation of Fludd!" --name="Jane"
  source-library search "Paracelsus" | jq .results

${bold("PIPING")}
  All commands support --json for machine-readable output.
  The 'json' prefix is an alias: source-library json search "alchemy"

${dim("https://sourcelibrary.org/developers")}
`;

async function run() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log(HELP);
    process.exit(0);
  }

  const { command, positional, flags } = parseArgs(args);
  const jsonMode = command === "json" || flagBool(flags, "json") === true;

  // For "json" prefix, shift command
  let cmd = command;
  let pos = positional;
  if (command === "json") {
    cmd = positional[0] || "help";
    pos = positional.slice(1);
  }

  try {
    let result: unknown;

    switch (cmd) {
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return;

      case "version":
      case "--version":
      case "-v":
        console.log("source-library 4.1.0");
        return;

      case "search": {
        const query = pos.join(" ");
        if (!query) { console.error("Usage: source-library search <query>"); process.exit(1); }
        result = await searchLibrary({
          query,
          language: flag(flags, "language"),
          year_from: flagNum(flags, "year-from"),
          year_to: flagNum(flags, "year-to"),
          has_doi: flagBool(flags, "doi"),
          has_translation: flagBool(flags, "translated"),
          sort: flag(flags, "sort"),
          limit: flagNum(flags, "limit"),
          offset: flagNum(flags, "offset"),
        });
        if (!jsonMode) { formatSearchResults(result as AnyRecord); return; }
        break;
      }

      case "translations":
      case "passages": {
        const query = pos.join(" ");
        if (!query) { console.error("Usage: source-library translations <query>"); process.exit(1); }
        result = await searchPassages({
          query,
          language: flag(flags, "language"),
          year_from: flagNum(flags, "year-from"),
          year_to: flagNum(flags, "year-to"),
          book_id: flag(flags, "book"),
          limit: flagNum(flags, "limit"),
        });
        if (!jsonMode) { formatPassages(result as AnyRecord); return; }
        break;
      }

      case "within": {
        const bookId = pos[0];
        const query = pos.slice(1).join(" ");
        if (!bookId || !query) { console.error("Usage: source-library within <book_id> <query>"); process.exit(1); }
        result = await searchWithinBook({ book_id: bookId, query });
        if (!jsonMode) { formatWithinBook(result as AnyRecord); return; }
        break;
      }

      case "books": {
        result = await listBooks({
          search: pos.join(" ") || flag(flags, "search"),
          language: flag(flags, "language"),
          category: flag(flags, "category"),
          sort: flag(flags, "sort"),
          limit: flagNum(flags, "limit"),
          skip: flagNum(flags, "skip"),
        });
        if (!jsonMode) { formatBooks(result as AnyRecord); return; }
        break;
      }

      case "book": {
        const bookId = pos[0];
        if (!bookId) { console.error("Usage: source-library book <book_id>"); process.exit(1); }
        result = await getBook({ book_id: bookId });
        if (!jsonMode) { formatBook(result as AnyRecord); return; }
        break;
      }

      case "quote": {
        const bookId = pos[0];
        const pageNum = pos[1] ? Number(pos[1]) : flagNum(flags, "page");
        if (!bookId || !pageNum) { console.error("Usage: source-library quote <book_id> <page>"); process.exit(1); }
        result = await getQuote({ book_id: bookId, page: pageNum });
        if (!jsonMode) {
          const q = result as AnyRecord;
          const quote = q.quote as AnyRecord | undefined;
          const cit = q.citation as AnyRecord | undefined;
          if (quote || cit) {
            console.log(bold((quote?.display_title || quote?.book_title || cit?.title || "") as string));
            console.log(dim(`${quote?.author || "Unknown"} · p.${quote?.page || pageNum}`));
            if (cit?.inline) console.log(dim(`Citation: ${cit.inline}`));
          }
          const translation = quote?.translation || q.translation;
          if (translation) {
            console.log(`\n${bold("Translation")}`);
            console.log(wrap(translation as string, 80, 2));
          }
          const original = quote?.original || q.original;
          if (original) {
            console.log(`\n${bold("Original")}`);
            console.log(wrap(original as string, 80, 2));
          }
          if (cit?.url) console.log(`\n${cyan(cit.url as string)}`);
          return;
        }
        break;
      }

      case "text":
      case "read": {
        const bookId = pos[0];
        if (!bookId) { console.error("Usage: source-library text <book_id> [--from=N] [--to=N]"); process.exit(1); }
        result = await getBookText({
          book_id: bookId,
          content: flag(flags, "content") || "translation",
          from: flagNum(flags, "from"),
          to: flagNum(flags, "to"),
          format: jsonMode ? "json" : (flag(flags, "format") || "plain"),
          include_metadata: flagBool(flags, "metadata"),
        });
        if (!jsonMode) { formatText(result); return; }
        break;
      }

      case "images": {
        result = await searchImages({
          query: pos.join(" ") || flag(flags, "query"),
          type: flag(flags, "type"),
          subject: flag(flags, "subject"),
          figure: flag(flags, "figure"),
          symbol: flag(flags, "symbol"),
          year_from: flagNum(flags, "year-from"),
          year_to: flagNum(flags, "year-to"),
          book_id: flag(flags, "book"),
          min_quality: flagNum(flags, "min-quality"),
          limit: flagNum(flags, "limit"),
        });
        if (!jsonMode) { formatImages(result as AnyRecord); return; }
        break;
      }

      case "feedback": {
        const msg = pos.join(" ");
        if (!msg) { console.error("Usage: source-library feedback <message> [--name=...] [--email=...]"); process.exit(1); }
        result = await submitFeedback({
          message: msg,
          name: flag(flags, "name"),
          email: flag(flags, "email"),
          page: flag(flags, "page"),
        });
        if (!jsonMode) {
          console.log(green("Feedback submitted. Thank you!"));
          return;
        }
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}\nRun 'source-library help' for usage.`);
        process.exit(1);
    }

    // JSON output
    if (typeof result === "string") {
      process.stdout.write(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }

  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

run();
