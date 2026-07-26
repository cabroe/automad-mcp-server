import { describe, it, expect } from 'vitest';
import { handleDocs } from '../../../src/domains/docs.js';
import { WriteGuard } from '../../../src/write-guard.js';
import type { Config } from '../../../src/config.js';

function guard(writeMode: Config['writeMode'] = 'confirm-destructive'): WriteGuard {
  return new WriteGuard({
    mode: 'docs',
    url: '',
    username: '',
    password: '',
    writeMode,
    logLevel: 'error',
    liveEnabled: false,
  });
}

describe('handleDocs', () => {
  it('list returns the page index', async () => {
    const out = await handleDocs({ action: 'list' }, guard());
    expect(out).toMatchObject({ pages: expect.any(Array) });
  });

  it('search returns ranked results', async () => {
    const out = await handleDocs({ action: 'search', query: 'foreach' }, guard());
    expect(out).toMatchObject({ query: 'foreach', results: expect.any(Array) });
  });

  it('search requires a query', async () => {
    await expect(handleDocs({ action: 'search' }, guard())).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('get requires a slug', async () => {
    await expect(handleDocs({ action: 'get' }, guard())).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('get returns a page', async () => {
    const out = await handleDocs({ action: 'get', slug: 'blocks' }, guard());
    expect(out).toMatchObject({ slug: 'blocks', title: 'Blocks' });
  });

  it('stays available even in read-only write mode (all actions are reads)', async () => {
    const out = await handleDocs({ action: 'list' }, guard('read-only'));
    expect(out).toMatchObject({ pages: expect.any(Array) });
  });
});
