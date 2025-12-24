// Test System Types

import { Db } from 'mongodb';

// ============= Configuration =============

export interface TestConfig {
  apiBaseUrl: string;
  mongoUri: string;
  testDbName: string;
  geminiCostLimit: number;
  parallel: number;
  reportDir: string;
  screenshotDir: string;
  baselineDir: string;
  browserConfig: BrowserConfig;
}

export interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  timeout: number;
}

export interface AgentConfig {
  name: string;
  apiBaseUrl?: string;
  browserConfig?: BrowserConfig;
  screenshotOnStep?: boolean;
  timeout?: number;
}

// ============= Test Context =============

export interface TestContext {
  db: Db;
  config: TestConfig;
  saved: Record<string, unknown>;
  warnings: string[];
  fixtures: FixtureManager;
}

export interface FixtureManager {
  createBook(data: Partial<BookFixture>): Promise<BookFixture>;
  createPage(bookId: string, data: Partial<PageFixture>): Promise<PageFixture>;
  createCompleteBook(): Promise<BookFixture & { pages: PageFixture[] }>;
  getTestImageUrl(name: string): string;
  getTestImagePaths(count: number): string[];
}

export interface BookFixture {
  id: string;
  tenant_id: string;
  title: string;
  author: string;
  language: string;
  published: string;
  status: string;
  created_at: Date;
}

export interface PageFixture {
  id: string;
  tenant_id: string;
  book_id: string;
  page_number: number;
  photo: string;
  ocr: { language: string; model: string; data: string };
  translation: { language: string; model: string; data: string };
}

// ============= Scenarios =============

export type ScenarioType = 'api' | 'e2e' | 'visual';

export interface BaseScenario {
  name: string;
  agent: ScenarioType;
  tags?: string[];
  setup?: (ctx: TestContext) => Promise<void>;
  teardown?: (ctx: TestContext) => Promise<void>;
}

export interface APIScenario extends BaseScenario {
  agent: 'api';
  steps: APIStep[];
}

export interface APIStep {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string | ((ctx: TestContext) => string);
  body?: unknown | ((ctx: TestContext) => unknown);
  headers?: Record<string, string>;
  query?: Record<string, string>;
  expect: APIExpectation;
  saveAs?: string;
  continueOnError?: boolean;
  timeout?: number;
}

export interface APIExpectation {
  status?: number;
  body?: (data: unknown, ctx: TestContext) => boolean;
  headers?: Record<string, string | RegExp>;
}

export interface E2EScenario extends BaseScenario {
  agent: 'e2e';
  steps: E2EStep[];
}

export interface E2EStep {
  name: string;
  action: (agent: E2EAgentActions, ctx: TestContext) => Promise<void>;
  continueOnError?: boolean;
}

export interface E2EAgentActions {
  page: unknown; // Playwright Page
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  waitForNavigation(): Promise<void>;
  uploadFiles(selector: string, files: string[]): Promise<void>;
  captureScreenshot(name: string): Promise<string>;
  expectVisible(selector: string): Promise<void>;
  expectText(selector: string, text: string | RegExp): Promise<void>;
  expectUrl(pattern: string | RegExp): Promise<void>;
  expectCount(selector: string, count: number): Promise<void>;
}

export interface VisualScenario extends BaseScenario {
  agent: 'visual';
  views: VisualView[];
}

export interface VisualView {
  name: string;
  url: string | ((ctx: TestContext) => string);
  waitFor?: string;
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  threshold?: number;
  ignoreRegions?: Array<{ selector: string } | { x: number; y: number; width: number; height: number }>;
}

export type Scenario = APIScenario | E2EScenario | VisualScenario;

// ============= Results =============

export interface TestResult {
  scenario: string;
  agent: ScenarioType;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  steps?: StepResult[];
  visualResults?: VisualResult[];
  error?: string;
  warnings?: string[];
}

export interface StepResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  response?: {
    status: number;
    body: unknown;
  };
  validations?: ValidationResult;
  error?: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; message?: string }>;
}

export interface VisualResult {
  view: string;
  status: 'passed' | 'failed' | 'new_baseline';
  diffPercentage?: number;
  diffImage?: string;
  baselineImage?: string;
  actualImage?: string;
}

// ============= Reports =============

export interface TestReport {
  timestamp: Date;
  duration: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  geminiUsage: CostSummary;
  scenarios: TestResult[];
  failures: FailureDetail[];
  htmlPath?: string;
  jsonPath?: string;
}

export interface CostSummary {
  totalCost: number;
  callCount: number;
  averageCostPerCall: number;
  limit: number;
  remaining: number;
}

export interface FailureDetail {
  scenario: string;
  step?: string;
  error: string;
  screenshot?: string;
}

// ============= AI Validation =============

export interface AIExpectation {
  pattern?: RegExp;
  minLength?: number;
  maxLength?: number;
  contains?: string[];
  notContains?: string[];
}

export interface AIValidationResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    expected?: string;
    actual?: string;
  }>;
}
