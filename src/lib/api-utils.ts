import { NextResponse } from 'next/server';

/**
 * Standard API error response
 */
export function apiError(message: string, status: number = 500) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Standard API success response
 */
export function apiSuccess<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status });
}

/**
 * Wrap an async handler with error handling
 */
export function withErrorHandler<T>(
  handler: () => Promise<NextResponse<T>>
): Promise<NextResponse<T | { error: string }>> {
  return handler().catch((error: unknown) => {
    console.error('API error:', error);
    const message = error instanceof Error ? error.message : 'An error occurred';
    return apiError(message, 500);
  });
}

/**
 * Validate required fields in request body
 */
export function validateRequired(
  body: Record<string, unknown>,
  fields: string[]
): { valid: boolean; missing: string[] } {
  const missing = fields.filter(field => !body[field]);
  return { valid: missing.length === 0, missing };
}

/**
 * Parse page ID from route params (handles both sync and async params)
 */
export async function getParamId(
  params: { id: string } | Promise<{ id: string }>
): Promise<string> {
  if (params instanceof Promise) {
    const resolved = await params;
    return resolved.id;
  }
  return params.id;
}
