import { describe, it, expect } from 'vitest';
import { AutomadMcpError, errorToJson } from '../../src/errors.js';

describe('AutomadMcpError', () => {
  it('constructs with code and message', () => {
    const e = new AutomadMcpError('NOT_FOUND', 'Page not found');
    expect(e.code).toBe('NOT_FOUND');
    expect(e.message).toBe('Page not found');
    expect(e.name).toBe('AutomadMcpError');
    expect(e.details).toBeUndefined();
  });

  it('accepts details', () => {
    const e = new AutomadMcpError('VALIDATION', 'Bad input', { field: 'path' });
    expect(e.details).toEqual({ field: 'path' });
  });

  it('is instanceof Error', () => {
    const e = new AutomadMcpError('UNKNOWN', 'x');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('errorToJson', () => {
  it('serializes AutomadMcpError', () => {
    const json = errorToJson(new AutomadMcpError('FORBIDDEN', 'denied'));
    expect(json).toEqual({ code: 'FORBIDDEN', message: 'denied' });
  });

  it('serializes generic Error as UNKNOWN', () => {
    const json = errorToJson(new Error('boom'));
    expect(json).toEqual({ code: 'UNKNOWN', message: 'boom' });
  });

  it('serializes non-Error values', () => {
    expect(errorToJson('nope')).toEqual({ code: 'UNKNOWN', message: 'nope' });
    expect(errorToJson(42)).toEqual({ code: 'UNKNOWN', message: '42' });
  });
});
