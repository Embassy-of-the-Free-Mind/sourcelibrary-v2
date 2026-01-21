/**
 * URL Validation Utilities for S3 Image Uploads
 *
 * Security-focused validation to prevent URL exploitation:
 * - HTTPS-only enforcement
 * - Domain whitelist validation
 * - URL format validation
 * - Path traversal prevention
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate S3 URL against security requirements
 *
 * @param url - The S3 URL to validate
 * @returns ValidationResult indicating if URL is safe to fetch
 *
 * @example
 * const result = validateS3Url('https://my-bucket.s3.amazonaws.com/image.jpg');
 * if (!result.valid) {
 *   console.error(result.error);
 *   return;
 * }
 */
export function validateS3Url(url: string): ValidationResult {
  // Check if ALLOWED_S3_DOMAIN is configured
  const allowedDomain = process.env.ALLOWED_S3_DOMAIN;
  if (!allowedDomain) {
    return {
      valid: false,
      error: 'ALLOWED_S3_DOMAIN environment variable not configured'
    };
  }

  // Validate URL is a string
  if (typeof url !== 'string' || !url) {
    return {
      valid: false,
      error: 'URL must be a non-empty string'
    };
  }

  // Enforce HTTPS protocol
  if (!url.startsWith('https://')) {
    return {
      valid: false,
      error: 'URL must use HTTPS protocol'
    };
  }

  // Parse URL to validate format
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch (error) {
    return {
      valid: false,
      error: `Invalid URL format: ${error instanceof Error ? error.message : 'parse error'}`
    };
  }

  // Validate domain against whitelist
  if (!isAllowedDomain(urlObj.hostname, allowedDomain)) {
    return {
      valid: false,
      error: `Domain ${urlObj.hostname} is not in allowed domain: ${allowedDomain}`
    };
  }

  // Check for suspicious path patterns
  const suspiciousPatterns = [
    '../',    // Path traversal
    '..\\',   // Windows path traversal
    '%2e%2e', // URL-encoded ..
    '%252e',  // Double-encoded .
  ];

  const pathLower = urlObj.pathname.toLowerCase();
  for (const pattern of suspiciousPatterns) {
    if (pathLower.includes(pattern.toLowerCase())) {
      return {
        valid: false,
        error: `URL contains suspicious pattern: ${pattern}`
      };
    }
  }

  return { valid: true };
}

/**
 * Check if hostname matches allowed domain
 *
 * @param hostname - The hostname from the URL (e.g., 'my-bucket.s3.amazonaws.com')
 * @param allowedDomain - The allowed domain pattern (e.g., 'my-bucket.s3.amazonaws.com')
 * @returns true if hostname is allowed
 *
 * @example
 * isAllowedDomain('my-bucket.s3.us-east-1.amazonaws.com', 'my-bucket.s3')
 * // Returns: true
 *
 * isAllowedDomain('evil.com', 'my-bucket.s3')
 * // Returns: false
 */
export function isAllowedDomain(hostname: string, allowedDomain: string): boolean {
  // Exact match
  if (hostname === allowedDomain) {
    return true;
  }

  // Check if hostname contains the allowed domain
  // This allows flexibility for regional S3 endpoints
  // e.g., allowedDomain='my-bucket.s3' matches 'my-bucket.s3.us-east-1.amazonaws.com'
  if (hostname.includes(allowedDomain)) {
    return true;
  }

  return false;
}
