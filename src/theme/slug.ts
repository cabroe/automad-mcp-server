import { AutomadMcpError } from '../errors.js';
export const THEME_SLUG_RE = /^[a-z0-9._-]+$/;

/** Reject anything that could escape the themesPath directory. */
export function assertSafeThemeSlug(slug: string): void {
  if (!slug) {
    throw new AutomadMcpError('VALIDATION', 'theme slug is required');
  }
  if (!THEME_SLUG_RE.test(slug) || slug.includes('..') || slug.startsWith('.')) {
    throw new AutomadMcpError('VALIDATION', `invalid theme slug '${slug}'`);
  }
}
