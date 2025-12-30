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
  key: string;
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
  error?: {
    code: number;
    message: string;
  };
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY not configured');
  }
  return key;
}

// Normalize state names (BATCH_STATE_* -> JOB_STATE_*)
function normalizeState(state: string | undefined): BatchJobStatus['state'] {
  if (!state) return 'JOB_STATE_PENDING';
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
 * Get the status of a batch job
 */
export async function getBatchJobStatus(jobName: string): Promise<BatchJobStatus> {
  const apiKey = getApiKey();

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
    const error = await response.text();
    throw new Error(`Failed to get batch job status: ${error}`);
  }

  const data = await response.json();

  // Transform response - Gemini returns { name, metadata: { state, ... } }
  // We need to normalize to our BatchJobStatus format
  const metadata = data.metadata || {};
  const batchStats = metadata.batchStats || {};

  return {
    name: data.name,
    state: normalizeState(metadata.state),
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

/**
 * Get the results of a completed batch job
 */
export async function getBatchJobResults(jobName: string): Promise<BatchResponse[]> {
  const apiKey = getApiKey();

  // First get job status to find output file
  const status = await getBatchJobStatus(jobName);

  if (status.state !== 'JOB_STATE_SUCCEEDED') {
    throw new Error(`Job not complete: ${status.state}`);
  }

  // For inline responses, they're included in the job status
  // For file-based, we need to download the output file

  // Try to get inline responses first
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
    throw new Error(`Failed to get batch results: ${error}`);
  }

  const jobData = await jobResponse.json();

  // Check for file-based output (metadata.destFile)
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
    state: normalizeState(op.metadata?.state as string),
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
