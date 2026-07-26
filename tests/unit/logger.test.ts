import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { logger } from '../../src/logger.js';

describe('logger', () => {
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('exports a pino-compatible logger', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  it('writes logs to stderr so stdout stays available for MCP frames', () => {
    logger.info({ url: 'https://x', password: 'secret', token: 'abc' }, 'test');
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).not.toContain('secret');
    expect(output).not.toContain('abc');
    expect(output).toContain('https://x');
  });
});
