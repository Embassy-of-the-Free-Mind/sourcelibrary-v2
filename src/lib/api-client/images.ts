/**
 * Image Utilities
 *
 * Lightweight utilities for fetching images from external sources (IIIF, IA, Gallica, MDZ).
 * These utilities use native fetch() instead of axios to avoid unnecessary overhead for binary downloads.
 *
 * IMPORTANT: These utilities are for EXTERNAL image fetching only.
 * They do NOT use axios interceptors (no auth tokens, no visitor tracking).
 *
 * Usage:
 * ```typescript
 * import { images, ia } from '@/lib/api-client';
 *
 * // Fetch image as buffer
 * const buffer = await images.fetchBuffer('https://archive.org/download/.../page.jpg');
 *
 * // Fetch and encode to base64 for vision models
 * const base64 = await images.fetchBase64('https://gallica.bnf.fr/.../page.jpg');
 *
 * // Test if image URL is accessible
 * const isAccessible = await images.testAccessibility('https://...');
 *
 * // Fetch IA metadata
 * const metadata = await ia.fetchMetadata('bookidentifier');
 * ```
 */

/**
 * Fetch an image from a URL and return it as a Buffer
 *
 * @param url - The image URL to fetch
 * @param options - Optional configuration
 * @param options.timeout - Request timeout in milliseconds (default: 30000ms)
 * @returns Promise<Buffer> - The image data as a Buffer
 * @throws Error if fetch fails or times out
 *
 * @example
 * const buffer = await images.fetchBuffer('https://archive.org/download/book/page/n0.jpg');
 * const resized = await sharp(buffer).resize(800).toBuffer();
 */
async function fetchBuffer(
  url: string,
  options?: { timeout?: number }
): Promise<Buffer> {
  const timeout = options?.timeout || 30000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Image fetch timed out after ${timeout}ms: ${url}`);
      }
      throw new Error(`Failed to fetch image: ${error.message}`);
    }

    throw new Error(`Failed to fetch image from ${url}`);
  }
}

/**
 * Fetch an image and encode it to base64
 * Useful for sending images to vision models (Gemini, Mistral, etc.)
 *
 * @param url - The image URL to fetch
 * @param options - Optional configuration
 * @param options.timeout - Request timeout in milliseconds (default: 30000ms)
 * @param options.includeMimeType - If true, returns { base64, mimeType } instead of just base64
 * @returns Promise<string> - Base64-encoded image data
 * @throws Error if fetch fails or times out
 *
 * @example
 * // For Gemini inline_data
 * const base64 = await images.fetchBase64('https://archive.org/download/book/page.jpg');
 * const payload = { inline_data: { mime_type: 'image/jpeg', data: base64 } };
 *
 * // With mime type detection
 * const { base64, mimeType } = await images.fetchBase64(url, { includeMimeType: true });
 */
async function fetchBase64(
  url: string,
  options?: { timeout?: number; includeMimeType?: boolean }
): Promise<string | { base64: string; mimeType: string }> {
  const timeout = options?.timeout || 30000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    if (options?.includeMimeType) {
      // Try to get mime type from response header
      let mimeType = response.headers.get('content-type')?.split(';')[0];

      // Fallback: detect from URL extension (S3 often returns application/octet-stream)
      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
        if (ext === 'png') mimeType = 'image/png';
        else if (ext === 'gif') mimeType = 'image/gif';
        else if (ext === 'webp') mimeType = 'image/webp';
        else if (ext === 'jp2') mimeType = 'image/jp2';
        else mimeType = 'image/jpeg'; // Default
      }

      return { base64, mimeType: mimeType || 'image/jpeg' };
    }

    return base64;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Image fetch timed out after ${timeout}ms: ${url}`);
      }
      throw new Error(`Failed to fetch image: ${error.message}`);
    }

    throw new Error(`Failed to fetch image from ${url}`);
  }
}

/**
 * Test if an image URL is accessible (returns 200 OK)
 * Uses HEAD request to avoid downloading the full image
 *
 * @param url - The image URL to test
 * @param timeout - Request timeout in milliseconds (default: 10000ms)
 * @returns Promise<boolean> - true if accessible (200 OK), false otherwise
 *
 * @example
 * const isAccessible = await images.testAccessibility('https://archive.org/download/book/page.jpg');
 * if (!isAccessible) {
 *   console.log('Image broken or restricted');
 * }
 */
async function testAccessibility(url: string, timeout = 10000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Internet Archive specific utilities
 */
const ia = {
  /**
   * Fetch metadata from Internet Archive
   *
   * @param identifier - IA identifier (e.g., 'theatrumchemicu00sethgoog')
   * @returns Promise<IAMetadata> - Parsed metadata object
   * @throws Error if metadata fetch fails
   *
   * @example
   * const metadata = await ia.fetchMetadata('theatrumchemicu00sethgoog');
   * const pageCount = metadata.metadata.imagecount;
   */
  fetchMetadata: async (identifier: string): Promise<IAMetadata> => {
    const url = `https://archive.org/metadata/${identifier}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch IA metadata: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as IAMetadata;
  },

  /**
   * Fetch and parse scandata XML from Internet Archive
   * Scandata contains page-level metadata (leafNum, pageType, etc.)
   *
   * @param identifier - IA identifier
   * @returns Promise<string> - Raw XML text (parse with your XML parser of choice)
   * @throws Error if scandata fetch fails
   *
   * @example
   * const xml = await ia.fetchScandata('theatrumchemicu00sethgoog');
   * const leafMatches = xml.match(/<page /g);
   * const pageCount = leafMatches ? leafMatches.length : 0;
   */
  fetchScandata: async (identifier: string): Promise<string> => {
    // Fetch file list to find scandata filename
    const metadata = await ia.fetchMetadata(identifier);
    const files = metadata.files || [];

    const scandataFile = files.find(
      (f) => f.name.endsWith('_scandata.xml') || f.name === 'scandata.xml'
    );

    if (!scandataFile) {
      throw new Error(`No scandata.xml found for identifier: ${identifier}`);
    }

    const url = `https://archive.org/download/${identifier}/${scandataFile.name}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch scandata: ${response.status} ${response.statusText}`);
    }

    return response.text();
  },
};

/**
 * Fetch an image as Buffer with mime type detection
 * Useful when you need both the binary data and content-type for storage/upload
 *
 * @param url - The image URL to fetch
 * @param options - Optional configuration
 * @param options.timeout - Request timeout in milliseconds (default: 30000ms)
 * @returns Promise<{ buffer: Buffer; mimeType: string }> - Buffer and detected mime type
 * @throws Error if fetch fails or times out
 *
 * @example
 * const { buffer, mimeType } = await images.fetchBufferWithMimeType('https://archive.org/download/book/page.jpg');
 * await put('file.jpg', buffer, { contentType: mimeType });
 */
async function fetchBufferWithMimeType(
  url: string,
  options?: { timeout?: number }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const timeout = options?.timeout || 30000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Try to get mime type from response header
    let mimeType = response.headers.get('content-type')?.split(';')[0];

    // Fallback: detect from URL extension (S3 often returns application/octet-stream)
    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = url.split('.').pop()?.toLowerCase().split('?')[0];
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'gif') mimeType = 'image/gif';
      else if (ext === 'webp') mimeType = 'image/webp';
      else if (ext === 'jp2') mimeType = 'image/jp2';
      else mimeType = 'image/jpeg'; // Default
    }

    return { buffer, mimeType: mimeType || 'image/jpeg' };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Image fetch timed out after ${timeout}ms: ${url}`);
      }
      throw new Error(`Failed to fetch image: ${error.message}`);
    }

    throw new Error(`Failed to fetch image from ${url}`);
  }
}

/**
 * Types for Internet Archive metadata API
 */
export interface IAMetadata {
  created: number;
  d1: string;
  d2: string;
  dir: string;
  files: Array<{
    name: string;
    source: string;
    format: string;
    size?: number;
    md5?: string;
  }>;
  files_count: number;
  item_last_updated: number;
  item_size: number;
  metadata: {
    identifier: string;
    title?: string;
    creator?: string;
    publisher?: string;
    date?: string;
    language?: string;
    imagecount?: string;
    [key: string]: unknown;
  };
  server: string;
  uniq: number;
  workable_servers: string[];
}

/**
 * Export images utilities
 */
export const images = {
  fetchBuffer,
  fetchBase64,
  fetchBufferWithMimeType,
  testAccessibility,
};

/**
 * Export IA utilities
 */
export { ia };
