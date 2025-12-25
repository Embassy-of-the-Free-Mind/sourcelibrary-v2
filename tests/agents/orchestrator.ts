import { APIAgent } from './api-agent';
import { DBManager } from '../tools/db-manager';
import { GeminiTracker } from '../tools/gemini-tracker';
import {
  TestConfig,
  TestContext,
  TestResult,
  TestReport,
  Scenario,
  FailureDetail
} from '../types';

export interface OrchestratorConfig extends TestConfig {
  scenarios?: Scenario[];
}

export class TestOrchestrator {
  private config: OrchestratorConfig;
  private dbManager: DBManager | null = null;
  private geminiTracker: GeminiTracker;
  private apiAgent: APIAgent | null = null;
  private context: TestContext | null = null;
  private results: TestResult[] = [];

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.geminiTracker = new GeminiTracker(config.geminiCostLimit);
  }

  async initialize(): Promise<void> {
    console.log('\n[Orchestrator] Initializing test system...');

    // Try to initialize database (optional - tests can run HTTP-only)
    try {
      this.dbManager = new DBManager(this.config.mongoUri, this.config.testDbName);
      await this.dbManager.connect();
      await this.dbManager.seedPrompts();
      console.log('[Orchestrator] Database connected');
    } catch (error) {
      console.log('[Orchestrator] Database connection failed - running in HTTP-only mode');
      console.log('[Orchestrator] (Scenarios with setup/teardown will be skipped)');
      this.dbManager = null;
    }

    // Create test context
    this.context = {
      db: this.dbManager?.getDb() as any,
      config: this.config,
      saved: {},
      warnings: [],
      fixtures: this.dbManager?.createFixtureManager() as any
    };

    // Initialize agents
    this.apiAgent = new APIAgent('api-agent', {
      name: 'api-agent',
      apiBaseUrl: this.config.apiBaseUrl,
      timeout: 30000
    });

    await this.apiAgent.setup(this.context);

    console.log('[Orchestrator] Initialization complete\n');
  }

  async runScenarios(scenarios: Scenario[], options?: {
    filter?: (scenario: Scenario) => boolean;
    parallel?: boolean;
  }): Promise<TestReport> {
    const startTime = Date.now();
    this.results = [];

    // Apply filter if provided
    let scenariosToRun = scenarios;
    if (options?.filter) {
      scenariosToRun = scenarios.filter(options.filter);
    }

    console.log(`[Orchestrator] Running ${scenariosToRun.length} scenarios\n`);
    console.log('='.repeat(60));

    // Group by agent type
    const apiScenarios = scenariosToRun.filter(s => s.agent === 'api');
    const e2eScenarios = scenariosToRun.filter(s => s.agent === 'e2e');
    const visualScenarios = scenariosToRun.filter(s => s.agent === 'visual');

    // Run API scenarios first (typically setup for E2E)
    if (apiScenarios.length > 0) {
      console.log(`\n[API Tests] Running ${apiScenarios.length} scenarios`);
      console.log('-'.repeat(40));

      for (const scenario of apiScenarios) {
        // Skip scenarios that require DB if we're in HTTP-only mode
        if (!this.dbManager && (scenario.setup || scenario.teardown)) {
          console.log(`\n○ ${scenario.name} (skipped - requires DB)`);
          this.results.push({
            scenario: scenario.name,
            agent: 'api',
            status: 'skipped',
            duration: 0
          });
          continue;
        }

        // Reset context warnings for each scenario
        this.context!.warnings = [];
        this.context!.saved = {};

        const result = await this.apiAgent!.runScenario(scenario);
        this.results.push(result);

        this.printScenarioResult(result);
      }
    }

    // E2E and Visual would run here (not implemented yet)
    if (e2eScenarios.length > 0) {
      console.log(`\n[E2E Tests] ${e2eScenarios.length} scenarios (not implemented)`);
      for (const scenario of e2eScenarios) {
        this.results.push({
          scenario: scenario.name,
          agent: 'e2e',
          status: 'skipped',
          duration: 0
        });
      }
    }

    if (visualScenarios.length > 0) {
      console.log(`\n[Visual Tests] ${visualScenarios.length} scenarios (not implemented)`);
      for (const scenario of visualScenarios) {
        this.results.push({
          scenario: scenario.name,
          agent: 'visual',
          status: 'skipped',
          duration: 0
        });
      }
    }

    const duration = Date.now() - startTime;
    return this.generateReport(duration);
  }

  private printScenarioResult(result: TestResult): void {
    const icon = result.status === 'passed' ? '✓' : result.status === 'failed' ? '✗' : '○';
    const color = result.status === 'passed' ? '\x1b[32m' : result.status === 'failed' ? '\x1b[31m' : '\x1b[33m';
    const reset = '\x1b[0m';

    console.log(`\n${color}${icon} ${result.scenario}${reset} (${result.duration}ms)`);

    if (result.steps) {
      const passed = result.steps.filter(s => s.status === 'passed').length;
      const failed = result.steps.filter(s => s.status === 'failed').length;
      console.log(`  Steps: ${passed} passed, ${failed} failed`);
    }

    if (result.warnings && result.warnings.length > 0) {
      console.log(`  Warnings: ${result.warnings.join(', ')}`);
    }

    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }

  private generateReport(duration: number): TestReport {
    const summary = {
      total: this.results.length,
      passed: this.results.filter(r => r.status === 'passed').length,
      failed: this.results.filter(r => r.status === 'failed').length,
      skipped: this.results.filter(r => r.status === 'skipped').length
    };

    const failures: FailureDetail[] = this.results
      .filter(r => r.status === 'failed')
      .map(r => ({
        scenario: r.scenario,
        step: r.steps?.find(s => s.status === 'failed')?.name,
        error: r.error || r.steps?.find(s => s.status === 'failed')?.error || 'Unknown error'
      }));

    console.log('\n' + '='.repeat(60));
    console.log('\n[Summary]');
    console.log(`  Total:   ${summary.total}`);
    console.log(`  Passed:  \x1b[32m${summary.passed}\x1b[0m`);
    console.log(`  Failed:  \x1b[31m${summary.failed}\x1b[0m`);
    console.log(`  Skipped: \x1b[33m${summary.skipped}\x1b[0m`);
    console.log(`  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`\n[Gemini Usage]`);

    const geminiUsage = this.geminiTracker.getSummary();
    console.log(`  Calls: ${geminiUsage.callCount}`);
    console.log(`  Cost:  $${geminiUsage.totalCost.toFixed(4)} / $${geminiUsage.limit}`);

    return {
      timestamp: new Date(),
      duration,
      summary,
      geminiUsage,
      scenarios: this.results,
      failures
    };
  }

  async cleanup(): Promise<void> {
    console.log('\n[Orchestrator] Cleaning up...');

    if (this.apiAgent) {
      await this.apiAgent.teardown();
    }

    if (this.dbManager) {
      await this.dbManager.cleanup();
      await this.dbManager.disconnect();
    }

    console.log('[Orchestrator] Cleanup complete');
  }
}
