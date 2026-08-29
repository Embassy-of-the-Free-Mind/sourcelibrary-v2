/** Dataset licensing tier definitions */

export type DatasetTier = 'explorer' | 'language' | 'domain' | 'full' | 'enterprise';

export interface DatasetTierConfig {
  name: string;
  description: string;
  monthlyPrice: number; // cents
  annualPrice: number; // cents
  pagesPerDay: number; // 0 = unlimited
  requestsPerMinute: number;
  scope: 'sample' | 'language' | 'domain' | 'full';
  /** Stripe price IDs — set after creating products in Stripe */
  stripePriceMonthly?: string;
  stripePriceAnnual?: string;
}

export const DATASET_TIERS: Record<DatasetTier, DatasetTierConfig> = {
  explorer: {
    name: 'Explorer',
    description: 'Free keyed tier — 2,000 pages/day, any language',
    monthlyPrice: 0,
    annualPrice: 0,
    // A key must be an UPGRADE over staying anonymous (#4366): anon gets 500
    // pages/day and a signed-in session 1,000, so the free key sits above both.
    // The old 100/10 made getting a key a downgrade — exactly backwards.
    pagesPerDay: 2000,
    requestsPerMinute: 60,
    scope: 'sample',
  },
  language: {
    name: 'Single Language',
    description: 'Full access to one language corpus with parallel translations',
    monthlyPrice: 49900, // $499
    annualPrice: 499000, // $4,990
    pagesPerDay: 0,
    requestsPerMinute: 60,
    scope: 'language',
  },
  domain: {
    name: 'Domain Bundle',
    description: 'Full access to one taxonomy cluster and all sub-clusters',
    monthlyPrice: 149900, // $1,499
    annualPrice: 1499000, // $14,990
    pagesPerDay: 0,
    requestsPerMinute: 120,
    scope: 'domain',
  },
  full: {
    name: 'Full Collection',
    description: 'All languages, all domains, all modalities',
    monthlyPrice: 499900, // $4,999
    annualPrice: 4999000, // $49,990
    pagesPerDay: 0,
    requestsPerMinute: 300,
    scope: 'full',
  },
  enterprise: {
    name: 'Enterprise',
    description: 'Exclusive access windows, Parquet dumps, SLA, stewardship reports',
    monthlyPrice: 0, // custom
    annualPrice: 0,
    pagesPerDay: 0,
    requestsPerMinute: 1000,
    scope: 'full',
  },
};

export interface ApiKeyDoc {
  _id?: any;
  key_hash: string;
  key_prefix: string;
  user_id: string;
  name: string;
  tier: DatasetTier;
  permissions: {
    languages: string[] | '*';
    clusters: string[] | '*';
    /** Serve images without VISIBLE provenance marks (?clean=1 on the image
     *  proxy). Implied by full-scope tiers; admin-grantable on any key.
     *  Invisible marks (EXIF, keyed watermark) stay regardless — see
     *  src/lib/image-marks.ts. */
    clean_images?: boolean;
  };
  rate_limit: {
    requests_per_minute: number;
    pages_per_day: number;
  };
  status: 'active' | 'revoked' | 'expired';
  stripe_subscription_id?: string;
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
}

export interface DatasetAccessLog {
  api_key_id: any;
  user_id: string;
  timestamp: Date;
  endpoint: string;
  filters: Record<string, any>;
  records_returned: number;
  book_ids: string[];
  format: 'jsonl' | 'json';
  ip_address: string;
}

/** Shape of a single record in the JSONL output */
export interface DatasetPageRecord {
  book_id: string;
  page_number: number;
  language: string;
  original_text: string | null;
  english_translation: string | null;
  book_title: string;
  author: string;
  year: number | null;
  cluster: string | null;
  subcluster: string | null;
  source_url: string;
}
