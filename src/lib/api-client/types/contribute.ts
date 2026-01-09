/**
 * Contribute API types
 */

export interface ContributeBook {
  _id: string;
  title: string;
  author: string;
  pages_count: number;
  pages_ocr: number;
  pages_translated: number;
  original_language?: string;
  estimatedCost: number;
}

export interface ContributorStats {
  totalContributors: number;
  totalPagesProcessed: number;
  recentContributors: Array<{ name: string; pages: number; date: string }>;
}

export interface ValidateKeyResponse {
  valid: boolean;
  message?: string;
}
