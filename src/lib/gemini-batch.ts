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

/**
 * Upload a file to Gemini File API for batch processing
 */
export async function uploadBatchFile(
  jsonlContent: string,
  displayName: string
): Promise<{ name: string; uri: string }> {
  const apiKey = getApiKey();

  // Step 1: Start resumable upload
  const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': Buffer.byteLength(jsonlContent).toString(),
        'X-Goog-Upload-Header-Content-Type': 'application/jsonl',
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
      'Content-Type': 'application/jsonl',
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

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: requests.map(r => ({
          key: r.key,
          request: r.request,
        })),
        config: {
          displayName,
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
        src: fileName,
        config: {
          displayName,
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

  return response.json();
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

  // Check for inline responses
  if (jobData.dest?.inlinedResponses) {
    return jobData.dest.inlinedResponses;
  }

  // Check for file-based responses
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

    // Parse JSONL response
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

  const response = await fetch(
    `${GEMINI_API_BASE}/batchJobs?key=${apiKey}&pageSize=${pageSize}`,
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
  return data.batchJobs || [];
}
