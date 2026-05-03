import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

/**
 * GET /api/embassy/threads/[id]/notebook — Export research notebook as markdown.
 * Public threads: anyone can view. Private threads: must be thread creator.
 * ?format=json returns raw JSON, default is markdown text.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = await getDb();

  // Check thread exists and visibility
  const thread = await db.collection('embassy_threads').findOne({
    _id: new ObjectId(id),
  });
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  // Private threads require auth
  if (thread.visibility !== 'public') {
    const session = await auth();
    if (!session?.user?.id || thread.creatorId !== session.user.id) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }
  }

  // Load notebook
  const notebook = await db.collection('research_notebooks').findOne({ threadId: new ObjectId(id) });
  if (!notebook || !notebook.findings?.length) {
    return NextResponse.json({ error: 'No research findings yet' }, { status: 404 });
  }

  const format = new URL(request.url).searchParams.get('format');
  if (format === 'json') {
    return NextResponse.json({ notebook });
  }

  // Generate markdown
  const lines: string[] = [];
  const topic = notebook.topic || thread.title || 'Research Notes';
  lines.push(`# ${topic}`);
  lines.push('');
  lines.push(`*Research conducted via the Source Library Librarian*`);
  lines.push(`*${notebook.findings.length} findings · ${new Date(notebook.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Findings
  lines.push('## Key Passages');
  lines.push('');
  for (let i = 0; i < notebook.findings.length; i++) {
    const f = notebook.findings[i];
    const url = `https://sourcelibrary.org/book/${f.source.bookSlug || f.source.bookId}/page-number/${f.source.pageNumber}`;
    lines.push(`### ${i + 1}. ${f.source.bookTitle}`);
    lines.push(`**${f.source.bookAuthor}** · [Page ${f.source.pageNumber}](${url})`);
    lines.push('');
    lines.push(`> ${f.quote}`);
    lines.push('');
    if (f.note) {
      lines.push(f.note);
      lines.push('');
    }
  }

  // Bibliography
  const books = new Map<string, { title: string; author: string; slug?: string; pages: number[] }>();
  for (const f of notebook.findings) {
    const key = f.source.bookId;
    const existing = books.get(key) || { title: f.source.bookTitle, author: f.source.bookAuthor, slug: f.source.bookSlug, pages: [] as number[] };
    existing.pages.push(f.source.pageNumber);
    books.set(key, existing);
  }

  if (books.size > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Bibliography');
    lines.push('');
    for (const [, book] of books) {
      const url = `https://sourcelibrary.org/book/${book.slug || ''}`;
      const pageList = [...new Set(book.pages)].sort((a, b) => a - b).join(', ');
      lines.push(`- **${book.title}** by ${book.author} — [View in Source Library](${url}) · Pages: ${pageList}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Exported from [Source Library](https://sourcelibrary.org/librarian)*');

  const markdown = lines.join('\n');

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${topic.replace(/[^a-z0-9 ]/gi, '').replace(/\s+/g, '-').toLowerCase()}-research.md"`,
    },
  });
}
