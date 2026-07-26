import { describe, it, expect } from 'vitest';
import { KB_PAGES } from '../../src/docs/kb/pages/index.js';
import { listDocs, getDoc, searchDocs } from '../../src/docs/kb.js';

describe('docs knowledge base', () => {
  it('bundles at least the core pages with unique slugs', () => {
    const slugs = KB_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of [
      'template-syntax',
      'control-structures',
      'navigation',
      'i18n',
      'blocks',
      'theme-json',
      'headless',
      'getting-started',
    ]) {
      expect(slugs).toContain(slug);
    }
  });

  it('list returns slug/title/tags/reference without bodies', () => {
    const entries = listDocs();
    expect(entries.length).toBe(KB_PAGES.length);
    for (const entry of entries) {
      expect(entry.slug).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(Array.isArray(entry.tags)).toBe(true);
      expect('body' in entry).toBe(false);
    }
  });

  it('get returns the full page body', () => {
    const page = getDoc('template-syntax');
    expect(page.title).toBe('Template syntax');
    expect(page.body).toContain('@{');
  });

  it('get throws NOT_FOUND for unknown slugs', () => {
    expect(() => getDoc('nope')).toThrowError(/unknown doc page/);
  });

  it('search ranks title/tag matches above body-only matches', () => {
    const hits = searchDocs('navigation');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.slug).toBe('navigation');
    expect(hits[0]!.score).toBeGreaterThan(0);
    expect(hits[0]!.snippet.length).toBeGreaterThan(0);
  });

  it('search honors the limit', () => {
    const hits = searchDocs('theme', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('search rejects an empty query', () => {
    expect(() => searchDocs('   ')).toThrowError(/must not be empty/);
  });

  it('search returns nothing for a term absent from every page', () => {
    expect(searchDocs('zzxqwballoon')).toEqual([]);
  });
});

describe('KB_PAGES registration', () => {
  it('contains exactly 13 pages in the canonical order', () => {
    expect(KB_PAGES.map((p) => p.slug)).toEqual([
      'template-syntax',
      'control-structures',
      'navigation',
      'i18n',
      'blocks',
      'theme-json',
      'headless',
      'getting-started',
      'common-pitfalls',
      'include-path-resolution',
      'custom-functions',
      'runtime-lang',
      'snippet-inheritance',
    ]);
  });

  it('each page has the required shape', () => {
    for (const page of KB_PAGES) {
      expect(page.slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.tags.length).toBeGreaterThan(0);
      expect(page.body.length).toBeGreaterThan(100);
    }
  });
});
