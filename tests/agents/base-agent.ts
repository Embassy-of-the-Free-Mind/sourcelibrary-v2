import {
  AgentConfig,
  TestContext,
  TestResult,
  Scenario,
  ValidationResult,
  AIValidationResult,
  AIExpectation
} from '../types';

export abstract class BaseAgent {
  protected name: string;
  protected config: AgentConfig;
  protected context: TestContext | null = null;

  constructor(name: string, config: AgentConfig) {
    this.name = name;
    this.config = config;
  }

  abstract setup(context: TestContext): Promise<void>;
  abstract teardown(): Promise<void>;
  abstract runScenario(scenario: Scenario): Promise<TestResult>;

  setContext(context: TestContext): void {
    this.context = context;
  }

  // ============= Logging =============

  protected log(level: 'info' | 'warn' | 'error', message: string): void {
    const timestamp = new Date().toISOString().substring(11, 23);
    const prefix = `[${timestamp}] [${this.name}]`;

    switch (level) {
      case 'info':
        console.log(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} WARN: ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ERROR: ${message}`);
        break;
    }
  }

  // ============= Retry Logic =============

  protected async retry<T>(
    fn: () => Promise<T>,
    attempts: number = 3,
    delayMs: number = 1000,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log('warn', `Attempt ${i + 1}/${attempts} failed: ${lastError.message}`);

        if (i < attempts - 1) {
          const delay = delayMs * Math.pow(backoffMultiplier, i);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============= Wait for Condition =============

  protected async waitForCondition(
    check: () => Promise<boolean>,
    timeoutMs: number = 30000,
    pollIntervalMs: number = 500
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await check()) {
        return;
      }
      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }

  // ============= AI Response Validation =============

  protected validateAIResponse(
    response: string,
    expectations: AIExpectation[]
  ): AIValidationResult {
    const checks: AIValidationResult['checks'] = [];

    for (const exp of expectations) {
      if (exp.pattern) {
        const passed = exp.pattern.test(response);
        checks.push({
          name: `pattern: ${exp.pattern.source}`,
          passed,
          expected: exp.pattern.source,
          actual: passed ? 'matched' : 'not matched'
        });
      }

      if (exp.minLength !== undefined) {
        const passed = response.length >= exp.minLength;
        checks.push({
          name: `minLength: ${exp.minLength}`,
          passed,
          expected: `>= ${exp.minLength}`,
          actual: String(response.length)
        });
      }

      if (exp.maxLength !== undefined) {
        const passed = response.length <= exp.maxLength;
        checks.push({
          name: `maxLength: ${exp.maxLength}`,
          passed,
          expected: `<= ${exp.maxLength}`,
          actual: String(response.length)
        });
      }

      if (exp.contains) {
        for (const text of exp.contains) {
          const passed = response.includes(text);
          checks.push({
            name: `contains: "${text}"`,
            passed,
            expected: text,
            actual: passed ? 'found' : 'not found'
          });
        }
      }

      if (exp.notContains) {
        for (const text of exp.notContains) {
          const passed = !response.includes(text);
          checks.push({
            name: `notContains: "${text}"`,
            passed,
            expected: `not "${text}"`,
            actual: passed ? 'not found' : 'found'
          });
        }
      }
    }

    return {
      passed: checks.every(c => c.passed),
      checks
    };
  }

  // Normalize AI output for comparison (remove variable whitespace, etc.)
  protected normalizeAIOutput(text: string): string {
    return text
      .replace(/\r\n/g, '\n')          // Normalize line endings
      .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
      .replace(/[ \t]+/g, ' ')          // Collapse whitespace
      .trim();
  }

  // ============= Validation Helpers =============

  protected createValidationResult(checks: Array<{ name: string; passed: boolean; message?: string }>): ValidationResult {
    return {
      passed: checks.every(c => c.passed),
      checks
    };
  }

  // Calculate duration from step results
  protected calculateDuration(steps: Array<{ duration: number }>): number {
    return steps.reduce((total, step) => total + step.duration, 0);
  }

  // Derive overall status from step results
  protected deriveStatus(steps: Array<{ status: string }>): 'passed' | 'failed' | 'skipped' {
    if (steps.some(s => s.status === 'failed')) return 'failed';
    if (steps.every(s => s.status === 'skipped')) return 'skipped';
    return 'passed';
  }
}
