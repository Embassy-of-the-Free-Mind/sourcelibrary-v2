#!/usr/bin/env npx ts-node

/**
 * Simple API test runner - just HTTP requests, no database needed
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

interface Test {
  name: string;
  method: string;
  path: string;
  expectedStatus?: number;
  validate?: (data: any) => boolean;
}

const tests: Test[] = [
  {
    name: 'GET /api/books',
    method: 'GET',
    path: '/api/books',
    expectedStatus: 200,
    validate: (data) => Array.isArray(data)
  },
  {
    name: 'GET /api/prompts',
    method: 'GET',
    path: '/api/prompts',
    expectedStatus: 200,
    validate: (data) => Array.isArray(data)
  },
  {
    name: 'GET /api/catalog',
    method: 'GET',
    path: '/api/catalog',
    expectedStatus: 200,
    validate: (data) => 'catalog' in data
  }
];

async function runTest(test: Test): Promise<{ passed: boolean; error?: string; duration: number }> {
  const start = Date.now();

  try {
    const res = await fetch(`${BASE_URL}${test.path}`, { method: test.method });
    const duration = Date.now() - start;

    if (test.expectedStatus && res.status !== test.expectedStatus) {
      return { passed: false, error: `Expected ${test.expectedStatus}, got ${res.status}`, duration };
    }

    if (test.validate) {
      const data = await res.json();
      if (!test.validate(data)) {
        return { passed: false, error: 'Validation failed', duration };
      }
    }

    return { passed: true, duration };
  } catch (err) {
    return { passed: false, error: String(err), duration: Date.now() - start };
  }
}

async function main() {
  console.log(`\n🧪 Testing ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await runTest(test);

    if (result.passed) {
      console.log(`✓ ${test.name} (${result.duration}ms)`);
      passed++;
    } else {
      console.log(`✗ ${test.name} - ${result.error}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
