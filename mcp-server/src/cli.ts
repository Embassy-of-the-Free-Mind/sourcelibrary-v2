#!/usr/bin/env node

// Source Library CLI — search, read, and cite historical texts from the terminal.
// Same API as the MCP server, but with human-friendly output.

import {
  searchLibrary,
  searchPassages,
  searchWithinBook,
  findQuotes,
  listBooks,
  getBook,
  getBookText,
  getQuote,
  searchIndex,
  searchEntities,
  getEntity,
  searchImages,
  getImage,
  getBookImages,
} from "./api.js";

// ── Formatting helpers ────────────────────────────────────────────────

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";

function dim(s: string) { return `${DIM}${s}${RESET}`; }
function bold(s: string) { return `${BOLD}${s}${RESET}`; }
function cyan(s: string) { return `${CYAN}${s}${RESET}`; }
function yellow(s: string) { return `${YELLOW}${s}${RESET}`; }
function green(s: string) { return `${GREEN}${s}${RESET}`; }
function magenta(s: string) { return `${MAGENTA}${s}${RESET}`; }

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
    console.log(`  ${cyan(p.read_url as string)}`);
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
    console.log(`  ${cyan(r.read_url as string)}`);
    console.log();
  }
}

function formatQuotes(data: AnyRecord) {
  const quotes = data.quotes as AnyRecord[] | undefined;
  console.log(dim(`${data.total} matches for "${data.topic}" — showing ${data.showing}\n`));
  if (!quotes?.length) return;
  for (const q of quotes) {
    console.log(`${bold("── p." + String(q.page))} ${q.citation ? dim(q.citation as string) : ""}`);
    if (q.text) console.log(wrap(q.text as string, 80, 2));
    if (q.url) console.log(`  ${cyan(q.url as string)}`);
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

function formatQuote(data: AnyRecord) {
  if (data.error) {
    console.error(data.error as string);
    return;
  }
  const book = data.book as AnyRecord | undefined;
  const citation = data.citation as AnyRecord | undefined;

  console.log(bold((book?.title as string) || "Unknown") + dim(` p.${data.page}`));
  console.log(dim(`${(book?.author as string) || "Unknown"} · ${String(book?.published || "")}`));

  if (data.matched_query) {
    console.log(dim(`Matched "${data.matched_query}" (${data.total_matches} total matches)`));
  }

  console.log();
  if (data.quote) {
    console.log(wrap(data.quote as string, 80));
  }

  if (data.original) {
    console.log(`\n${dim("── Original ──")}`);
    console.log(wrap(data.original as string, 80));
  }

  if (citation) {
    console.log(`\n${dim("── Citation ──")}`);
    if (citation.inline) console.log(`  ${yellow("Inline:")} ${citation.inline}`);
    if (citation.footnote) console.log(`  ${yellow("Footnote:")} ${citation.footnote}`);
    if (citation.url) console.log(`  ${yellow("URL:")} ${cyan(citation.url as string)}`);
  }
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
    console.log(dim(`\n── p.${p.page_number} ──`));
    if (p.translation) console.log(p.translation);
    else if (p.ocr) console.log(p.ocr);
  }
}

function formatIndexResults(data: AnyRecord) {
  const results = data.results as AnyRecord[] | undefined;
  console.log(dim(`${data.total} index entries for "${data.query}"`));
  if (data.by_type) {
    const bt = data.by_type as Record<string, number>;
    const parts = Object.entries(bt).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`);
    if (parts.length) console.log(dim(`  ${parts.join(", ")}`));
  }
  console.log();
  if (!results?.length) return;
  for (const r of results) {
    const badge = magenta(`[${r.type}]`);
    console.log(`  ${badge} ${bold(r.term as string)}`);
    console.log(`  ${dim("in")} ${r.book_title} ${dim("by")} ${r.book_author || "Unknown"}`);
    if (r.pages) console.log(`  ${dim("Pages:")} ${(r.pages as number[]).join(", ")}`);
    if (r.quote_text) console.log(`  ${dim(">")} ${truncate(r.quote_text as string, 100)}`);
    console.log(`  ${cyan(r.url as string)}`);
    console.log();
  }
}

function formatEntities(data: AnyRecord) {
  const entities = data.entities as AnyRecord[] | undefined;
  console.log(dim(`${data.total} entities (showing ${data.showing})\n`));
  if (!entities?.length) return;
  for (const e of entities) {
    const badge = magenta(`[${e.type}]`);
    console.log(`  ${badge} ${bold(e.name as string)} ${dim(`(${e.book_count} books, ${e.total_mentions} mentions)`)}`);
    if (e.description) console.log(`  ${truncate(e.description as string, 100)}`);
    if (e.aliases && (e.aliases as string[]).length) {
      console.log(`  ${dim("Aliases:")} ${(e.aliases as string[]).join(", ")}`);
    }
    console.log(`  ${dim("id:")} ${e.id}`);
    console.log();
  }
}

function formatEntity(data: AnyRecord) {
  const badge = magenta(`[${data.type}]`);
  console.log(`${badge} ${bold(data.name as string)}`);
  if (data.description) console.log(wrap(data.description as string, 80, 2));
  if (data.aliases && (data.aliases as string[]).length) {
    console.log(`${dim("Aliases:")} ${(data.aliases as string[]).join(", ")}`);
  }
  if (data.wikipedia_url) console.log(`${dim("Wikipedia:")} ${cyan(data.wikipedia_url as string)}`);
  console.log(`${dim("Appears in")} ${data.book_count} books, ${data.total_mentions} mentions`);

  const books = data.books as AnyRecord[] | undefined;
  if (books?.length) {
    console.log(`\n${bold("Books")}`);
    for (const b of books) {
      const pages = b.pages as number[] | undefined;
      console.log(`  ${b.book_title} ${dim("by")} ${b.book_author || "Unknown"}`);
      if (pages?.length) console.log(`    ${dim("Pages:")} ${pages.join(", ")}`);
      if (b.url) console.log(`    ${cyan(b.url as string)}`);
    }
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
    console.log();
  }
}

function formatImageDetail(data: AnyRecord) {
  console.log(bold(data.description as string || "Image"));
  if (data.museum_description) console.log(wrap(data.museum_description as string, 80, 2));
  console.log(`${dim("Type:")} ${data.type || "unknown"}  ${dim("Quality:")} ${data.quality}`);
  const meta = data.metadata as AnyRecord | undefined;
  if (meta) {
    if (meta.subjects) console.log(`${dim("Subjects:")} ${(meta.subjects as string[]).join(", ")}`);
    if (meta.figures) console.log(`${dim("Figures:")} ${(meta.figures as string[]).join(", ")}`);
    if (meta.symbols) console.log(`${dim("Symbols:")} ${(meta.symbols as string[]).join(", ")}`);
  }
  const urls = data.urls as AnyRecord | undefined;
  if (urls) {
    if (urls.page) console.log(`${cyan(urls.page as string)}`);
    if (urls.image) console.log(`${dim("Image:")} ${urls.image}`);
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

const HELP = `${bold("source-library")} — search, read, and cite historical texts

${bold("USAGE")}
  source-library <command> [args] [--flags]

${bold("COMMANDS")}
  ${bold("Search & Discovery")}
    search <query>              Full-text search across all books and pages
    translations <query>        Search inside translated text across the library
    within <book_id> <query>    Search inside a specific book
    books [--search=...] [--language=...] [--sort=...]
                                Browse/filter the book collection

  ${bold("Reading & Citation")}
    book <book_id>              Detailed book info (summary, chapters, stats)
    text <book_id> [--from=N] [--to=N] [--content=translation|ocr|both]
                                Read full book text (default: translation)
    quote <book_id> [--page=N | --query=...] [--original]
                                Get a citable quote with academic citations
    quotes <book_id> <topic>    Find best passages on a topic (up to 5)

  ${bold("Knowledge Graph")}
    index <query>               Search AI-generated book indexes
    entities <query>            Search cross-book entity network
    entity <entity_id>          Full entity detail

  ${bold("Gallery")}
    images [--query=...] [--type=...] [--subject=...] [--figure=...]
                                Search 50,000+ historical illustrations
    image <image_id>            Full image detail
    book-images <book_id>       All images from a book

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
  source-library quote 694f49d3... --query="nature of the soul"
  source-library text 694f49d3... --from=1 --to=50
  source-library books --language=German --sort=title-asc
  source-library images --subject=alchemy --type=emblem
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
        console.log("source-library 3.0.0");
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

      case "quotes": {
        const bookId = pos[0];
        const topic = pos.slice(1).join(" ");
        if (!bookId || !topic) { console.error("Usage: source-library quotes <book_id> <topic>"); process.exit(1); }
        result = await findQuotes({
          book_id: bookId,
          topic,
          limit: flagNum(flags, "limit"),
        });
        if (!jsonMode) { formatQuotes(result as AnyRecord); return; }
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

      case "quote": {
        const bookId = pos[0];
        if (!bookId) { console.error("Usage: source-library quote <book_id> [--page=N | --query=...]"); process.exit(1); }
        result = await getQuote({
          book_id: bookId,
          page: flagNum(flags, "page"),
          query: flag(flags, "query") || (pos.length > 1 ? pos.slice(1).join(" ") : undefined),
          include_original: flagBool(flags, "original") ?? true,
          include_context: flagBool(flags, "context"),
        });
        if (!jsonMode) { formatQuote(result as AnyRecord); return; }
        break;
      }

      case "index": {
        const query = pos.join(" ");
        if (!query) { console.error("Usage: source-library index <query>"); process.exit(1); }
        result = await searchIndex({
          query,
          type: flag(flags, "type"),
          limit: flagNum(flags, "limit"),
        });
        if (!jsonMode) { formatIndexResults(result as AnyRecord); return; }
        break;
      }

      case "entities": {
        const query = pos.join(" ");
        result = await searchEntities({
          query: query || undefined,
          type: flag(flags, "type"),
          book_id: flag(flags, "book"),
          min_books: flagNum(flags, "min-books"),
          limit: flagNum(flags, "limit"),
          offset: flagNum(flags, "offset"),
        });
        if (!jsonMode) { formatEntities(result as AnyRecord); return; }
        break;
      }

      case "entity": {
        const entityId = pos[0];
        if (!entityId) { console.error("Usage: source-library entity <entity_id>"); process.exit(1); }
        result = await getEntity({ entity_id: entityId });
        if (!jsonMode) { formatEntity(result as AnyRecord); return; }
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

      case "image": {
        const imageId = pos[0];
        if (!imageId) { console.error("Usage: source-library image <image_id>"); process.exit(1); }
        result = await getImage({ image_id: imageId });
        if (!jsonMode) { formatImageDetail(result as AnyRecord); return; }
        break;
      }

      case "book-images": {
        const bookId = pos[0];
        if (!bookId) { console.error("Usage: source-library book-images <book_id>"); process.exit(1); }
        result = await getBookImages({
          book_id: bookId,
          min_quality: flagNum(flags, "min-quality"),
          limit: flagNum(flags, "limit"),
        });
        if (!jsonMode) { formatImages(result as AnyRecord); return; }
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
