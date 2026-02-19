/**
 * Gemini Batch API client
 *
 * Uses the async Batch API for 50% cost savings on large jobs.
 * Jobs complete within 24 hours (usually much faster).
 *
 * @see https://ai.google.dev/gemini-api/docs/batch-api
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface BatchRequest {
  key: string;  // Unique ID for this request (e.g., pageId)
  request: {
    contents: Array<{
      parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      >;
    }>;
    generationConfig?: {
      temperature?: number;
      maxOutputTokens?: number;
    };
    systemInstruction?: {
      parts: Array<{ text: string }>;
    };
  };
}

export interface BatchJobStatus {
  name: string;
  state: 'JOB_STATE_PENDING' | 'JOB_STATE_RUNNING' | 'JOB_STATE_SUCCEEDED' | 'JOB_STATE_FAILED' | 'JOB_STATE_CANCELLED' | 'JOB_STATE_EXPIRED';
  createTime: string;
  updateTime: string;
  displayName?: string;
  model?: string;
  srcBlobUri?: string;
  destBlobUri?: string;
  error?: {
    code: number;
    message: string;
  };
  stats?: {
    totalCount: number;
    successCount: number;
    failedCount: number;
  };
}

export interface BatchResponse {
  response?: {
    candidates: Array<{
      content: {
        parts: Array<{ text: string }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
  };
  metadata?: {
    key: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

function getApiKey(): string {
  // Try all available keys — batch jobs are only visible to the key that created them
  const key = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return key;
}

/**
 * Get all available API keys for batch job lookups.
 * Batch jobs are only visible to the key that created them,
 * so we need to try multiple keys when polling for status.
 */
export function getAllApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEY_TIER3) keys.push(process.env.GEMINI_API_KEY_TIER3);
  if (process.env.GEMINI_API_KEY_2) keys.push(process.env.GEMINI_API_KEY_2);
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  // Deduplicate (some keys may be the same)
  return [...new Set(keys)];
}

// Normalize state names (BATCH_STATE_* -> JOB_STATE_*)
// Note: inline batch jobs may have no state field but have results in metadata.output
function normalizeState(state: string | undefined, metadata?: Record<string, unknown>): BatchJobStatus['state'] {
  if (!state) {
    // Inline batch jobs omit `state` when complete — detect by presence of output
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = (metadata as any)?.output;
    if (output?.inlinedResponses || output?.responsesFile) {
      return 'JOB_STATE_SUCCEEDED';
    }
    return 'JOB_STATE_PENDING';
  }
  // Map BATCH_STATE_* to JOB_STATE_*
  const mapping: Record<string, BatchJobStatus['state']> = {
    'BATCH_STATE_PENDING': 'JOB_STATE_PENDING',
    'BATCH_STATE_RUNNING': 'JOB_STATE_RUNNING',
    'BATCH_STATE_SUCCEEDED': 'JOB_STATE_SUCCEEDED',
    'BATCH_STATE_FAILED': 'JOB_STATE_FAILED',
    'BATCH_STATE_CANCELLED': 'JOB_STATE_CANCELLED',
  };
  return mapping[state] || (state.replace('BATCH_STATE_', 'JOB_STATE_') as BatchJobStatus['state']);
}

/**
 * Upload a file to Gemini File API for batch processing
 *
 * Note: Uses text/plain MIME type as workaround for known Gemini API bug
 * where application/jsonl returns HTTP 200 but missing 'file' key in response.
 * @see https://github.com/googleapis/python-genai/issues/1590
 */
export async function uploadBatchFile(
  jsonlContent: string,
  displayName: string
): Promise<{ name: string; uri: string }> {
  const apiKey = getApiKey();
  const contentLength = Buffer.byteLength(jsonlContent);

  // Step 1: Start resumable upload
  // Using text/plain as workaround - application/jsonl has backend issues
  const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': contentLength.toString(),
        'X-Goog-Upload-Header-Content-Type': 'text/plain',
      },
      body: JSON.stringify({
        file: {
          displayName,
        },
      }),
    }
  );

  if (!startResponse.ok) {
    const error = await startResponse.text();
    throw new Error(`Failed to start file upload: ${error}`);
  }

  const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('No upload URL returned');
  }

  // Step 2: Upload the content
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: jsonlContent,
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Failed to upload file: ${error}`);
  }

  const fileInfo = await uploadResponse.json();

  // Validate response structure
  if (!fileInfo.file?.name) {
    console.error('[uploadBatchFile] Unexpected response:', JSON.stringify(fileInfo));
    throw new Error(`File upload response missing 'file.name': ${JSON.stringify(fileInfo)}`);
  }

  return {
    name: fileInfo.file.name,
    uri: fileInfo.file.uri,
  };
}

/**
 * Create a batch job with inline requests (for smaller batches, <20MB)
 */
export async function createBatchJobInline(
  model: string,
  requests: BatchRequest[],
  displayName: string
): Promise<{ name: string; state: string }> {
  const apiKey = getApiKey();

  // Format requests for Gemini Batch API
  const formattedRequests = requests.map(r => ({
    request: r.request,
    metadata: {
      key: r.key,
    },
  }));

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batch: {
          display_name: displayName,
          input_config: {
            requests: {
              requests: formattedRequests,
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create batch job: ${error}`);
  }

  const result = await response.json();
  return {
    name: result.name,
    state: result.state || 'JOB_STATE_PENDING',
  };
}

/**
 * Create a batch job from an uploaded file (for larger batches)
 */
export async function createBatchJobFromFile(
  model: string,
  fileName: string,
  displayName: string
): Promise<{ name: string; state: string }> {
  const apiKey = getApiKey();

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batch: {
          display_name: displayName,
          input_config: {
            file_name: fileName,
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create batch job: ${error}`);
  }

  const result = await response.json();
  return {
    name: result.name,
    state: result.state || 'JOB_STATE_PENDING',
  };
}

/**
 * Get the status of a batch job.
 * Tries multiple API keys since batch jobs are only visible to the key that created them.
 */
export async function getBatchJobStatus(jobName: string): Promise<BatchJobStatus> {
  const keys = getAllApiKeys();
  let lastError = '';

  for (const apiKey of keys) {
    const response = await fetch(
      `${GEMINI_API_BASE}/${jobName}?key=${apiKey}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      lastError = await response.text();
      // Try next key if this one can't find the job
      if (response.status === 404 || lastError.includes('not found')) {
        continue;
      }
      throw new Error(`Failed to get batch job status: ${lastError}`);
    }

    const data = await response.json();

    // Transform response - Gemini returns { name, metadata: { state, ... } }
    // We need to normalize to our BatchJobStatus format
    const metadata = data.metadata || {};
    const batchStats = metadata.batchStats || {};

    return {
      name: data.name,
      state: normalizeState(metadata.state, metadata),
      createTime: metadata.createTime,
      updateTime: metadata.updateTime,
      displayName: metadata.displayName,
      model: metadata.model,
      stats: {
        totalCount: parseInt(batchStats.requestCount || '0'),
        successCount: parseInt(batchStats.succeededCount || '0'),
        failedCount: parseInt(batchStats.failedCount || '0'),
      },
    };
  }

  throw new Error(`Failed to get batch job status (tried ${keys.length} keys): ${lastError}`);
}

/**
 * Get the results of a completed batch job.
 * Tries multiple API keys since batch jobs are only visible to the key that created them.
 */
export async function getBatchJobResults(jobName: string): Promise<BatchResponse[]> {
  const keys = getAllApiKeys();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jobData: any = null;
  let workingKey = '';

  // Find the key that can access this job
  for (const apiKey of keys) {
    const jobResponse = await fetch(
      `${GEMINI_API_BASE}/${jobName}?key=${apiKey}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!jobResponse.ok) {
      const error = await jobResponse.text();
      if (jobResponse.status === 404 || error.includes('not found')) {
        continue; // Try next key
      }
      throw new Error(`Failed to get batch results: ${error}`);
    }

    jobData = await jobResponse.json();
    workingKey = apiKey;
    break;
  }

  if (!jobData) {
    throw new Error(`Batch job not found with any API key (tried ${keys.length})`);
  }

  const apiKey = workingKey;

  // Check state from the raw response (pass metadata for inline job detection)
  const rawState = jobData.metadata?.state;
  const state = normalizeState(rawState, jobData.metadata);
  if (state !== 'JOB_STATE_SUCCEEDED') {
    throw new Error(`Job not complete: ${state}`);
  }

  // Check for file-based output (metadata.output.responsesFile - current Gemini API format)
  if (jobData.metadata?.output?.responsesFile) {
    const fileName = jobData.metadata.output.responsesFile;
    console.log('[getBatchJobResults] Downloading from responsesFile:', fileName);
    const fileResponse = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${apiKey}`,
      {
        method: 'GET',
      }
    );

    if (!fileResponse.ok) {
      const error = await fileResponse.text();
      throw new Error(`Failed to download results file: ${error}`);
    }

    // Parse JSONL response
    const text = await fileResponse.text();
    const lines = text.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line));
  }

  // Check for file-based output (metadata.destFile - legacy format)
  if (jobData.metadata?.destFile) {
    const fileName = jobData.metadata.destFile;
    const fileResponse = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${apiKey}`,
      {
        method: 'GET',
      }
    );

    if (!fileResponse.ok) {
      const error = await fileResponse.text();
      throw new Error(`Failed to download results file: ${error}`);
    }

    // Parse JSONL response
    const text = await fileResponse.text();
    const lines = text.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line));
  }

  // Check for inline responses (double nested in metadata.output)
  if (jobData.metadata?.output?.inlinedResponses?.inlinedResponses) {
    return jobData.metadata.output.inlinedResponses.inlinedResponses;
  }

  // Alternative location for inline responses
  if (jobData.response?.inlinedResponses) {
    return jobData.response.inlinedResponses;
  }

  // Legacy format check
  if (jobData.dest?.inlinedResponses) {
    return jobData.dest.inlinedResponses;
  }

  if (jobData.dest?.fileName) {
    const fileResponse = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${jobData.dest.fileName}:download?alt=media&key=${apiKey}`,
      {
        method: 'GET',
      }
    );

    if (!fileResponse.ok) {
      const error = await fileResponse.text();
      throw new Error(`Failed to download results file: ${error}`);
    }

    const text = await fileResponse.text();
    const lines = text.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line));
  }

  throw new Error('No results found in batch job');
}

/**
 * Fetch batch job status AND results in a single API call.
 * For inline batch jobs, the status response already contains the results,
 * so this avoids the double-fetch of getBatchJobStatus() + getBatchJobResults().
 */
export async function fetchBatchJobWithResults(jobName: string): Promise<{
  status: BatchJobStatus;
  results?: BatchResponse[];
}> {
  const keys = getAllApiKeys();
  let lastError = '';

  for (const apiKey of keys) {
    const response = await fetch(
      `${GEMINI_API_BASE}/${jobName}?key=${apiKey}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      lastError = await response.text();
      if (response.status === 404 || lastError.includes('not found')) continue;
      throw new Error(`Failed to get batch job: ${lastError}`);
    }

    const data = await response.json();
    const metadata = data.metadata || {};
    const batchStats = metadata.batchStats || {};
    const state = normalizeState(metadata.state, metadata);

    const status: BatchJobStatus = {
      name: data.name,
      state,
      createTime: metadata.createTime,
      updateTime: metadata.updateTime,
      displayName: metadata.displayName,
      model: metadata.model,
      stats: {
        totalCount: parseInt(batchStats.requestCount || '0'),
        successCount: parseInt(batchStats.succeededCount || '0'),
        failedCount: parseInt(batchStats.failedCount || '0'),
      },
    };

    // If not succeeded, return status only
    if (state !== 'JOB_STATE_SUCCEEDED') {
      return { status };
    }

    // Extract results from the same response — no second API call needed
    let results: BatchResponse[] | undefined;

    // Check for inline responses (double nested in metadata.output)
    if (metadata.output?.inlinedResponses?.inlinedResponses) {
      results = metadata.output.inlinedResponses.inlinedResponses;
    } else if (data.response?.inlinedResponses) {
      results = data.response.inlinedResponses;
    } else if (data.dest?.inlinedResponses) {
      results = data.dest.inlinedResponses;
    } else {
      // File-based output — need a second fetch
      const fileName = metadata.output?.responsesFile || metadata.destFile || data.dest?.fileName;
      if (fileName) {
        const fileResponse = await fetch(
          `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${apiKey}`
        );
        if (fileResponse.ok) {
          const text = await fileResponse.text();
          results = text.trim().split('\n').filter((l: string) => l.trim()).map((l: string) => JSON.parse(l));
        } else {
          console.error(`[fetchBatchJobWithResults] File download failed for ${jobName}: ${fileResponse.status} ${await fileResponse.text().catch(() => '')}`);
        }
      }
    }

    return { status, results };
  }

  throw new Error(`Batch job not found with any key (tried ${keys.length}): ${lastError}`);
}

/**
 * Cancel a batch job
 */
export async function cancelBatchJob(jobName: string): Promise<void> {
  const apiKey = getApiKey();

  const response = await fetch(
    `${GEMINI_API_BASE}/${jobName}:cancel?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to cancel batch job: ${error}`);
  }
}

/**
 * List all batch jobs
 */
export async function listBatchJobs(pageSize = 100): Promise<BatchJobStatus[]> {
  const apiKey = getApiKey();

  // Use /batches endpoint (not /batchJobs which returns 404)
  const response = await fetch(
    `${GEMINI_API_BASE}/batches?key=${apiKey}&pageSize=${pageSize}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list batch jobs: ${error}`);
  }

  const data = await response.json();

  // Transform operations to BatchJobStatus format
  // Gemini returns operations with metadata, we need to normalize the state names
  return (data.operations || []).map((op: { name: string; metadata: Record<string, unknown> }) => ({
    name: op.name,
    state: normalizeState(op.metadata?.state as string, op.metadata),
    createTime: op.metadata?.createTime as string,
    updateTime: op.metadata?.updateTime as string,
    displayName: op.metadata?.displayName as string,
    model: op.metadata?.model as string,
    stats: op.metadata?.batchStats ? {
      totalCount: parseInt((op.metadata.batchStats as Record<string, string>).requestCount || '0'),
      successCount: parseInt((op.metadata.batchStats as Record<string, string>).succeededCount || '0'),
      failedCount: parseInt((op.metadata.batchStats as Record<string, string>).failedCount || '0'),
    } : undefined,
  }));
}
