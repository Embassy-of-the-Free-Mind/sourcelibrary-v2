import { Octokit } from '@octokit/rest';
import { getDb } from '@/lib/mongodb';
import { createHash } from 'crypto';

const REPO_OWNER = 'JDerekLomas';
const REPO_NAME = 'source-library-texts';

/**
 * Sync a book's text content to the source-library-texts GitHub repo.
 * Creates/updates files via the GitHub API (no git binary needed).
 *
 * Call this after a book completes OCR, translation, or any re-processing.
 * Idempotent — skips if content hasn't changed (via SHA comparison).
 */
export async function syncBookToGitHub(bookId: string): Promise<{
  synced: boolean;
  files_updated: number;
  commit_sha?: string;
  error?: string;
}> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { synced: false, files_updated: 0, error: 'GITHUB_TOKEN not set' };
  }

  const octokit = new Octokit({ auth: token });
  const db = await getDb();

  // Fetch book metadata
  const book = await db.collection('books').findOne(
    { id: bookId },
    {
      projection: {
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        published: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
        license: 1, image_source: 1, doi: 1,
        ia_identifier: 1, gallica_ark: 1, bsb_id: 1,
      },
    }
  );

  if (!book) {
    return { synced: false, files_updated: 0, error: 'Book not found' };
  }

  // Fetch all pages with text
  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .project({
      page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1,
      'translation.data': 1, 'translation.model': 1,
      page_type: 1, columns: 1,
    })
    .sort({ page_number: 1 })
    .toArray();

  // Build text content
  const ocrText = formatPageText(pages, 'ocr');
  const translationText = formatPageText(pages, 'translation');

  if (!ocrText && !translationText) {
    return { synced: false, files_updated: 0, error: 'No text content' };
  }

  // Count pages with content
  const pagesWithOcr = pages.filter(p => p.ocr?.data).length;
  const pagesWithTranslation = pages.filter(p => p.translation?.data).length;

  // Determine dominant OCR model
  const modelCounts: Record<string, number> = {};
  for (const p of pages) {
    if (p.ocr?.model) {
      modelCounts[p.ocr.model] = (modelCounts[p.ocr.model] || 0) + 1;
    }
  }
  const dominantModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

  // Build metadata
  const metadata = {
    id: bookId,
    title: book.title,
    display_title: book.display_title || book.title,
    author: book.author,
    language: book.language || 'Unknown',
    year: book.year || null,
    published: book.published || null,
    pages_count: book.pages_count || pages.length,
    pages_with_ocr: pagesWithOcr,
    pages_with_translation: pagesWithTranslation,
    source_url: `https://sourcelibrary.org/book/${bookId}`,
    license: book.license || book.image_source?.license || null,
    doi: book.doi || null,
    external_ids: {
      ...(book.ia_identifier && { internet_archive: book.ia_identifier }),
      ...(book.gallica_ark && { gallica: book.gallica_ark }),
      ...(book.bsb_id && { mdz: book.bsb_id }),
    },
    processing: {
      ocr_model: dominantModel,
      prompt_version: pages.find(p => p.ocr?.prompt_version)?.ocr?.prompt_version || null,
      translation_model: pages.find(p => p.translation?.model)?.translation?.model || null,
    },
    synced_at: new Date().toISOString(),
    _hashes: {
      ocr: contentHash(ocrText),
      translation: contentHash(translationText),
    },
  };

  const metadataContent = JSON.stringify(metadata, null, 2) + '\n';

  // Build file list
  const files: Array<{ path: string; content: string }> = [
    { path: `books/${bookId}/metadata.json`, content: metadataContent },
  ];
  if (ocrText) files.push({ path: `books/${bookId}/ocr.txt`, content: ocrText });
  if (translationText) files.push({ path: `books/${bookId}/translation.txt`, content: translationText });

  try {
    // Get current HEAD SHA
    const { data: ref } = await octokit.git.getRef({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      ref: 'heads/main',
    });
    const baseSha = ref.object.sha;

    // Get the base tree
    const { data: baseCommit } = await octokit.git.getCommit({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      commit_sha: baseSha,
    });

    // Check if any files actually changed by comparing blob SHAs
    let hasChanges = false;
    for (const file of files) {
      try {
        const { data: existing } = await octokit.repos.getContent({
          owner: REPO_OWNER,
          repo: REPO_NAME,
          path: file.path,
          ref: 'main',
        });
        if ('sha' in existing) {
          // Compare content hash: GitHub blob SHA = SHA1("blob <size>\0<content>")
          const blobContent = Buffer.from(file.content);
          const blobHeader = `blob ${blobContent.length}\0`;
          const blobSha = createHash('sha1')
            .update(Buffer.concat([Buffer.from(blobHeader), blobContent]))
            .digest('hex');
          if (blobSha !== existing.sha) {
            hasChanges = true;
            break;
          }
        }
      } catch {
        // File doesn't exist yet — that's a change
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges) {
      return { synced: false, files_updated: 0, error: 'No changes detected' };
    }

    // Create blobs for each file
    const treeItems = [];
    for (const file of files) {
      const { data: blob } = await octokit.git.createBlob({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64',
      });
      treeItems.push({
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha,
      });
    }

    // Create tree
    const { data: tree } = await octokit.git.createTree({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      tree: treeItems,
      base_tree: baseCommit.tree.sha,
    });

    // Create commit
    const title = (book.display_title || book.title || 'Untitled').slice(0, 60);
    const commitMsg = `sync: ${title} (${book.language || '?'}, ${pagesWithOcr} OCR, ${pagesWithTranslation} translated)`;

    const { data: commit } = await octokit.git.createCommit({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      message: commitMsg,
      tree: tree.sha,
      parents: [baseSha],
    });

    // Update ref
    await octokit.git.updateRef({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      ref: 'heads/main',
      sha: commit.sha,
    });

    return {
      synced: true,
      files_updated: files.length,
      commit_sha: commit.sha,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[git-sync] Failed to sync book ${bookId}:`, msg);
    return { synced: false, files_updated: 0, error: msg };
  }
}

function formatPageText(pages: Array<Record<string, unknown>>, field: 'ocr' | 'translation'): string {
  const lines: string[] = [];
  for (const page of pages) {
    const data = page[field] as Record<string, unknown> | undefined;
    const text = data?.data as string | undefined;
    if (text) {
      lines.push(`--- Page ${page.page_number} ---`);
      lines.push(text);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function contentHash(text: string): string {
  return createHash('sha256').update(text || '').digest('hex').slice(0, 16);
}
