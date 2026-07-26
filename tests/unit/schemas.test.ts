import { describe, it, expect } from 'vitest';
import {
  pagesInput,
  mediaInput,
  sharedInput,
  configInput,
  siteInput,
  writeMode,
  themeInput,
} from '../../src/schemas.js';

describe('schemas', () => {
  it('writeMode enum is strict', () => {
    expect(writeMode.parse('read-only')).toBe('read-only');
    expect(writeMode.parse('confirm-destructive')).toBe('confirm-destructive');
    expect(writeMode.parse('unrestricted')).toBe('unrestricted');
    expect(() => writeMode.parse('nope')).toThrow();
  });

  it('pagesInput accepts list and rejects unknown action', () => {
    expect(pagesInput.parse({ action: 'list' })).toBeDefined();
    expect(() => pagesInput.parse({ action: 'bogus' })).toThrow();
  });

  it('pagesInput url must start with /', () => {
    expect(() => pagesInput.parse({ action: 'get', url: 'nope' })).toThrow();
    expect(pagesInput.parse({ action: 'get', url: '/blog' })).toBeDefined();
  });

  it('mediaInput accepts list/upload/delete and rejects unknown action', () => {
    expect(mediaInput.parse({ action: 'list' })).toBeDefined();
    expect(mediaInput.parse({ action: 'upload' })).toBeDefined();
    expect(mediaInput.parse({ action: 'delete', url: '/x', filename: 'y' })).toBeDefined();
    expect(() => mediaInput.parse({ action: 'rename' })).toThrow();
  });

  it('mediaInput rejects base64 source exceeding the size limit', () => {
    // 12 MB max (chars of base64 string incl. padding); push past it.
    const huge = 'A'.repeat(13 * 1024 * 1024);
    expect(() =>
      mediaInput.parse({
        action: 'upload',
        source: { base64: huge, filename: 'big.bin', mimeType: 'application/octet-stream' },
      }),
    ).toThrow(/exceeds/);
  });

  it('mediaInput accepts a base64 source within the size limit', () => {
    const ok = 'A'.repeat(1024); // 1 KB — well under the limit
    expect(
      mediaInput.parse({
        action: 'upload',
        source: { base64: ok, filename: 'ok.png', mimeType: 'image/png' },
      }),
    ).toBeDefined();
  });

  it('pagesInput rejects batch_update exceeding the items limit', () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ url: `/p${i}` }));
    expect(() => pagesInput.parse({ action: 'batch_update', items })).toThrow(/at most 200/);
  });

  it('pagesInput accepts batch_update at the items limit', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ url: `/p${i}` }));
    expect(pagesInput.parse({ action: 'batch_update', items })).toBeDefined();
  });

  it('themeInput rejects content exceeding the size limit', () => {
    const huge = 'x'.repeat(4 * 1024 * 1024 + 1);
    expect(() =>
      themeInput.parse({ action: 'write', theme: 't', path: 'x.php', content: huge }),
    ).toThrow(/exceeds/);
  });

  it('themeInput accepts content within the size limit', () => {
    const ok = 'x'.repeat(1024);
    expect(
      themeInput.parse({ action: 'write', theme: 't', path: 'x.php', content: ok }),
    ).toBeDefined();
  });

  it('themeInput accepts dev actions and an optional valid port', () => {
    expect(themeInput.parse({ action: 'dev', theme: 't', port: 4321 })).toMatchObject({
      action: 'dev',
      port: 4321,
    });
    expect(themeInput.parse({ action: 'dev_stop', theme: 't' }).action).toBe('dev_stop');
    expect(themeInput.parse({ action: 'dev_status', theme: 't' }).action).toBe('dev_status');
  });

  it('themeInput rejects out-of-range dev ports', () => {
    expect(() => themeInput.parse({ action: 'dev', theme: 't', port: 0 })).toThrow();
    expect(() => themeInput.parse({ action: 'dev', theme: 't', port: 70000 })).toThrow();
  });

  it('sharedInput accepts get', () => {
    expect(sharedInput.parse({ action: 'get' })).toBeDefined();
  });

  it('configInput action enum is get|set', () => {
    expect(configInput.parse({ action: 'get' })).toBeDefined();
    expect(() => configInput.parse({ action: 'delete' })).toThrow();
  });

  it('siteInput action enum is info|search', () => {
    expect(siteInput.parse({ action: 'info' })).toBeDefined();
    expect(() => siteInput.parse({ action: 'backup' })).toThrow();
  });

  it('themeInput accepts read-only analysis actions', () => {
    expect(themeInput.parse({ action: 'analyze', theme: 'starter' }).action).toBe('analyze');
    expect(themeInput.parse({ action: 'validate', theme: 'starter' }).action).toBe('validate');
  });

  it('themeInput accepts schema action', () => {
    expect(themeInput.parse({ action: 'schema', theme: 'starter' }).action).toBe('schema');
  });
});
