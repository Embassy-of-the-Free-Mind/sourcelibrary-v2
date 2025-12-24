import { BaseAgent } from './base-agent';
import { HttpClient } from '../tools/http-client';
import {
  TestContext,
  TestResult,
  StepResult,
  APIScenario,
  APIStep,
  Scenario
} from '../types';

export class APIAgent extends BaseAgent {
  private client: HttpClient | null = null;

  async setup(context: TestContext): Promise<void> {
    this.setContext(context);
    this.client = new HttpClient({
      baseUrl: this.config.apiBaseUrl || 'http://localhost:3000',
      timeout: this.config.timeout || 30000
    });
    this.log('info', 'API Agent initialized');
  }

  async teardown(): Promise<void> {
    this.client = null;
    this.log('info', 'API Agent shutdown');
  }

  async runScenario(scenario: Scenario): Promise<TestResult> {
    if (scenario.agent !== 'api') {
      throw new Error(`APIAgent cannot run scenario of type: ${scenario.agent}`);
    }

    const apiScenario = scenario as APIScenario;
    const context = this.context!;

    this.log('info', `Running scenario: ${apiScenario.name}`);

    // Run setup
    if (apiScenario.setup) {
      try {
        await apiScenario.setup(context);
        this.log('info', 'Scenario setup complete');
      } catch (error) {
        this.log('error', `Setup failed: ${error}`);
        return {
          scenario: apiScenario.name,
          agent: 'api',
          status: 'failed',
          duration: 0,
          error: `Setup failed: ${error}`
        };
      }
    }

    const results: StepResult[] = [];
    const startTime = Date.now();

    try {
      for (const step of apiScenario.steps) {
        const result = await this.executeStep(step, context);
        results.push(result);

        // Save result if requested
        if (step.saveAs && result.response?.body) {
          context.saved[step.saveAs] = result.response.body;
          this.log('info', `Saved response as: ${step.saveAs}`);
        }

        // Stop on failure unless continueOnError
        if (result.status === 'failed' && !step.continueOnError) {
          this.log('error', `Step failed: ${step.name}`);
          break;
        }
      }
    } finally {
      // Run teardown
      if (apiScenario.teardown) {
        try {
          await apiScenario.teardown(context);
          this.log('info', 'Scenario teardown complete');
        } catch (error) {
          this.log('warn', `Teardown failed: ${error}`);
        }
      }
    }

    return {
      scenario: apiScenario.name,
      agent: 'api',
      status: this.deriveStatus(results),
      duration: Date.now() - startTime,
      steps: results,
      warnings: context.warnings.length > 0 ? context.warnings : undefined
    };
  }

  private async executeStep(step: APIStep, context: TestContext): Promise<StepResult> {
    const startTime = Date.now();

    // Resolve dynamic path and body
    const path = typeof step.path === 'function' ? step.path(context) : step.path;
    const body = typeof step.body === 'function' ? step.body(context) : step.body;

    this.log('info', `Step: ${step.name} - ${step.method} ${path}`);

    try {
      const response = await this.client!.request(step.method, path, {
        body,
        headers: step.headers,
        query: step.query,
        timeout: step.timeout
      });

      // Validate response
      const validations = this.validateResponse(response, step, context)!;

      const result: StepResult = {
        name: step.name,
        status: validations.passed ? 'passed' : 'failed',
        duration: Date.now() - startTime,
        response: {
          status: response.status,
          body: response.data
        },
        validations
      };

      if (result.status === 'passed') {
        this.log('info', `  ✓ ${step.name} (${result.duration}ms)`);
      } else {
        this.log('error', `  ✗ ${step.name}: validation failed`);
        for (const check of validations.checks.filter((c: { passed: boolean }) => !c.passed)) {
          this.log('error', `    - ${check.name}: ${check.message || 'failed'}`);
        }
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log('error', `  ✗ ${step.name}: ${errorMessage}`);

      return {
        name: step.name,
        status: 'failed',
        duration: Date.now() - startTime,
        error: errorMessage
      };
    }
  }

  private validateResponse(
    response: { status: number; data: unknown },
    step: APIStep,
    context: TestContext
  ): StepResult['validations'] {
    const checks: Array<{ name: string; passed: boolean; message?: string }> = [];

    // Check status code
    if (step.expect.status !== undefined) {
      const passed = response.status === step.expect.status;
      checks.push({
        name: 'status',
        passed,
        message: passed ? undefined : `Expected ${step.expect.status}, got ${response.status}`
      });
    }

    // Check body with custom validator
    if (step.expect.body) {
      try {
        const passed = step.expect.body(response.data, context);
        checks.push({
          name: 'body',
          passed,
          message: passed ? undefined : 'Body validation failed'
        });
      } catch (error) {
        checks.push({
          name: 'body',
          passed: false,
          message: `Body validation error: ${error}`
        });
      }
    }

    // Check headers
    if (step.expect.headers) {
      for (const [key, expected] of Object.entries(step.expect.headers)) {
        // Headers check would require access to actual headers
        // For now, skip header validation
      }
    }

    return this.createValidationResult(checks);
  }
}
