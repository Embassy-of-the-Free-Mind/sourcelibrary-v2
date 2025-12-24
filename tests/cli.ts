#!/usr/bin/env npx ts-node

import { program } from 'commander';
import { TestOrchestrator } from './agents/orchestrator';
import { allAPIScenarios } from './scenarios/api/index';
import { Scenario } from './types';

// Load environment variables
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'sourcelibrary';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

program
  .name('sl-test')
  .description('Source Library Agent-Based Testing System')
  .version('1.0.0');

program
  .command('run')
  .description('Run test scenarios')
  .option('-s, --scenarios <patterns...>', 'Scenario name patterns to run')
  .option('-t, --tags <tags...>', 'Filter by tags (e.g., --tags api crud)')
  .option('--api-only', 'Run only API tests')
  .option('--e2e-only', 'Run only E2E tests')
  .option('--visual-only', 'Run only visual tests')
  .option('--skip-expensive', 'Skip scenarios tagged as expensive')
  .option('--skip-slow', 'Skip scenarios tagged as slow')
  .option('--cost-limit <usd>', 'Gemini API cost limit in USD', '10')
  .option('--db <name>', 'Test database name', 'sl_test')
  .option('--api-url <url>', 'API base URL', API_BASE_URL)
  .action(async (options) => {
    console.log('\n🧪 Source Library Test Runner\n');

    // Build scenario list
    let scenarios: Scenario[] = [...allAPIScenarios];

    // Filter by agent type
    if (options.apiOnly) {
      scenarios = scenarios.filter(s => s.agent === 'api');
    } else if (options.e2eOnly) {
      scenarios = scenarios.filter(s => s.agent === 'e2e');
    } else if (options.visualOnly) {
      scenarios = scenarios.filter(s => s.agent === 'visual');
    }

    // Filter by tags
    if (options.tags) {
      const tags = options.tags as string[];
      scenarios = scenarios.filter(s =>
        s.tags?.some(t => tags.includes(t))
      );
    }

    // Skip expensive/slow
    if (options.skipExpensive) {
      scenarios = scenarios.filter(s => !s.tags?.includes('expensive'));
    }
    if (options.skipSlow) {
      scenarios = scenarios.filter(s => !s.tags?.includes('slow'));
    }

    // Filter by name pattern
    if (options.scenarios) {
      const patterns = options.scenarios as string[];
      scenarios = scenarios.filter(s =>
        patterns.some(p => s.name.toLowerCase().includes(p.toLowerCase()))
      );
    }

    if (scenarios.length === 0) {
      console.log('No scenarios match the specified filters.');
      process.exit(0);
    }

    console.log(`Found ${scenarios.length} scenarios to run:`);
    scenarios.forEach(s => console.log(`  - ${s.name} [${s.tags?.join(', ') || 'no tags'}]`));

    // Create orchestrator
    const orchestrator = new TestOrchestrator({
      apiBaseUrl: options.apiUrl,
      mongoUri: MONGODB_URI,
      testDbName: options.db,
      geminiCostLimit: parseFloat(options.costLimit),
      parallel: 1,
      reportDir: './tests/reports',
      screenshotDir: './tests/reports/screenshots',
      baselineDir: './tests/reports/baselines',
      browserConfig: {
        headless: true,
        viewport: { width: 1440, height: 900 },
        timeout: 30000
      }
    });

    try {
      await orchestrator.initialize();
      const report = await orchestrator.runScenarios(scenarios);

      // Exit with appropriate code
      process.exit(report.summary.failed > 0 ? 1 : 0);
    } catch (error) {
      console.error('\n❌ Test run failed:', error);
      process.exit(1);
    } finally {
      await orchestrator.cleanup();
    }
  });

program
  .command('list')
  .description('List available test scenarios')
  .option('-t, --tags <tags...>', 'Filter by tags')
  .action((options) => {
    let scenarios: Scenario[] = [...allAPIScenarios];

    if (options.tags) {
      const tags = options.tags as string[];
      scenarios = scenarios.filter(s =>
        s.tags?.some(t => tags.includes(t))
      );
    }

    console.log('\n📋 Available Test Scenarios\n');

    const byAgent = {
      api: scenarios.filter(s => s.agent === 'api'),
      e2e: scenarios.filter(s => s.agent === 'e2e'),
      visual: scenarios.filter(s => s.agent === 'visual')
    };

    for (const [agent, agentScenarios] of Object.entries(byAgent)) {
      if (agentScenarios.length > 0) {
        console.log(`\n[${agent.toUpperCase()}]`);
        for (const s of agentScenarios) {
          const tags = s.tags?.length ? ` [${s.tags.join(', ')}]` : '';
          console.log(`  ${s.name}${tags}`);
        }
      }
    }

    console.log(`\nTotal: ${scenarios.length} scenarios\n`);
  });

program
  .command('clean')
  .description('Clean up test data from database')
  .option('--db <name>', 'Test database name', 'sl_test')
  .action(async (options) => {
    const { DBManager } = await import('./tools/db-manager');

    console.log('\n🧹 Cleaning test data...\n');

    const dbManager = new DBManager(MONGODB_URI, options.db);
    await dbManager.connect();
    await dbManager.cleanup();
    await dbManager.disconnect();

    console.log('✅ Cleanup complete\n');
  });

program.parse();
